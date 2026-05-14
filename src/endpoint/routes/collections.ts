import type { Router } from 'express';

export function registerCollectionsRoute(
  router: Router,
  deps: { services: any; getSchema: () => Promise<any> }
): void {
  router.get('/collections', async (req: any, res) => {
    if (!req.accountability?.admin) {
      return res.status(403).json({ error: 'Admin only' });
    }
    try {
      const schema = await deps.getSchema();
      const { ItemsService } = deps.services;
      const showSystem = req.query.showSystem === 'true' || req.query.showSystem === '1';

      const collections = Object.values<any>(schema.collections ?? {});
      const out: Array<{ collection: string; displayName: string; fieldCount: number; rowCount: number; isSystem: boolean }> = [];

      for (const c of collections) {
        const name: string = c.collection;
        const isSystem = name.startsWith('directus_');
        if (isSystem && !showSystem) continue;

        const fieldCount = Object.keys(c.fields ?? schema.fields?.[name] ?? {}).length;
        let rowCount = 0;
        try {
          const svc = new ItemsService(name, { schema, accountability: req.accountability });
          const agg = await svc.readByQuery({ aggregate: { count: '*' } });
          const first = Array.isArray(agg) ? agg[0] : agg;
          const v = first?.count;
          rowCount = typeof v === 'string' ? parseInt(v, 10) : Number(v ?? 0);
          if (Number.isNaN(rowCount)) rowCount = 0;
        } catch {
          rowCount = 0;
        }

        out.push({
          collection: name,
          displayName: c.meta?.name ?? name,
          fieldCount,
          rowCount,
          isSystem,
        });
      }

      out.sort((a, b) => a.collection.localeCompare(b.collection));
      return res.json({ collections: out });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Failed to list collections' });
    }
  });
}
