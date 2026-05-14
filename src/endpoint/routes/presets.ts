import type { Router } from 'express';
import { createPreset, deletePreset, listPresets } from '../core/audit.js';

export function registerPresetRoutes(
  router: Router,
  deps: { services: any; getSchema: () => Promise<any> }
): void {
  router.get('/presets/:collection', async (req: any, res) => {
    if (!req.accountability?.admin) {
      return res.status(403).json({ error: 'Admin only' });
    }
    try {
      const schema = await deps.getSchema();
      const rows = await listPresets(deps.services, schema, req.accountability, req.params.collection);
      return res.json({ presets: rows });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Failed to list presets' });
    }
  });

  router.post('/presets', async (req: any, res) => {
    if (!req.accountability?.admin) {
      return res.status(403).json({ error: 'Admin only' });
    }
    try {
      const { name, collection, strategies } = req.body ?? {};
      if (!name || !collection || !strategies) {
        return res.status(400).json({ error: 'name, collection, and strategies are required' });
      }
      const schema = await deps.getSchema();
      const id = await createPreset(deps.services, schema, req.accountability, {
        name,
        collection,
        strategies,
      });
      return res.json({ id });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Failed to save preset' });
    }
  });

  router.delete('/presets/:id', async (req: any, res) => {
    if (!req.accountability?.admin) {
      return res.status(403).json({ error: 'Admin only' });
    }
    try {
      const schema = await deps.getSchema();
      await deletePreset(deps.services, schema, req.accountability, req.params.id);
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Failed to delete preset' });
    }
  });
}
