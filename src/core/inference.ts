import type { SeedDataSource } from './data-source.js';
import type { CollectionDescriptor, GenerationStrategy, WeightedChoice } from './types.js';

/**
 * Data-aware inference.
 *
 * Schema metadata says a column is a `string`; the rows already in it say the
 * strings are `INV-04812`, that 8% are null, and that `status` is 71% published.
 * This module reads what is already there — with aggregates and a small sample,
 * never a full table scan — and proposes strategies that reproduce the shape of
 * the real data instead of generic lorem.
 */

export interface FieldProfile {
  field: string;
  nullRate: number;
  sampleSize: number;
  distinctCount?: number;
  topValues?: Array<{ value: unknown; count: number }>;
  min?: number | null;
  max?: number | null;
  avg?: number | null;
  avgLength?: number;
  patternGuess?: string | null;
  suggested?: GenerationStrategy;
  confidence: 'high' | 'medium' | 'low';
  note: string;
}

export interface ProfileResult {
  collection: string;
  sampleSize: number;
  profiles: FieldProfile[];
}

const NUMERIC_TYPES = new Set(['integer', 'bigInteger', 'float', 'decimal']);
const TEXT_TYPES = new Set(['string', 'text']);
const DATE_TYPES = new Set(['date', 'dateTime', 'timestamp']);
const LOW_CARDINALITY_MAX = 25;

export async function profileCollection(
  ds: SeedDataSource,
  descriptor: CollectionDescriptor,
  sampleSize = 300
): Promise<ProfileResult> {
  const candidates = descriptor.fields.filter(
    (f) => !f.isAlias && !f.isPrimaryKey && !f.isSystemField && !f.relation
  );

  if (descriptor.rowCount === 0 || candidates.length === 0) {
    return { collection: descriptor.collection, sampleSize: 0, profiles: [] };
  }

  const fieldNames = candidates.map((f) => f.field);
  const { rows, unreadable } = await sampleTolerant(ds, descriptor.collection, fieldNames, sampleSize);

  const profiles: FieldProfile[] = [];

  for (const field of candidates) {
    // A column we could not read tells us nothing. Reporting it as "100% empty"
    // would suggest always leaving it blank, on the strength of a failed query.
    if (unreadable.has(field.field)) {
      profiles.push({
        field: field.field,
        nullRate: 0,
        sampleSize: 0,
        confidence: 'low',
        note: 'Could not be read from the database, so nothing was inferred for it.',
      });
      continue;
    }

    const values = rows.map((row) => row[field.field]);
    const nonNull = values.filter((v) => v !== null && v !== undefined && v !== '');
    const nullRate = values.length > 0 ? 1 - nonNull.length / values.length : 0;
    const distinct = new Set(nonNull.map((v) => String(v)));

    const profile: FieldProfile = {
      field: field.field,
      nullRate: round(nullRate, 3),
      sampleSize: values.length,
      distinctCount: distinct.size,
      confidence: 'low',
      note: 'Not enough signal — kept the schema-based guess.',
    };

    // Enum-like: few distinct values relative to the sample.
    const enumEligible = TEXT_TYPES.has(field.type) || field.type === 'integer' || field.type === 'csv';
    if (
      enumEligible &&
      nonNull.length >= 10 &&
      distinct.size > 0 &&
      distinct.size <= LOW_CARDINALITY_MAX &&
      distinct.size <= Math.max(2, nonNull.length * 0.4)
    ) {
      let groups: Array<{ value: unknown; count: number }> = [];
      try {
        groups = await ds.groupCount(descriptor.collection, field.field, LOW_CARDINALITY_MAX);
      } catch {
        groups = countLocally(nonNull);
      }
      if (groups.length === 0) groups = countLocally(nonNull);

      const choices: WeightedChoice[] = groups
        .filter((g) => g.value !== null && g.value !== undefined)
        .map((g) => ({ value: g.value, weight: Math.max(1, g.count) }));

      if (choices.length > 0) {
        profile.topValues = groups.slice(0, 10);
        profile.suggested = withNullRate({ kind: 'weighted_choice', choices }, nullRate, field.required);
        profile.confidence = 'high';
        profile.note = `${choices.length} distinct values in the existing rows — reused with their real frequencies.`;
        profiles.push(profile);
        continue;
      }
    }

    if (NUMERIC_TYPES.has(field.type)) {
      let stats = { min: null as number | null, max: null as number | null, avg: null as number | null, count: 0 };
      try {
        stats = await ds.numericStats(descriptor.collection, field.field);
      } catch {
        const nums = nonNull.map(Number).filter((n) => Number.isFinite(n));
        stats = {
          min: nums.length ? Math.min(...nums) : null,
          max: nums.length ? Math.max(...nums) : null,
          avg: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null,
          count: nums.length,
        };
      }
      profile.min = stats.min;
      profile.max = stats.max;
      profile.avg = stats.avg === null ? null : round(stats.avg, 2);

      if (stats.min !== null && stats.max !== null && stats.max >= stats.min) {
        const isInt = field.type === 'integer' || field.type === 'bigInteger';
        profile.suggested = withNullRate(
          isInt
            ? { kind: 'random_int', min: Math.floor(stats.min), max: Math.ceil(stats.max) }
            : { kind: 'random_float', min: stats.min, max: stats.max, fractionDigits: field.numericScale ?? 2 },
          nullRate,
          field.required
        );
        profile.confidence = 'high';
        profile.note = `Existing values run ${stats.min} – ${stats.max}; generated values stay in range.`;
        profiles.push(profile);
        continue;
      }
    }

    if (TEXT_TYPES.has(field.type) && nonNull.length >= 8) {
      const strings = nonNull.map((v) => String(v));
      profile.avgLength = Math.round(strings.reduce((sum, s) => sum + s.length, 0) / strings.length);

      const pattern = inferPattern(strings);
      if (pattern) {
        profile.patternGuess = pattern;
        profile.suggested = withNullRate({ kind: 'regex', pattern }, nullRate, field.required);
        profile.confidence = 'high';
        profile.note = `Every sampled value matches ${pattern} — generated values follow the same format.`;
        profiles.push(profile);
        continue;
      }

      if (nullRate > 0.05 && !field.required) {
        profile.suggested = withNullRate(field.suggestedStrategy, nullRate, field.required);
        profile.confidence = 'medium';
        profile.note = `${Math.round(nullRate * 100)}% of existing rows leave this empty — matched that rate.`;
        profiles.push(profile);
        continue;
      }
    }

    if (DATE_TYPES.has(field.type) && nonNull.length >= 5) {
      const times = nonNull
        .map((v) => new Date(String(v)).getTime())
        .filter((t) => Number.isFinite(t));
      if (times.length >= 5) {
        const oldest = Math.min(...times);
        const newest = Math.max(...times);
        const daysBack = Math.max(1, Math.round((Date.now() - oldest) / 86_400_000));
        const daysForward = Math.max(0, Math.round((newest - Date.now()) / 86_400_000));
        profile.suggested = withNullRate(
          { kind: 'random_date', daysBack, daysForward, skew: 'recent' },
          nullRate,
          field.required
        );
        profile.confidence = 'medium';
        profile.note = `Existing dates span the last ${daysBack} days${
          daysForward > 0 ? ` and up to ${daysForward} days ahead` : ''
        }.`;
        profiles.push(profile);
        continue;
      }
    }

    if (nullRate > 0.05 && !field.required) {
      profile.suggested = withNullRate(field.suggestedStrategy, nullRate, field.required);
      profile.confidence = 'medium';
      profile.note = `${Math.round(nullRate * 100)}% of existing rows leave this empty — matched that rate.`;
    }

    profiles.push(profile);
  }

  return { collection: descriptor.collection, sampleSize: rows.length, profiles };
}

/**
 * Read a sample without letting one unreadable column silence the whole pass.
 *
 * A single field can fail the query for reasons that have nothing to do with the
 * others — a geometry column on a database with no spatial functions, a field
 * the role cannot read. Falling back to per-field reads costs extra queries only
 * in that degraded case, and profiles everything that *is* readable.
 */
async function sampleTolerant(
  ds: SeedDataSource,
  collection: string,
  fields: string[],
  limit: number
): Promise<{ rows: Record<string, unknown>[]; unreadable: Set<string> }> {
  const unreadable = new Set<string>();
  if (fields.length === 0) return { rows: [], unreadable };

  try {
    const rows = await ds.sample(collection, fields, limit);
    // An empty result from a collection that has rows means the read did not
    // really succeed — some adapters answer an error with an empty list rather
    // than throwing. Fall through and find out which column is at fault.
    if (rows.length > 0) return { rows, unreadable };
  } catch {
    // fall through to per-field reads
  }

  const merged: Record<string, unknown>[] = [];
  for (const field of fields) {
    try {
      const rows = await ds.sample(collection, [field], limit);
      rows.forEach((row, index) => {
        merged[index] = { ...(merged[index] ?? {}), ...row };
      });
    } catch {
      unreadable.add(field);
    }
  }
  return { rows: merged, unreadable };
}

function withNullRate(
  strategy: GenerationStrategy,
  nullRate: number,
  required: boolean
): GenerationStrategy {
  if (required || nullRate < 0.02) return strategy;
  return { ...strategy, nullRate: round(Math.min(nullRate, 0.9), 2) };
}

function countLocally(values: unknown[]): Array<{ value: unknown; count: number }> {
  const counts = new Map<string, { value: unknown; count: number }>();
  for (const value of values) {
    const key = String(value);
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { value, count: 1 });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

/**
 * Collapse values to a shape (`ABC-12345` → `AAA-99999`) and, if every sample
 * shares one shape, turn it back into a regex the generator can satisfy.
 */
export function inferPattern(values: string[]): string | null {
  if (values.length < 8) return null;

  const shapes = new Set(values.map(toShape));
  if (shapes.size !== 1) return null;

  const shape = [...shapes][0]!;
  if (shape.length === 0 || shape.length > 40) return null;
  // A shape that is all letters is just a word — not a useful pattern.
  if (/^A+$/.test(shape) || /^a+$/.test(shape)) return null;
  if (!/[9]/.test(shape) && !/[^Aa9]/.test(shape)) return null;

  return `^${shapeToRegex(shape)}$`;
}

function toShape(value: string): string {
  return value
    .slice(0, 40)
    .replace(/[A-Z]/g, 'A')
    .replace(/[a-z]/g, 'a')
    .replace(/[0-9]/g, '9');
}

function shapeToRegex(shape: string): string {
  let out = '';
  let index = 0;
  while (index < shape.length) {
    const char = shape[index]!;
    let run = 1;
    while (shape[index + run] === char) run += 1;
    const quantifier = run > 1 ? `{${run}}` : '';
    if (char === 'A') out += `[A-Z]${quantifier}`;
    else if (char === 'a') out += `[a-z]${quantifier}`;
    else if (char === '9') out += `[0-9]${quantifier}`;
    else out += `${escapeRegex(char)}${quantifier}`;
    index += run;
  }
  return out;
}

function escapeRegex(char: string): string {
  return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
