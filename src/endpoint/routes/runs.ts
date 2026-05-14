import type { Router } from 'express';
import { listRuns } from '../core/audit.js';

export function registerRunsRoute(
  router: Router,
  deps: { services: any; getSchema: () => Promise<any> }
): void {
  router.get('/runs', async (req: any, res) => {
    if (!req.accountability?.admin) {
      return res.status(403).json({ error: 'Admin only' });
    }
    try {
      const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '25'), 10) || 25, 1), 200);
      const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
      const schema = await deps.getSchema();
      const rows = await listRuns(deps.services, schema, req.accountability, limit, offset);
      return res.json({ runs: rows });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Failed to list runs' });
    }
  });
}
