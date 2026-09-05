import type { ResponseLike, Router } from '../express-types.js';
import { profileCollection } from '../../core/inference.js';
import { buildCollectionDescriptor } from '../../core/schema-model.js';
import { isSeedStudioCollection } from '../../core/seed-targets.js';
import { buildEngine, type RouteDeps } from '../engine-context.js';

/**
 * Learn from the rows already in a collection and propose strategies that match
 * their shape — value frequencies, numeric ranges, null rates, id formats.
 */
export function registerProfileRoute(router: Router, deps: RouteDeps): void {
  router.get('/profile/:collection', async (req: any, res: ResponseLike) => {
    try {
      if (isSeedStudioCollection(req.params.collection)) {
        return res.status(404).json({ error: 'Collection not found' });
      }
      const engine = await buildEngine(req, deps);
      const sampleSize = Math.min(Math.max(parseInt(String(req.query.sample ?? '300'), 10) || 300, 20), 2000);

      const descriptor = await buildCollectionDescriptor(engine.ds, req.params.collection, {
        detect: { coherentRows: true },
      });

      if (descriptor.rowCount === 0) {
        return res.json({
          collection: descriptor.collection,
          sampleSize: 0,
          profiles: [],
          message: 'This collection is empty, so there is nothing to learn from yet.',
        });
      }

      const result = await profileCollection(engine.ds, descriptor, sampleSize);
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Failed to profile collection' });
    }
  });
}
