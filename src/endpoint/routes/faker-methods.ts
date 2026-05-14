import type { Router } from 'express';
import { FAKER_METHODS } from '../core/faker-methods.js';

export function registerFakerMethodsRoute(router: Router): void {
  router.get('/faker-methods', async (req: any, res) => {
    if (!req.accountability?.admin) {
      return res.status(403).json({ error: 'Admin only' });
    }
    return res.json({ methods: FAKER_METHODS });
  });
}
