import type { ResponseLike, Router } from '../express-types.js';
import { collectionInsights, insightWarnings } from '../../core/insights.js';
import { buildEngine, type RouteDeps } from '../engine-context.js';

/**
 * Pre-flight checks for a collection: which flows would fire, how many revision
 * rows the run adds, what has to be seeded first, and whether this instance
 * looks like production.
 */
export function registerInsightsRoute(router: Router, deps: RouteDeps): void {
  router.get('/insights/:collection', async (req: any, res: ResponseLike) => {
    try {
      const engine = await buildEngine(req, deps);
      const plannedRows = Math.max(0, parseInt(String(req.query.count ?? '0'), 10) || 0);
      const insights = await collectionInsights(engine.ds, req.params.collection);
      return res.json({
        ...insights,
        warnings: insightWarnings(insights, plannedRows),
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Failed to read insights' });
    }
  });
}
