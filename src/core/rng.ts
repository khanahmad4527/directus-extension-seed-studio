/**
 * Seeded randomness.
 *
 * The engine never imports faker directly — the host injects an instance
 * (`FakerLike`). The API extension injects one built from all 72 locales; the
 * admin app injects the English-only build so the app bundle stays small.
 *
 * Every random decision in the engine goes through this wrapper, which is what
 * makes a run reproducible: `rng.seedRow(i)` re-seeds from `baseSeed + i`, so
 * row `i` is identical no matter the batch size, the order, or whether the run
 * was resumed.
 */

export interface FakerLike {
  seed(value?: number): unknown;
  [key: string]: any;
}

export interface Rng {
  readonly faker: FakerLike;
  readonly baseSeed: number;
  /** Re-seed deterministically for a row index. */
  seedRow(rowIndex: number): void;
  int(min: number, max: number): number;
  float(min: number, max: number, fractionDigits?: number): number;
  bool(trueProbability?: number): boolean;
  chance(probability: number): boolean;
  pick<T>(items: readonly T[]): T;
  pickSome<T>(items: readonly T[], count: number): T[];
  weighted<T>(entries: ReadonlyArray<{ value: T; weight: number }>): T;
  uuid(): string;
  fromRegExp(pattern: string): string;
}

/** Ceiling for a single generated string — see `assertSafePattern`. */
export const MAX_GENERATED_LENGTH = 100_000;

/** Largest repetition a pattern may ask for: `[a-z]{50000}` is a memory attack. */
const MAX_PATTERN_REPEAT = 5_000;
const MAX_PATTERN_LENGTH = 500;

/**
 * Patterns reach the engine from request bodies (a `regex` strategy) and from
 * stored field metadata. `faker.helpers.fromRegExp` happily materialises whatever
 * a quantifier asks for, so `[a-z]{1000000000}` is an out-of-memory switch.
 * Reject the pattern rather than try to generate it.
 */
export function assertSafePattern(pattern: unknown): string {
  const value = String(pattern ?? '');
  if (value.length === 0) {
    throw new Error('Empty pattern');
  }
  if (value.length > MAX_PATTERN_LENGTH) {
    throw new Error(`Pattern is too long (${value.length} > ${MAX_PATTERN_LENGTH} characters)`);
  }
  for (const match of value.matchAll(/\{\s*(\d+)\s*(?:,\s*(\d+)\s*)?\}/g)) {
    const low = Number(match[1] ?? 0);
    const high = match[2] === undefined ? low : Number(match[2]);
    if (low > MAX_PATTERN_REPEAT || high > MAX_PATTERN_REPEAT) {
      throw new Error(`Pattern repeats too many times (max ${MAX_PATTERN_REPEAT})`);
    }
  }
  return value;
}

/** 32-bit seed derived from a string — used when the caller has no numeric seed. */
export function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h | 0);
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

export function createRng(faker: FakerLike, baseSeed: number): Rng {
  let seed = Number.isFinite(baseSeed) ? Math.abs(Math.trunc(baseSeed)) : randomSeed();
  faker.seed(seed);

  const rng: Rng = {
    faker,
    get baseSeed() {
      return seed;
    },

    seedRow(rowIndex: number) {
      // Row-local seed: stable per (run, row) and independent of batching.
      faker.seed((seed + rowIndex * 2_654_435_761) % 2_147_483_647);
    },

    int(min: number, max: number) {
      if (!Number.isFinite(min) || !Number.isFinite(max)) return 0;
      const lo = Math.min(min, max);
      const hi = Math.max(min, max);
      return faker.number.int({ min: Math.ceil(lo), max: Math.floor(hi) });
    },

    float(min: number, max: number, fractionDigits = 2) {
      const lo = Math.min(min, max);
      const hi = Math.max(min, max);
      return faker.number.float({ min: lo, max: hi, fractionDigits });
    },

    bool(trueProbability = 0.5) {
      return faker.datatype.boolean({ probability: clamp01(trueProbability) });
    },

    chance(probability: number) {
      return faker.number.float({ min: 0, max: 1, fractionDigits: 4 }) < clamp01(probability);
    },

    pick<T>(items: readonly T[]): T {
      return faker.helpers.arrayElement(items as T[]);
    },

    pickSome<T>(items: readonly T[], count: number): T[] {
      if (count <= 0 || items.length === 0) return [];
      return faker.helpers.arrayElements(items as T[], Math.min(count, items.length));
    },

    weighted<T>(entries: ReadonlyArray<{ value: T; weight: number }>): T {
      const usable = entries.filter((e) => Number.isFinite(e.weight) && e.weight > 0);
      if (usable.length === 0) return faker.helpers.arrayElement(entries as any).value;
      return faker.helpers.weightedArrayElement(usable as any) as T;
    },

    uuid() {
      return faker.string.uuid();
    },

    fromRegExp(pattern: string) {
      // faker treats `^` and `$` as literal characters, so an anchored pattern
      // would generate "^INV-12345$". Anchors are implicit here anyway.
      const unanchored = assertSafePattern(pattern).replace(/^\^/, '').replace(/\$$/, '');
      const value = String(faker.helpers.fromRegExp(unanchored));
      return value.length > MAX_GENERATED_LENGTH ? value.slice(0, MAX_GENERATED_LENGTH) : value;
    },
  };

  return rng;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
