import type { Router } from 'express';
import { runPreview } from '../core/generator.js';
import { sseBus } from '../progress/sse-bus.js';
import { wrapLogger } from '../logger.js';

export function registerPreviewRoute(
  router: Router,
  deps: { services: any; getSchema: () => Promise<any>; logger: any }
): void {
  router.post('/preview', async (req: any, res) => {
    if (!req.accountability?.admin) {
      return res.status(403).json({ error: 'Admin only' });
    }
    try {
      const body = req.body ?? {};
      if (!body.collection || typeof body.collection !== 'string') {
        return res.status(400).json({ error: 'collection is required' });
      }
      if (!body.strategies || typeof body.strategies !== 'object') {
        return res.status(400).json({ error: 'strategies is required' });
      }
      const schema = await deps.getSchema();
      const result = await runPreview(
        { collection: body.collection, strategies: body.strategies, count: body.count ?? 10 },
        {
          services: deps.services,
          schema,
          accountability: req.accountability,
          progressBus: sseBus,
          logger: wrapLogger(deps.logger),
        }
      );
      return res.json(result);
    } catch (err: any) {
      return res.status(400).json({ error: err?.message ?? 'Preview failed' });
    }
  });
}
