import { assertSafePattern } from './rng.js';
import { isEntityPath } from './entity.js';
import { isValidFakerPath } from './faker-methods.js';
import type { GenerationStrategy, StrategyKind, StrategyMap } from './types.js';

/**
 * Validation for values that arrive from a request body.
 *
 * Strategy maps are posted as free-form JSON. Without a gate, a malformed entry
 * turns into a silent `null` for every row (the executor swallows the error), or
 * a surprising payload — a `fixed` strategy carrying a megabyte of JSON, a
 * `random_choice` with 100k options. Rejecting with a clear message beats
 * generating 100,000 rows of nothing.
 */

/** Keys that would mutate an object's prototype rather than set a column. */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isUnsafeFieldName(name: string): boolean {
  return UNSAFE_KEYS.has(name);
}

const KNOWN_KINDS = new Set<StrategyKind>([
  'system',
  'skip',
  'null',
  'fixed',
  'faker',
  'random_choice',
  'weighted_choice',
  'random_int',
  'random_float',
  'random_date',
  'random_boolean',
  'uuid',
  'sequence',
  'm2o_random',
  'file_reuse',
  'lorem_paragraphs',
  'random_user_collection',
  'random_item_of_field',
  'coherent',
  'template',
  'regex',
  'geometry',
  'markdown',
  'html',
  'm2m_random',
]);

export const LIMITS = {
  /** Rows in a single run. Above this, use several runs — or a migration. */
  maxRowsPerRun: 1_000_000,
  maxChoices: 5_000,
  maxTemplateLength: 2_000,
  maxFixedBytes: 64 * 1024,
  maxParagraphs: 200,
  maxM2mLinks: 100,
  maxCollectionsPerProject: 50,
  /** Audit columns should hold a message, not a 500-row INSERT statement. */
  maxErrorMessage: 2_000,
} as const;

export class ValidationError extends Error {}

function fail(field: string, message: string): never {
  throw new ValidationError(`Invalid strategy for "${field}": ${message}`);
}

/** Throws `ValidationError` on the first malformed entry. */
export function validateStrategyMap(strategies: unknown): asserts strategies is StrategyMap {
  if (!strategies || typeof strategies !== 'object' || Array.isArray(strategies)) {
    throw new ValidationError('strategies must be an object keyed by field name');
  }

  for (const [field, strategy] of Object.entries(strategies as Record<string, unknown>)) {
    if (isUnsafeFieldName(field)) {
      throw new ValidationError(`Refusing a strategy for the reserved key "${field}"`);
    }
    validateStrategy(field, strategy);
  }
}

export function validateStrategy(field: string, input: unknown): asserts input is GenerationStrategy {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail(field, 'expected an object with a "kind"');
  }
  const strategy = input as Record<string, any>;
  const kind = strategy.kind;
  if (typeof kind !== 'string' || !KNOWN_KINDS.has(kind as StrategyKind)) {
    fail(field, `unknown kind "${String(kind)}"`);
  }

  if (strategy.nullRate !== undefined) {
    const rate = Number(strategy.nullRate);
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) {
      fail(field, 'nullRate must be between 0 and 1');
    }
  }

  switch (kind) {
    case 'fixed': {
      const size = roughSize(strategy.value);
      if (size > LIMITS.maxFixedBytes) {
        fail(field, `fixed value is too large (${size} bytes)`);
      }
      break;
    }
    case 'faker':
      if (!isValidFakerPath(strategy.method)) {
        fail(field, `"${String(strategy.method)}" is not a valid faker <module>.<method>`);
      }
      if (strategy.args !== undefined && !Array.isArray(strategy.args)) {
        fail(field, 'args must be an array');
      }
      break;
    case 'random_choice':
      if (!Array.isArray(strategy.choices) || strategy.choices.length === 0) {
        fail(field, 'choices must be a non-empty array');
      }
      if (strategy.choices.length > LIMITS.maxChoices) {
        fail(field, `too many choices (${strategy.choices.length})`);
      }
      break;
    case 'weighted_choice': {
      if (!Array.isArray(strategy.choices) || strategy.choices.length === 0) {
        fail(field, 'choices must be a non-empty array of { value, weight }');
      }
      if (strategy.choices.length > LIMITS.maxChoices) {
        fail(field, `too many choices (${strategy.choices.length})`);
      }
      const usable = strategy.choices.filter(
        (choice: any) => choice && typeof choice === 'object' && Number(choice.weight) > 0
      );
      if (usable.length === 0) {
        fail(field, 'at least one choice needs a positive weight');
      }
      break;
    }
    case 'random_int':
    case 'random_float':
      requireFinite(field, strategy.min, 'min');
      requireFinite(field, strategy.max, 'max');
      if (kind === 'random_float') {
        const digits = Number(strategy.fractionDigits ?? 2);
        if (!Number.isInteger(digits) || digits < 0 || digits > 10) {
          fail(field, 'fractionDigits must be an integer between 0 and 10');
        }
      }
      break;
    case 'random_date':
      requireFinite(field, strategy.daysBack, 'daysBack');
      requireFinite(field, strategy.daysForward, 'daysForward');
      if (Number(strategy.daysBack) < 0 || Number(strategy.daysForward) < 0) {
        fail(field, 'daysBack and daysForward cannot be negative');
      }
      break;
    case 'random_boolean': {
      const probability = Number(strategy.trueProbability);
      if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
        fail(field, 'trueProbability must be between 0 and 1');
      }
      break;
    }
    case 'sequence':
      if (typeof strategy.pattern !== 'string' || strategy.pattern.length === 0) {
        fail(field, 'pattern must be a non-empty string');
      }
      break;
    case 'm2o_random':
      requireCollectionName(field, strategy.relatedCollection);
      break;
    case 'file_reuse':
      if (strategy.mimeFilter !== undefined && typeof strategy.mimeFilter !== 'string') {
        fail(field, 'mimeFilter must be a string');
      }
      break;
    case 'lorem_paragraphs': {
      const count = Number(strategy.count);
      if (!Number.isInteger(count) || count < 1 || count > LIMITS.maxParagraphs) {
        fail(field, `count must be between 1 and ${LIMITS.maxParagraphs}`);
      }
      break;
    }
    case 'markdown':
    case 'html': {
      const paragraphs = Number(strategy.paragraphs ?? 3);
      if (!Number.isInteger(paragraphs) || paragraphs < 1 || paragraphs > LIMITS.maxParagraphs) {
        fail(field, `paragraphs must be between 1 and ${LIMITS.maxParagraphs}`);
      }
      break;
    }
    case 'random_item_of_field':
      if (typeof strategy.collectionField !== 'string' || strategy.collectionField.length === 0) {
        fail(field, 'collectionField must be a field name');
      }
      break;
    case 'coherent':
      if (!isEntityPath(strategy.trait)) {
        fail(field, `"${String(strategy.trait)}" is not a known entity trait`);
      }
      break;
    case 'template':
      if (typeof strategy.template !== 'string') {
        fail(field, 'template must be a string');
      }
      if (strategy.template.length > LIMITS.maxTemplateLength) {
        fail(field, `template is too long (${strategy.template.length} characters)`);
      }
      break;
    case 'regex':
      try {
        assertSafePattern(strategy.pattern);
      } catch (err: any) {
        fail(field, err?.message ?? 'invalid pattern');
      }
      break;
    case 'geometry':
      if (strategy.bbox !== undefined) {
        if (!Array.isArray(strategy.bbox) || strategy.bbox.length !== 4 || !strategy.bbox.every((n: any) => Number.isFinite(Number(n)))) {
          fail(field, 'bbox must be [minLng, minLat, maxLng, maxLat]');
        }
      }
      break;
    case 'm2m_random': {
      const min = Number(strategy.min);
      const max = Number(strategy.max);
      if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min) {
        fail(field, 'min and max must be integers with min ≤ max');
      }
      if (max > LIMITS.maxM2mLinks) {
        fail(field, `max is capped at ${LIMITS.maxM2mLinks} links per row`);
      }
      break;
    }
    default:
      break;
  }
}

/** Row counts arrive from request bodies too. */
export function validateRowCount(count: unknown, label = 'count'): number {
  const value = Number(count);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new ValidationError(`${label} must be a positive integer`);
  }
  if (value > LIMITS.maxRowsPerRun) {
    throw new ValidationError(
      `${label} is capped at ${LIMITS.maxRowsPerRun.toLocaleString()} rows per run`
    );
  }
  return value;
}

export function truncateMessage(message: unknown, max: number = LIMITS.maxErrorMessage): string {
  const text = String(message ?? '');
  return text.length <= max ? text : `${text.slice(0, max)}… (truncated)`;
}

function requireFinite(field: string, value: unknown, name: string): void {
  if (!Number.isFinite(Number(value))) fail(field, `${name} must be a number`);
}

function requireCollectionName(field: string, value: unknown): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    fail(field, 'relatedCollection must be a collection name');
  }
}

function roughSize(value: unknown): number {
  try {
    return JSON.stringify(value ?? null)?.length ?? 0;
  } catch {
    return Infinity;
  }
}
