import type { ResponseLike, Router } from '../express-types.js';
import { planProject, runProject } from '../../core/project.js';
import { buildEngine, sanitiseOptions, type RouteDeps } from '../engine-context.js';
import { wrapLogger } from '../logger.js';
import { sseBus } from '../progress/sse-bus.js';
import { runRegistry } from '../run-registry.js';

/**
 * Whole-project seeding: order the selected collections by their relations, size
 * them from the graph, then run them in sequence so parents always exist first.
 */
export function registerProjectRoutes(router: Router, deps: RouteDeps): void {
  router.post('/project/plan', async (req: any, res: ResponseLike) => {
    try {
      const body = req.body ?? {};
      const collections = Array.isArray(body.collections) ? body.collections.filter((c: any) => typeof c === 'string') : [];
      if (collections.length === 0) {
        return res.status(400).json({ error: 'collections must be a non-empty array' });
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

      void runProject(
        {
          plan,
          options,
          strategies: body.strategies && typeof body.strategies === 'object' ? body.strategies : undefined,
          wipeFirst: Boolean(body.wipeFirst),
          confirmWipe: Array.isArray(body.confirmWipe) ? body.confirmWipe : [],
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
          sseBus.emit(runId, { runId, type: 'error', message: err?.message ?? String(err) });
        })
        .finally(() => runRegistry.finish(runId));

      return res.json({ runId, plan, seed: engine.seed });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Failed to start project run' });
    }
  });
}
