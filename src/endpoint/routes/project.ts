import type { ResponseLike, Router } from '../express-types.js';
import { planProject, runProject } from '../../core/project.js';
import { LIMITS, truncateMessage } from '../../core/request-validation.js';
import { classifySeedTarget } from '../../core/seed-targets.js';
import { updateAuditEnd, writeAuditStart } from '../audit.js';
import { buildEngine, sanitiseOptions, type RouteDeps } from '../engine-context.js';
import { wrapLogger } from '../logger.js';
import { sseBus } from '../progress/sse-bus.js';
import { runRegistry } from '../run-registry.js';

/**
 * Whole-project seeding: order the selected collections by their relations, size
 * them from the graph, then run them in sequence so parents always exist first.
 */
const UNDO_ID_LIMIT = 100_000;

export function registerProjectRoutes(router: Router, deps: RouteDeps): void {
  router.post('/project/plan', async (req: any, res: ResponseLike) => {
    try {
      const body = req.body ?? {};
      const collections = Array.isArray(body.collections) ? body.collections.filter((c: any) => typeof c === 'string') : [];
      if (collections.length === 0) {
        return res.status(400).json({ error: 'collections must be a non-empty array' });
      }
      if (collections.length > LIMITS.maxCollectionsPerProject) {
        return res.status(400).json({
          error: `A project run is capped at ${LIMITS.maxCollectionsPerProject} collections`,
        });
      }

      const rejected = collections
        .map((name: string) => ({ name, verdict: classifySeedTarget(name) }))
        .filter((entry: any) => !entry.verdict.seedable);
      if (rejected.length) {
        return res.status(400).json({
          error: rejected.map((e: any) => `"${e.name}" cannot be seeded: ${e.verdict.reason}`).join(' '),
        });
      }

      const engine = await buildEngine(req, deps);
      const plan = await planProject(engine.ds, {
        collections,
        counts: body.counts && typeof body.counts === 'object' ? body.counts : undefined,
        baseCount: Number.isFinite(body.baseCount) ? Number(body.baseCount) : undefined,
      });
      return res.json(plan);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Failed to plan project run' });
    }
  });

  router.post('/project/run', async (req: any, res: ResponseLike) => {
    try {
      const body = req.body ?? {};
      const collections = Array.isArray(body.collections) ? body.collections.filter((c: any) => typeof c === 'string') : [];
      if (collections.length === 0) {
        return res.status(400).json({ error: 'collections must be a non-empty array' });
      }
      if (collections.length > LIMITS.maxCollectionsPerProject) {
        return res.status(400).json({
          error: `A project run is capped at ${LIMITS.maxCollectionsPerProject} collections`,
        });
      }

      const rejected = collections
        .map((name: string) => ({ name, verdict: classifySeedTarget(name) }))
        .filter((entry: any) => !entry.verdict.seedable);
      if (rejected.length) {
        return res.status(400).json({
          error: rejected.map((e: any) => `"${e.name}" cannot be seeded: ${e.verdict.reason}`).join(' '),
        });
      }

      const options = sanitiseOptions(body.options);
      const engine = await buildEngine(req, deps, options);
      const plan = await planProject(engine.ds, {
        collections,
        counts: body.counts && typeof body.counts === 'object' ? body.counts : undefined,
        baseCount: Number.isFinite(body.baseCount) ? Number(body.baseCount) : undefined,
      });

      const runId = globalThis.crypto.randomUUID();
      const totalRows = Object.values(plan.counts).reduce((sum, n) => sum + n, 0);
      const active = runRegistry.start({
        runId,
        collection: `${plan.order.length} collections`,
        auditId: '',
        requested: totalRows,
      });

      // One audit row per collection, mirroring a single-collection run. Without
      // these, a project run that failed halfway left no trace anywhere except a
      // progress stream nobody may have been listening to.
      const recordResult = async (result: any): Promise<void> => {
        try {
          const auditId = await writeAuditStart(deps.services, engine.schema, req.accountability, {
            id: globalThis.crypto.randomUUID(),
            collection: result.collection,
            row_count_requested: result.requested,
            row_count_written: 0,
            dry_run: false,
            wipe_first: Boolean(body.wipeFirst),
            strategies: result.strategies ?? null,
            status: 'running',
            error_message: null,
            duration_ms: 0,
            started_at: new Date(Date.now() - (result.durationMs ?? 0)).toISOString(),
            completed_at: null,
            seed: engine.seed,
            options: { ...options, projectRunId: runId },
            undoable: false,
          });
          await updateAuditEnd(deps.services, engine.schema, req.accountability, auditId, {
            row_count_written: result.rowsWritten,
            status: result.error ? 'failed' : 'success',
            duration_ms: result.durationMs,
            completed_at: new Date().toISOString(),
            created_ids: (result.createdIds ?? []).slice(0, UNDO_ID_LIMIT),
            undoable: !result.createdIdsTruncated && (result.createdIds ?? []).length > 0,
            error_message: result.error ? truncateMessage(result.error) : null,
          });
        } catch (err: any) {
          deps.logger?.warn?.(
            { collection: result.collection, err: err?.message },
            'Seed Studio: could not record project-run result'
          );
        }
      };

      void runProject(
        {
          plan,
          options,
          strategies: body.strategies && typeof body.strategies === 'object' ? body.strategies : undefined,
          wipeFirst: Boolean(body.wipeFirst),
          confirmWipe: Array.isArray(body.confirmWipe) ? body.confirmWipe : [],
          onCollectionResult: recordResult,
        },
        {
          ds: engine.ds,
          rng: engine.rng,
          token: active.token,
          logger: wrapLogger(deps.logger),
          onProgress: (event) => sseBus.emit(runId, { ...event, runId }),
        }
      )
        .then((result) => {
          const failed = result.results.filter((r) => r.error);
          if (failed.length) {
            deps.logger?.warn?.(
              { runId, failed: failed.map((r) => `${r.collection}: ${r.error}`) },
              'Seed Studio: project run finished with per-collection failures'
            );
          }
          sseBus.emit(runId, {
            runId,
            type: result.cancelled ? 'cancelled' : 'complete',
            rowsWritten: result.totalRows,
            totalRows,
            elapsedMs: result.durationMs,
            message: result.results
              .map((r) => (r.error ? `${r.collection}: ${r.error}` : `${r.collection}: ${r.rowsWritten} rows`))
              .join(' · '),
          });
        })
        .catch((err: any) => {
          sseBus.emit(runId, { runId, type: 'error', message: truncateMessage(err?.message ?? String(err)) });
        })
        .finally(() => runRegistry.finish(runId));

      return res.json({ runId, plan, seed: engine.seed });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Failed to start project run' });
    }
  });
}
