import type { ResponseLike, Router } from '../express-types.js';
import { runGeneration } from '../../core/generator.js';
import type { GenerationRequest } from '../../core/types.js';
import { createPreset, updateAuditEnd, writeAuditStart } from '../audit.js';
import { buildEngine, sanitiseOptions, type RouteDeps } from '../engine-context.js';
import { wrapLogger } from '../logger.js';
import { sseBus } from '../progress/sse-bus.js';
import { runRegistry } from '../run-registry.js';

const UNDO_ID_LIMIT = 100_000;

export function registerGenerateRoutes(router: Router, deps: RouteDeps): void {
  router.post('/generate', async (req: any, res: ResponseLike) => {
    try {
      const body = (req.body ?? {}) as GenerationRequest;
      if (!body?.collection || typeof body.collection !== 'string') {
        return res.status(400).json({ error: 'collection is required' });
      }
      if (!body.strategies || typeof body.strategies !== 'object') {
        return res.status(400).json({ error: 'strategies is required' });
      }
      if (!Number.isFinite(body.count) || body.count <= 0) {
        return res.status(400).json({ error: 'count must be a positive integer' });
      }
      if (body.wipeFirst && body.confirm !== body.collection) {
        return res.status(400).json({
          error: `Wiping "${body.collection}" needs confirmation. Send confirm:"${body.collection}".`,
        });
      }

      const options = sanitiseOptions(body.options);
      const engine = await buildEngine(req, deps, options);
      const runId = globalThis.crypto.randomUUID();
      const startedAt = new Date().toISOString();

      let auditId = '';
      try {
        auditId = await writeAuditStart(deps.services, engine.schema, req.accountability, {
          collection: body.collection,
          row_count_requested: body.count,
          row_count_written: 0,
          dry_run: false,
          wipe_first: Boolean(body.wipeFirst),
          strategies: body.strategies,
          status: 'running',
          error_message: null,
          duration_ms: 0,
          started_at: startedAt,
          completed_at: null,
          seed: engine.seed,
          options,
          undoable: false,
        });
      } catch (err: any) {
        return res.status(500).json({
          error: `Failed to write audit row — ensure seed_studio_runs collection exists: ${err?.message ?? err}`,
        });
      }

      if (body.savePreset && body.presetName) {
        try {
          await createPreset(deps.services, engine.schema, req.accountability, {
            name: body.presetName,
            collection: body.collection,
            strategies: body.strategies,
            options,
          });
        } catch (err: any) {
          deps.logger?.warn?.({ err: err?.message }, 'Failed to save preset');
        }
      }

      const active = runRegistry.start({
        runId,
        collection: body.collection,
        auditId,
        requested: body.count,
      });

      // The run deliberately outlives this request — that is what the API engine
      // is for. Progress goes out over SSE; the audit row is the durable record.
      void runGeneration(
        { ...body, options },
        {
          ds: engine.ds,
          rng: engine.rng,
          token: active.token,
          logger: wrapLogger(deps.logger),
          onProgress: (event) => sseBus.emit(runId, { ...event, runId }),
        }
      )
        .then(async (result) => {
          await updateAuditEnd(deps.services, engine.schema, req.accountability, auditId, {
            row_count_written: result.rowsWritten,
            status: result.cancelled ? 'cancelled' : 'success',
            duration_ms: result.durationMs,
            completed_at: new Date().toISOString(),
            seed: result.seed,
            created_ids: result.createdIds.slice(0, UNDO_ID_LIMIT),
            undoable: !result.createdIdsTruncated && result.createdIds.length > 0,
            error_message: result.warnings.length > 0 ? result.warnings.join('\n') : null,
          }).catch(() => undefined);
        })
        .catch(async (err: any) => {
          const message = err?.message ?? String(err);
          sseBus.emit(runId, { runId, type: 'error', message });
          deps.logger?.error?.({ runId, err: message }, 'Seed Studio generation failed');
          await updateAuditEnd(deps.services, engine.schema, req.accountability, auditId, {
            status: 'failed',
            error_message: message,
            completed_at: new Date().toISOString(),
          }).catch(() => undefined);
        })
        .finally(() => {
          runRegistry.finish(runId);
        });

      return res.json({ runId, auditId, seed: engine.seed });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Generate failed' });
    }
  });

  router.post('/generate/:runId/cancel', async (req: any, res: ResponseLike) => {
    const cancelled = runRegistry.cancel(req.params.runId);
    if (!cancelled) {
      return res.status(404).json({ error: 'No active run with that id' });
    }
    return res.json({ ok: true, runId: req.params.runId });
  });

  router.get('/generate/:runId/progress', async (req: any, res: ResponseLike) => {
    const runId = req.params.runId;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let closed = false;
    const keepalive = setInterval(() => {
      if (closed) return;
      try {
        res.write(`: keepalive\n\n`);
      } catch {
        // ignore
      }
    }, 15000);

    const unsubscribe = sseBus.subscribe(runId, (event) => {
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        // client gone
      }
      if (event.type === 'complete' || event.type === 'error' || event.type === 'cancelled') {
        closed = true;
        clearInterval(keepalive);
        unsubscribe();
        try {
          res.end();
        } catch {
          // ignore
        }
      }
    });

    req.on('close', () => {
      closed = true;
      clearInterval(keepalive);
      unsubscribe();
    });
  });
}
