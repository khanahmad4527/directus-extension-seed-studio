import type { ResponseLike, Router } from '../express-types.js';
import { createPreset, deletePreset, listPresets } from '../audit.js';
import { isSeedStudioCollection } from '../../core/seed-targets.js';
import { sanitiseOptions, type RouteDeps } from '../engine-context.js';

export function registerPresetRoutes(router: Router, deps: RouteDeps): void {
  router.get('/presets/:collection', async (req: any, res: ResponseLike) => {
    try {
      if (isSeedStudioCollection(req.params.collection)) {
        return res.status(404).json({ error: 'Collection not found' });
      }
      const schema = await deps.getSchema();
      const rows = await listPresets(deps.services, schema, req.accountability, req.params.collection);
      return res.json({ presets: rows });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Failed to list presets' });
    }
  });

  router.post('/presets', async (req: any, res: ResponseLike) => {
    try {
      const { name, collection, strategies, options } = req.body ?? {};
      if (!name || !collection || !strategies) {
        return res.status(400).json({ error: 'name, collection, and strategies are required' });
      }
      if (isSeedStudioCollection(collection)) {
        return res.status(400).json({ error: 'Collection not found' });
      }
      const schema = await deps.getSchema();
      const id = await createPreset(deps.services, schema, req.accountability, {
        name,
        collection,
        strategies,
        options: options ? sanitiseOptions(options) : null,
      });
      return res.json({ id });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Failed to save preset' });
    }
  });

  router.delete('/presets/:id', async (req: any, res: ResponseLike) => {
    try {
      const schema = await deps.getSchema();
      await deletePreset(deps.services, schema, req.accountability, req.params.id);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Failed to delete preset' });
    }
  });
}
