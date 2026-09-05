import type { ResponseLike, Router } from '../express-types.js';
import { preflightDependencies } from '../../core/preflight.js';
import { classifySeedTarget } from '../../core/seed-targets.js';
import { validateRowCount } from '../../core/request-validation.js';
import { buildEngine, type RouteDeps } from '../engine-context.js';

/**
 * Answer "can this collection be generated right now, and if not, what has to
 * be seeded first" before any rows are written. Read-only: it counts rows and
 * reads relations, and never touches the bookkeeping collections.
 */
export function registerPreflightRoute(router: Router, deps: RouteDeps): void {
  router.get('/preflight/:collection', async (req: any, res: ResponseLike) => {
    try {
      const collection = req.params.collection;
      const verdict = classifySeedTarget(collection);
      if (!verdict.seedable) {
        return res.status(400).json({ error: `"${collection}" cannot be seeded: ${verdict.reason}` });
      }

      const count = parseInt(String(req.query.count ?? '100'), 10) || 100;
      try {
        validateRowCount(count);
      } catch (err: any) {
        return res.status(400).json({ error: err?.message ?? 'count is invalid' });
      }

      const engine = await buildEngine(req, deps);
      const result = await preflightDependencies(engine.ds, collection, count);
      return res.json(result);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Failed to run preflight' });
    }
  });
}
