import type { ResponseLike, Router } from '../express-types.js';
import { runPreview } from '../../core/generator.js';
import { truncateMessage } from '../../core/request-validation.js';
import { classifySeedTarget } from '../../core/seed-targets.js';
import { buildEngine, sanitiseOptions, type RouteDeps } from '../engine-context.js';
import { wrapLogger } from '../logger.js';

/**
 * Preview doubles as a dry run: rows are built and then checked against the
 * same rules Directus enforces, so the response says which rows would fail and
 * what the invariant pass had to repair.
 */
export function registerPreviewRoute(router: Router, deps: RouteDeps): void {
  router.post('/preview', async (req: any, res: ResponseLike) => {
    try {
      const body = req.body ?? {};
      if (!body.collection || typeof body.collection !== 'string') {
        return res.status(400).json({ error: 'collection is required' });
      }
      if (!body.strategies || typeof body.strategies !== 'object') {
        return res.status(400).json({ error: 'strategies is required' });
      }
      const verdict = classifySeedTarget(body.collection);
      if (!verdict.seedable) {
        return res.status(400).json({ error: `"${body.collection}" cannot be seeded: ${verdict.reason}` });
      }

      const options = sanitiseOptions(body.options);
      const engine = await buildEngine(req, deps, options);

      const result = await runPreview(
        {
          collection: body.collection,
          strategies: body.strategies,
          count: body.count ?? 10,
          options,
        },
        { ds: engine.ds, rng: engine.rng, logger: wrapLogger(deps.logger) }
      );

      return res.json({
        rows: result.rows,
        issues: result.issues,
        changes: result.changes,
        seed: result.seed,
        now: result.now,
      });
    } catch (err: any) {
      return res.status(400).json({ error: truncateMessage(err?.message ?? 'Preview failed', 500) });
    }
  });
}
