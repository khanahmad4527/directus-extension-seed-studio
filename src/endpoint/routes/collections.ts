import type { ResponseLike, Router } from '../express-types.js';
import { resolveDisplayName } from '../../core/schema-model.js';
import { buildEngine, type RouteDeps } from '../engine-context.js';

const SEED_STUDIO_PREFIX = 'seed_studio_';

export function registerCollectionsRoute(router: Router, deps: RouteDeps): void {
  router.get('/collections', async (req: any, res: ResponseLike) => {
    try {
      const engine = await buildEngine(req, deps);
      const showSystem = req.query.showSystem === 'true' || req.query.showSystem === '1';
      const collections = await engine.ds.listCollections();

      const visible = collections.filter((collection) => {
        const name = collection.collection;
        if (name.startsWith(SEED_STUDIO_PREFIX)) return true;
        return name.startsWith('directus_') ? showSystem : true;
      });

      const out = await Promise.all(
        visible.map(async (collection) => {
          const name = collection.collection;
          const overview = engine.schema.collections?.[name];
          return {
            collection: name,
            displayName: resolveDisplayName(name, collection),
            fieldCount: Object.keys(overview?.fields ?? collection.fields ?? {}).length,
            rowCount: await engine.ds.count(name),
            isSystem: name.startsWith('directus_'),
            singleton: Boolean(collection.singleton),
          };
        })
      );

      out.sort((a, b) => a.collection.localeCompare(b.collection));
      return res.json({ collections: out });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Failed to list collections' });
    }
  });
}
