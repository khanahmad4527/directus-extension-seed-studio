import { compileConstraints, matchesFilter } from './filter-ast.js';
import type { FieldConstraints, FieldDescriptor, RowIssue } from './types.js';
import type { RawField } from './data-source.js';

export function extractMaxLength(field: any): number | null {
  const schemaMax = field?.schema?.max_length;
  if (typeof schemaMax === 'number' && schemaMax > 0) return schemaMax;
  const optionMax = field?.meta?.options?.softLength;
  if (typeof optionMax === 'number' && optionMax > 0) return optionMax;
  return null;
}

export function extractIsUnique(field: any): boolean {
  return Boolean(field?.schema?.is_unique);
}

/**
 * Widest value each integer type can hold. Postgres reports `numeric_precision`
 * for these columns as a bit count (16/32/64), not a digit count, so the
 * decimal(p, s) formula below must never be applied to them — reading 32 as
 * "32 digits" yields a 10^32 ceiling and the database rejects the insert with
 * `invalid input syntax for type integer`.
 */
const INTEGER_LIMITS: Record<string, { min: number; max: number }> = {
  integer: { min: -2_147_483_648, max: 2_147_483_647 },
  // int8 exceeds Number.MAX_SAFE_INTEGER; stop there so generated values stay
  // exactly representable in JS and survive JSON round-tripping.
  bigInteger: { min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER },
};

/** Types where `numeric_precision` really does mean decimal digits. */
const DECIMAL_TYPES = new Set(['decimal', 'float', 'double', 'number']);

/**
 * Narrow `constraints` to what the underlying column can physically store.
 *
 * Integer columns only ever tighten a bound the user already asked for. They
 * must not introduce one: the detector picks a deliberately human-scale default
 * range (1–10000) for a bare integer, and injecting int4's ±2.1 billion here
 * would override that and make every counter field absurd. Decimal columns are
 * the opposite case — `decimal(5,2)` genuinely cannot hold 1000, so the bound
 * is real information and worth introducing.
 */
function applyColumnRange(raw: RawField, constraints: FieldConstraints): void {
  const type = (raw as any)?.type as string | undefined;
  if (!type) return;

  const intLimit = INTEGER_LIMITS[type];
  if (intLimit) {
    if (constraints.max !== undefined) constraints.max = Math.min(constraints.max, intLimit.max);
    if (constraints.min !== undefined) constraints.min = Math.max(constraints.min, intLimit.min);
    return;
  }

  // decimal(precision, scale) — the largest value that fits is 10^(p-s) - 10^-s.
  const precision = raw?.schema?.numeric_precision;
  const scale = raw?.schema?.numeric_scale;
  if (
    DECIMAL_TYPES.has(type) &&
    typeof precision === 'number' &&
    typeof scale === 'number' &&
    precision > 0
  ) {
    const limit = Math.pow(10, precision - scale) - Math.pow(10, -scale);
    constraints.max = Math.min(constraints.max ?? Infinity, limit);
    if ((constraints.min ?? -Infinity) < -limit) constraints.min = -limit;
  }
}

/**
 * Everything we know about the legal values of a field, merged from three
 * sources that Directus keeps apart: the validation filter AST, the interface
 * options, and the database column definition.
 */
export function buildConstraints(raw: RawField): FieldConstraints {
  const fieldName = raw.field;
  const constraints: FieldConstraints = compileConstraints(raw?.meta?.validation, fieldName);

  const maxLength = extractMaxLength(raw);
  if (maxLength && (constraints.maxLength === undefined || maxLength < constraints.maxLength)) {
    constraints.maxLength = maxLength;
  }

  const options = raw?.meta?.options ?? {};
  const optMin = options.minValue ?? options.min;
  const optMax = options.maxValue ?? options.max;
  if (typeof optMin === 'number') constraints.min = Math.max(constraints.min ?? -Infinity, optMin);
  if (typeof optMax === 'number') constraints.max = Math.min(constraints.max ?? Infinity, optMax);

  applyColumnRange(raw, constraints);

  if (constraints.min !== undefined && !Number.isFinite(constraints.min)) delete constraints.min;
  if (constraints.max !== undefined && !Number.isFinite(constraints.max)) delete constraints.max;

  return constraints;
}

export function clampNumber(value: number, min?: number, max?: number): number {
  let v = value;
  if (typeof min === 'number' && v < min) v = min;
  if (typeof max === 'number' && v > max) v = max;
  return v;
}

export function truncateString(value: string, maxLength: number | null | undefined): string {
  if (!maxLength || maxLength <= 0) return value;
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength);
}

/**
 * Per-run uniqueness tracking.
 *
 * The naive approach — append `-3-a8f2z` to every unique value — corrupts
 * emails, slugs and anything with a validation pattern. Here a value is only
 * touched when it actually collides, and the mutation respects the shape of the
 * value: emails keep a valid local part, numbers increment, strings get a short
 * numeric suffix that fits inside `maxLength`.
 */
export class UniqueRegistry {
  private seen: Map<string, Set<string>> = new Map();

  /** Seed with values already in the table so we do not collide with them. */
  preload(field: string, values: unknown[]): void {
    const set = this.setFor(field);
    for (const value of values) {
      if (value === null || value === undefined) continue;
      set.add(String(value));
    }
  }

  has(field: string, value: unknown): boolean {
    return this.setFor(field).has(String(value));
  }

  size(field: string): number {
    return this.setFor(field).size;
  }

  /** Return a unique variant of `value`, registering whatever it hands back. */
  reserve(field: string, value: unknown, maxLength?: number | null): unknown {
    if (value === null || value === undefined) return value;
    const set = this.setFor(field);
    const key = String(value);
    if (!set.has(key)) {
      set.add(key);
      return value;
    }

    for (let attempt = 2; attempt < 10_000; attempt++) {
      const candidate = mutateForUniqueness(value, attempt, maxLength);
      const candidateKey = String(candidate);
      if (!set.has(candidateKey)) {
        set.add(candidateKey);
        return candidate;
      }
    }
    // Pathological case: fall back to a value that cannot collide.
    const fallback = `${key}-${set.size + 1}`;
    set.add(fallback);
    return fallback;
  }

  private setFor(field: string): Set<string> {
    let set = this.seen.get(field);
    if (!set) {
      set = new Set();
      this.seen.set(field, set);
    }
    return set;
  }
}

export function mutateForUniqueness(value: unknown, attempt: number, maxLength?: number | null): unknown {
  // `attempt` starts at 2 (the first collision), so numbers step by attempt - 1:
  // the second occurrence of 41 becomes 42, not 43.
  if (typeof value === 'number') {
    const step = attempt - 1;
    return Number.isInteger(value) ? value + step : Number((value + step / 100).toFixed(4));
  }

  const str = String(value);
  const suffix = String(attempt);

  // Email: keep the domain intact, tag the local part.
  const at = str.lastIndexOf('@');
  if (at > 0 && str.includes('.', at)) {
    const local = str.slice(0, at);
    const domain = str.slice(at);
    const merged = `${local}${suffix}${domain}`;
    return maxLength && merged.length > maxLength ? trimLocalPart(local, domain, suffix, maxLength) : merged;
  }

  // URL: append to the last path segment.
  if (/^https?:\/\//i.test(str)) {
    return str.replace(/\/?$/, `/${suffix}`);
  }

  const joined = `${str}-${suffix}`;
  if (maxLength && joined.length > maxLength) {
    const room = Math.max(1, maxLength - suffix.length - 1);
    return `${str.slice(0, room)}-${suffix}`;
  }
  return joined;
}

function trimLocalPart(local: string, domain: string, suffix: string, maxLength: number): string {
  const room = Math.max(1, maxLength - domain.length - suffix.length);
  return `${local.slice(0, room)}${suffix}${domain}`;
}

export interface PostProcessContext {
  rowIndex: number;
  registry?: UniqueRegistry;
}

export function postProcessValue(
  value: unknown,
  descriptor: FieldDescriptor,
  ctx: PostProcessContext
): unknown {
  let v = value;
  const constraints = descriptor.constraints ?? {};

  if (typeof v === 'number') {
    v = clampNumber(v, constraints.min, constraints.max);
    const scale = descriptor.numericScale;
    if (typeof scale === 'number' && scale >= 0) {
      v = Number((v as number).toFixed(scale));
    }
    // Last line of defence: an explicit strategy from a preset or a hand-written
    // request can name bounds the column cannot hold, and the database rejects
    // the whole batch rather than the one row. Clamp to what int4/int8 accepts.
    const intLimit = INTEGER_LIMITS[descriptor.type];
    if (intLimit) {
      v = Math.round(clampNumber(v as number, intLimit.min, intLimit.max));
    }
  }

  if (typeof v === 'string') {
    const maxLength = descriptor.maxLength ?? constraints.maxLength ?? null;
    v = truncateString(v, maxLength);
  }

  if (descriptor.isUnique && ctx.registry) {
    v = ctx.registry.reserve(descriptor.field, v, descriptor.maxLength ?? constraints.maxLength ?? null);
  }

  return v;
}

/** A `{000…}` placeholder wide enough to be a memory attack is not a format. */
const MAX_SEQUENCE_PAD = 40;

export function formatSequence(pattern: string, rowIndex: number, startFrom: number = 0): string {
  const number = startFrom + rowIndex;
  return String(pattern ?? '')
    .slice(0, 200)
    .replace(/\{(0+)\}/g, (_match, zeros: string) => {
      const width = Math.min(zeros.length, MAX_SEQUENCE_PAD);
      return String(number).padStart(width, '0');
    })
    .replace(/\{uuid\}/g, () => globalThis.crypto.randomUUID());
}

/**
 * Check a generated row the way Directus would before writing it.
 *
 * This is what turns "preview" into a dry run: the same checks the API performs
 * (required, length, validation filter) run locally, so the UI can show which
 * rows would be rejected without touching the database.
 */
export function validateRow(
  row: Record<string, unknown>,
  fields: FieldDescriptor[],
  rowIndex: number
): RowIssue[] {
  const issues: RowIssue[] = [];

  for (const field of fields) {
    if (field.isAlias || field.isSystemField || field.readonly) continue;
    const present = Object.prototype.hasOwnProperty.call(row, field.field);
    const value = row[field.field];
    const empty = value === null || value === undefined || value === '';

    if (field.required && empty && field.defaultValue === null) {
      issues.push({
        rowIndex,
        field: field.field,
        message: present ? 'Required field is empty' : 'Required field is missing',
      });
      continue;
    }
    if (empty) continue;

    const maxLength = field.maxLength ?? field.constraints?.maxLength ?? null;
    if (typeof value === 'string' && maxLength && value.length > maxLength) {
      issues.push({
        rowIndex,
        field: field.field,
        message: `Longer than the column allows (${value.length} > ${maxLength})`,
      });
    }

    if (typeof value === 'number') {
      const { min, max } = field.constraints ?? {};
      if (typeof min === 'number' && value < min) {
        issues.push({ rowIndex, field: field.field, message: `Below the allowed minimum (${value} < ${min})` });
      }
      if (typeof max === 'number' && value > max) {
        issues.push({ rowIndex, field: field.field, message: `Above the allowed maximum (${value} > ${max})` });
      }
    }

    if (field.validation && !matchesFilter(row, field.validation)) {
      issues.push({
        rowIndex,
        field: field.field,
        message: 'Fails the field validation rule configured in Directus',
      });
    }
  }

  return issues;
}
