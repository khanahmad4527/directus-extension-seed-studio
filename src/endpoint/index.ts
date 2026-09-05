import { defineEndpoint } from '@directus/extensions-sdk';
import { ensureAuditCollections } from './audit.js';
import type { RouteDeps } from './engine-context.js';
import { registerCapabilitiesRoute } from './routes/capabilities.js';
import { registerCollectionsRoute } from './routes/collections.js';
import { registerFakerMethodsRoute } from './routes/faker-methods.js';
import { registerGenerateRoutes } from './routes/generate.js';
import { registerInsightsRoute } from './routes/insights.js';
import { registerPresetRoutes } from './routes/presets.js';
import { registerPreflightRoute } from './routes/preflight.js';
import { registerPreviewRoute } from './routes/preview.js';
import { registerProfileRoute } from './routes/profile.js';
import { registerProjectRoutes } from './routes/project.js';
import { registerRunsRoute } from './routes/runs.js';
import { registerSchemaRoute } from './routes/schema.js';

export default defineEndpoint({
  id: 'seed-studio',
  handler: (router, context) => {
    const { services, getSchema, logger, env } = context as any;
    const deps: RouteDeps = { services, getSchema, logger, env };

    router.use(async (req: any, res, next) => {
      if (!req.accountability?.admin) {
        return res.status(403).json({ error: 'Admin only' });
      }
      next();
    });

    // Read-only routes are registered first, on purpose: they answer without
    // ever creating the seed_studio_* bookkeeping collections. Opening the module
    // to look at a schema should not modify the data model.
    registerCapabilitiesRoute(router, deps);
    registerCollectionsRoute(router, deps);
    registerSchemaRoute(router, deps);
    registerFakerMethodsRoute(router);
    registerInsightsRoute(router, deps);
    registerProfileRoute(router, deps);
    registerPreviewRoute(router, deps);
    registerPreflightRoute(router, deps);

    let auditEnsured = false;
    let auditInFlight: Promise<void> | null = null;

    router.use(async (_req, _res, next) => {
      if (auditEnsured) return next();
      if (!auditInFlight) {
        auditInFlight = (async () => {
          const schema = await getSchema();
          await ensureAuditCollections(services, schema, logger, getSchema);
          auditEnsured = true;
        })().catch((err: any) => {
          logger?.warn?.({ err: err?.message }, 'Seed Studio: failed to ensure audit collections');
          auditInFlight = null;
        });
      }
      try {
        await auditInFlight;
      } catch {
        // already logged
      }
      next();
    });

    // Everything below writes, so the run history and preset collections have to
    // exist first.
    registerGenerateRoutes(router, deps);
    registerProjectRoutes(router, deps);
    registerPresetRoutes(router, deps);
    registerRunsRoute(router, deps);
  },
});
