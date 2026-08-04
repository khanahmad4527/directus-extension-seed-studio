import type { ResponseLike, Router } from '../express-types.js';
import { FAKER_METHODS, FAKER_MODULES } from '../../core/faker-methods.js';
import { AVAILABLE_LOCALES } from '../faker-host.js';

export function registerFakerMethodsRoute(router: Router): void {
  router.get('/faker-methods', async (_req: any, res: ResponseLike) => {
    return res.json({
      methods: FAKER_METHODS,
      modules: [...FAKER_MODULES].sort(),
      locales: AVAILABLE_LOCALES,
    });
  });
}
