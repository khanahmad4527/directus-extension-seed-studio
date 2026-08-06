import { Faker, allLocales, base, en } from '@faker-js/faker';
import type { FakerLike } from '../core/rng.js';

/**
 * Faker instances for the API extension.
 *
 * The API bundle can afford every locale (it is server-side and already loads
 * faker), so a run can generate German addresses or Japanese names. Each run
 * gets its own instance: seeding a shared singleton would make concurrent runs
 * interfere with each other's reproducibility.
 */

export const AVAILABLE_LOCALES: string[] = Object.keys(allLocales).sort();

export function createFakerInstance(locale?: string | null): FakerLike {
  // `in` walks the prototype chain, so 'constructor' would "exist" and hand the
  // Faker constructor a nonsense locale. Own properties only.
  const requested = locale && isSupportedLocale(locale) ? (allLocales as any)[locale] : null;
  const locales = requested ? [requested, en, base] : [en, base];
  return new Faker({ locale: locales }) as unknown as FakerLike;
}

export function isSupportedLocale(locale: string): boolean {
  return typeof locale === 'string' && Object.prototype.hasOwnProperty.call(allLocales, locale);
}
