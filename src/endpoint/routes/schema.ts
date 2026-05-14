import type { Router } from 'express';
import { buildCollectionDescriptor } from '../core/schema-reader.js';

export function registerSchemaRoute(
  router: Router,
  deps: { services: any; getSchema: () => Promise<any> }
): void {
  router.get('/schema/:collection', async (req: any, res) => {
    if (!req.accountability?.admin) {
      return res.status(403).json({ error: 'Admin only' });
    }
    try {
      const schema = await deps.getSchema();
      const descriptor = await buildCollectionDescriptor(
        req.params.collection,
        deps.services,
        schema,
        req.accountability
      );
      return res.json(descriptor);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Failed to read schema' });
    }
  });
}
