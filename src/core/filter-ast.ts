import type { FieldConstraints } from './types.js';

/**
 * Directus stores `meta.validation` as a filter AST, not as `{ min, max }`:
 *
 *   { "price": { "_gte": 5 } }
 *   { "_and": [ { "sku": { "_regex": "^[A-Z]{3}-\\d{4}$" } }, { "qty": { "_lte": 99 } } ] }
 *
 * This module turns that AST into per-field constraints the generator can
 * satisfy up front, and can also test a finished row against it — which is how
 * the dry-run reports "Directus would reject this" without writing anything.
 *
 * Operator coverage mirrors `@directus/utils` `generateJoi`.
 */

export type FilterAst = Record<string, any>;

/** Upper bound on the text a stored `_regex` rule is tested against. */
const MAX_REGEX_SUBJECT = 10_000;

/** Collect constraints for `fieldName` out of a validation AST. */
export function compileConstraints(ast: FilterAst | null | undefined, fieldName: string): FieldConstraints {
  const out: FieldConstraints = {};
  if (!ast || typeof ast !== 'object') return out;
  walk(ast, fieldName, out, false);
  return out;
}

function walk(node: FilterAst, fieldName: string, out: FieldConstraints, insideOr: boolean): void {
  for (const [key, value] of Object.entries(node)) {
    if (key === '_and' && Array.isArray(value)) {
      for (const sub of value) walk(sub ?? {}, fieldName, out, insideOr);
      continue;
    }
    if (key === '_or' && Array.isArray(value)) {
      // An OR branch is not a hard constraint; take the first branch as a hint
      // so generated values satisfy at least one alternative.
      const first = value[0];
      if (first) walk(first, fieldName, out, true);
      continue;
    }
    if (key.startsWith('_')) continue;

    // Directus writes the field key without a prefix; `$FOLLOW`/related paths are ignored.
    const normalized = key.replace(/^\$?/, '');
    if (normalized !== fieldName) continue;
    if (!value || typeof value !== 'object') continue;

    applyOperators(value as Record<string, unknown>, out, insideOr);
  }
}

function applyOperators(ops: Record<string, unknown>, out: FieldConstraints, insideOr: boolean): void {
  for (const [op, raw] of Object.entries(ops)) {
    switch (op) {
      case '_eq':
        out.oneOf = [raw];
        break;
      case '_neq':
        out.notOneOf = [...(out.notOneOf ?? []), raw];
        break;
      case '_in':
        if (Array.isArray(raw)) out.oneOf = raw;
        break;
      case '_nin':
        if (Array.isArray(raw)) out.notOneOf = [...(out.notOneOf ?? []), ...raw];
        break;
      case '_gt':
        if (isNum(raw)) out.min = Math.max(out.min ?? -Infinity, num(raw) + smallestStep(raw));
        break;
      case '_gte':
        if (isNum(raw)) out.min = Math.max(out.min ?? -Infinity, num(raw));
        break;
      case '_lt':
        if (isNum(raw)) out.max = Math.min(out.max ?? Infinity, num(raw) - smallestStep(raw));
        break;
      case '_lte':
        if (isNum(raw)) out.max = Math.min(out.max ?? Infinity, num(raw));
        break;
      case '_between':
        if (Array.isArray(raw) && raw.length === 2 && isNum(raw[0]) && isNum(raw[1])) {
          out.min = Math.max(out.min ?? -Infinity, num(raw[0]));
          out.max = Math.min(out.max ?? Infinity, num(raw[1]));
        }
        break;
      case '_regex':
        if (typeof raw === 'string' && !insideOr) out.regex = raw;
        break;
      case '_contains':
        if (typeof raw === 'string') out.contains = raw;
        break;
      case '_starts_with':
        if (typeof raw === 'string') out.startsWith = raw;
        break;
      case '_ends_with':
        if (typeof raw === 'string') out.endsWith = raw;
        break;
      case '_nnull':
        if (raw === true) out.notNull = true;
        break;
      case '_null':
        if (raw === true) out.oneOf = [null];
        break;
      case '_nempty':
        if (raw === true) out.notEmpty = true;
        break;
      default:
        break;
    }
  }
  if (out.min !== undefined && !Number.isFinite(out.min)) delete out.min;
  if (out.max !== undefined && !Number.isFinite(out.max)) delete out.max;
}

function isNum(value: unknown): boolean {
  return typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)));
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

function smallestStep(value: unknown): number {
  return Number.isInteger(num(value)) ? 1 : 0.01;
}

/**
 * Evaluate a filter AST against a row. Used for `meta.conditions` and for
 * checking generated rows against validation rules.
 *
 * Unknown operators return `true` — we never fail a row over an operator we
 * do not model.
 */
export function matchesFilter(row: Record<string, unknown>, ast: FilterAst | null | undefined): boolean {
  if (!ast || typeof ast !== 'object') return true;

  for (const [key, value] of Object.entries(ast)) {
    if (key === '_and' && Array.isArray(value)) {
      if (!value.every((sub) => matchesFilter(row, sub))) return false;
      continue;
    }
    if (key === '_or' && Array.isArray(value)) {
      if (value.length > 0 && !value.some((sub) => matchesFilter(row, sub))) return false;
      continue;
    }
    if (key.startsWith('_')) continue;
    if (!value || typeof value !== 'object') continue;
    if (!fieldMatches(row[key], value as Record<string, unknown>)) return false;
  }
  return true;
}

function fieldMatches(actual: unknown, ops: Record<string, unknown>): boolean {
  for (const [op, expected] of Object.entries(ops)) {
    switch (op) {
      case '_eq':
        if (!looseEq(actual, expected)) return false;
        break;
      case '_neq':
        if (looseEq(actual, expected)) return false;
        break;
      case '_in':
        if (!Array.isArray(expected) || !expected.some((e) => looseEq(actual, e))) return false;
        break;
      case '_nin':
        if (Array.isArray(expected) && expected.some((e) => looseEq(actual, e))) return false;
        break;
      case '_null':
        if (expected === true && actual !== null && actual !== undefined) return false;
        break;
      case '_nnull':
        if (expected === true && (actual === null || actual === undefined)) return false;
        break;
      case '_empty':
        if (expected === true && !isEmpty(actual)) return false;
        break;
      case '_nempty':
        if (expected === true && isEmpty(actual)) return false;
        break;
      case '_gt':
        if (!(toNum(actual) > toNum(expected))) return false;
        break;
      case '_gte':
        if (!(toNum(actual) >= toNum(expected))) return false;
        break;
      case '_lt':
        if (!(toNum(actual) < toNum(expected))) return false;
        break;
      case '_lte':
        if (!(toNum(actual) <= toNum(expected))) return false;
        break;
      case '_between':
        if (Array.isArray(expected) && expected.length === 2) {
          const v = toNum(actual);
          if (!(v >= toNum(expected[0]) && v <= toNum(expected[1]))) return false;
        }
        break;
      case '_contains':
        if (!String(actual ?? '').includes(String(expected))) return false;
        break;
      case '_ncontains':
        if (String(actual ?? '').includes(String(expected))) return false;
        break;
      case '_starts_with':
        if (!String(actual ?? '').startsWith(String(expected))) return false;
        break;
      case '_ends_with':
        if (!String(actual ?? '').endsWith(String(expected))) return false;
        break;
      case '_regex':
        if (typeof expected === 'string') {
          try {
            // Stored patterns can backtrack catastrophically. Bounding the input
            // keeps a pathological rule from hanging a whole run on one row.
            const subject = String(actual ?? '').slice(0, MAX_REGEX_SUBJECT);
            if (!new RegExp(expected).test(subject)) return false;
          } catch {
            // An invalid stored pattern must not fail the row.
          }
        }
        break;
      default:
        break;
    }
  }
  return true;
}

function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function toNum(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const t = Date.parse(value);
    if (!Number.isNaN(t)) return t;
  }
  return Number(value);
}

/** Field names referenced anywhere in an AST — used to order conditional fields. */
export function fieldsInFilter(ast: FilterAst | null | undefined, acc = new Set<string>()): Set<string> {
  if (!ast || typeof ast !== 'object') return acc;
  for (const [key, value] of Object.entries(ast)) {
    if (key === '_and' || key === '_or') {
      if (Array.isArray(value)) for (const sub of value) fieldsInFilter(sub, acc);
      continue;
    }
    if (key.startsWith('_')) continue;
    acc.add(key);
  }
  return acc;
}
