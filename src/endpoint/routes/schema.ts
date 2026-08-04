import type { ResponseLike, Router } from '../express-types.js';
import { buildCollectionDescriptor } from '../../core/schema-model.js';
import { buildEngine, type RouteDeps } from '../engine-context.js';

export function registerSchemaRoute(router: Router, deps: RouteDeps): void {
  router.get('/schema/:collection', async (req: any, res: ResponseLike) => {
    try {
      const engine = await buildEngine(req, deps);
      const descriptor = await buildCollectionDescriptor(engine.ds, req.params.collection, {
        detect: {
          // Detection defaults mirror the UI defaults, so the first render of the
          // field list already matches what a run would produce.
          coherentRows: req.query.coherent !== 'false',
          realisticNulls: req.query.nulls === 'true',
        },
      });
      return res.json(descriptor);
    } catch (err: any) {
      return res.status(404).json({ error: err?.message ?? 'Failed to read schema' });
    }
  });
}
