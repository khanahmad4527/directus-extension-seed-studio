import type { ResponseLike, Router } from '../express-types.js';
import { undoRun } from '../../core/generator.js';
import type { PrimaryKey } from '../../core/types.js';
import { listRuns, readRun, updateAuditEnd } from '../audit.js';
import { buildEngine, type RouteDeps } from '../engine-context.js';

export function registerRunsRoute(router: Router, deps: RouteDeps): void {
  router.get('/runs', async (req: any, res: ResponseLike) => {
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

  /**
   * Undo a run.
   *
   * Every generation records the primary keys it created, so a mistake can be
   * reversed exactly — no "delete everything and hope nothing real was in there".
   */
  router.post('/runs/:id/undo', async (req: any, res: ResponseLike) => {
    try {
      const engine = await buildEngine(req, deps);
      const run = await readRun(deps.services, engine.schema, req.accountability, req.params.id);
      if (!run) return res.status(404).json({ error: 'Run not found' });
      if (run.status === 'undone') return res.status(409).json({ error: 'This run was already undone' });

      const ids = (run.created_ids ?? []) as PrimaryKey[];
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(409).json({
          error: 'This run has no recorded row ids, so it cannot be undone. Delete the rows manually.',
        });
      }

      const deleted = await undoRun(engine.ds, run.collection, ids);

      await updateAuditEnd(deps.services, engine.schema, req.accountability, req.params.id, {
        status: 'undone',
        undoable: false,
        completed_at: new Date().toISOString(),
      }).catch(() => undefined);

      return res.json({ ok: true, deleted, collection: run.collection });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message ?? 'Undo failed' });
    }
  });
}
