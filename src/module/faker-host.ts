import { faker as fakerEN } from '@faker-js/faker/locale/en';
import type { FakerLike } from '../core/rng.js';

/**
 * Faker for the in-browser engine.
 *
 * Deliberately the single-locale entry point rather than `@faker-js/faker`:
 * the full package carries 72 locale datasets, and this bundle is downloaded by
 * every admin app user on load. Runs that need another locale use the API
 * engine, which has them all — the UI disables the locale picker otherwise.
 */
export function createAppFaker(): FakerLike {
  return fakerEN as unknown as FakerLike;
}

export const APP_LOCALES = ['en'];
