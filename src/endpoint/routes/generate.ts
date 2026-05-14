import type { Router } from 'express';
import { runGeneration } from '../core/generator.js';
import { sseBus } from '../progress/sse-bus.js';
import { wrapLogger } from '../logger.js';
import { createPreset, writeAuditStart } from '../core/audit.js';
import type { GenerationRequest } from '../types.js';

export function registerGenerateRoutes(
  router: Router,
  deps: { services: any; getSchema: () => Promise<any>; logger: any }
): void {
  router.post('/generate', async (req: any, res) => {
    if (!req.accountability?.admin) {
      return res.status(403).json({ error: 'Admin only' });
    }
    try {
      const body = req.body as GenerationRequest;
      if (!body?.collection || typeof body.collection !== 'string') {
        return res.status(400).json({ error: 'collection is required' });
      }
      if (!body.strategies || typeof body.strategies !== 'object') {
        return res.status(400).json({ error: 'strategies is required' });
      }
      if (!Number.isFinite(body.count) || body.count <= 0) {
        return res.status(400).json({ error: 'count must be a positive integer' });
      }

      const schema = await deps.getSchema();
      const runId = crypto.randomUUID();
      const startedAt = new Date().toISOString();

      let auditId = '';
      try {
        auditId = await writeAuditStart(deps.services, schema, req.accountability, {
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
        });
      } catch (err: any) {
        return res.status(500).json({
          error: `Failed to write audit row — ensure seed_studio_runs collection exists: ${err?.message ?? err}`,
        });
      }

      if (body.savePreset && body.presetName) {
        try {
          await createPreset(deps.services, schema, req.accountability, {
            name: body.presetName,
            collection: body.collection,
            strategies: body.strategies,
          });
        } catch (err: any) {
          deps.logger?.warn?.({ err: err?.message }, 'Failed to save preset');
        }
      }

      runGeneration(body, runId, auditId, {
        services: deps.services,
        schema,
        accountability: req.accountability,
        progressBus: sseBus,
        logger: wrapLogger(deps.logger),
      }).catch((err) => {
        deps.logger?.error?.({ runId, err: err?.message }, 'Generation failed');
      });

      return res.json({ runId });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Generate failed' });
    }
  });

  router.get('/generate/:runId/progress', async (req: any, res) => {
    if (!req.accountability?.admin) {
      return res.status(403).json({ error: 'Admin only' });
    }

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
      if (event.type === 'complete' || event.type === 'error') {
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
