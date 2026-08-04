import type { ResponseLike, Router } from '../express-types.js';
import { FAKER_METHODS } from '../../core/faker-methods.js';
import { AVAILABLE_LOCALES } from '../faker-host.js';
import { runRegistry } from '../run-registry.js';
import type { RouteDeps } from '../engine-context.js';
import { buildEngine } from '../engine-context.js';

/**
 * What this engine can do.
 *
 * The admin app calls this first. If the endpoint is missing — Directus Cloud,
 * or an install that only deployed the app extension — the app falls back to its
 * own in-browser engine and adjusts the UI to the capabilities it has left.
 */
export function registerCapabilitiesRoute(router: Router, deps: RouteDeps): void {
  router.get('/capabilities', async (req: any, res: ResponseLike) => {
    try {
      const engine = await buildEngine(req, deps);
      const environment = await engine.ds.environment();

      return res.json({
        engine: 'api',
        capabilities: engine.ds.capabilities,
        locales: AVAILABLE_LOCALES,
        fakerMethods: FAKER_METHODS.length,
        activeRuns: runRegistry.list().map((run) => ({
          runId: run.runId,
          collection: run.collection,
          requested: run.requested,
          startedAt: run.startedAt,
        })),
        environment,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Failed to read capabilities' });
    }
  });
}
