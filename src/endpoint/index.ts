import { defineEndpoint } from '@directus/extensions-sdk';
import { registerCollectionsRoute } from './routes/collections.js';
import { registerSchemaRoute } from './routes/schema.js';
import { registerPreviewRoute } from './routes/preview.js';
import { registerGenerateRoutes } from './routes/generate.js';
import { registerPresetRoutes } from './routes/presets.js';
import { registerRunsRoute } from './routes/runs.js';
import { registerFakerMethodsRoute } from './routes/faker-methods.js';
import { ensureAuditCollections } from './core/audit.js';

export default defineEndpoint({
  id: 'seed-studio',
  handler: (router, { services, getSchema, logger }) => {
    router.use(async (req: any, res, next) => {
      if (!req.accountability?.admin) {
        return res.status(403).json({ error: 'Admin only' });
      }
      next();
    });

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

    registerCollectionsRoute(router, { services, getSchema });
    registerSchemaRoute(router, { services, getSchema });
    registerPreviewRoute(router, { services, getSchema, logger });
    registerGenerateRoutes(router, { services, getSchema, logger });
    registerPresetRoutes(router, { services, getSchema });
    registerRunsRoute(router, { services, getSchema });
    registerFakerMethodsRoute(router);
  },
});
