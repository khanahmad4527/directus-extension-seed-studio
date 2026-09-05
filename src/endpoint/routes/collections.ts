import type { ResponseLike, Router } from '../express-types.js';
import { resolveDisplayName } from '../../core/schema-model.js';
import { classifySeedTarget, isSeedStudioCollection, isSystemCollection } from '../../core/seed-targets.js';
import { buildEngine, type RouteDeps } from '../engine-context.js';

export function registerCollectionsRoute(router: Router, deps: RouteDeps): void {
  router.get('/collections', async (req: any, res: ResponseLike) => {
    try {
      const engine = await buildEngine(req, deps);
      const showSystem = req.query.showSystem === 'true' || req.query.showSystem === '1';
      const collections = await engine.ds.listCollections();

      const visible = collections.filter((collection) => {
        const name = collection.collection;
        // Seed Studio's own run history and presets are never a seed target —
        // generating into them would forge the audit trail the Undo button
        // reads back. They stay out of the list even with System enabled.
        if (isSeedStudioCollection(name)) return false;
        return isSystemCollection(name) ? showSystem : true;
      });

      const out = await Promise.all(
        visible.map(async (collection) => {
          const name = collection.collection;
          const overview = engine.schema.collections?.[name];
          const verdict = classifySeedTarget(name);
          return {
            collection: name,
            displayName: resolveDisplayName(name, collection),
            fieldCount: Object.keys(overview?.fields ?? collection.fields ?? {}).length,
            // Counting rows means a query per collection. A blocked collection
            // cannot be selected, so the number would only ever be decoration.
            rowCount: verdict.seedable ? await engine.ds.count(name) : 0,
            isSystem: isSystemCollection(name),
            singleton: Boolean(collection.singleton),
            seedable: verdict.seedable,
            blockedReason: verdict.reason ?? null,
            blockedCategory: verdict.category ?? null,
            warning: verdict.warning ?? null,
          };
        })
      );

      // Seedable first, then blocked — a user scanning the grid should meet the
      // collections they can actually use before the ones they cannot.
      out.sort((a, b) => {
        if (a.seedable !== b.seedable) return a.seedable ? -1 : 1;
        return a.collection.localeCompare(b.collection);
      });
      return res.json({ collections: out });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Failed to list collections' });
    }
  });
}
