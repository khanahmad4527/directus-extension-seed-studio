import { matchesFilter } from './filter-ast.js';
import type { FieldDescriptor } from './types.js';

/**
 * Directus conditional fields (`meta.conditions`).
 *
 * A field can be hidden, made readonly or made required depending on other
 * values in the same row. Generating every field independently produces rows the
 * admin UI itself considers impossible — a `draft` article with a
 * `published_at`, or an empty field the form insists on.
 *
 * `applyConditions` replays those rules against the finished row: fields the
 * form would hide are cleared, and fields the form would demand are flagged so
 * the caller can fill them.
 */

export interface ConditionOutcome {
  /** Fields cleared because a condition hides them in this row's state. */
  cleared: string[];
  /** Fields a condition makes required but which came out empty. */
  missing: string[];
}

export function applyConditions(
  row: Record<string, unknown>,
  fields: FieldDescriptor[]
): ConditionOutcome {
  const cleared: string[] = [];
  const missing: string[] = [];

  for (const field of fields) {
    if (!field.conditions || field.conditions.length === 0) continue;
    if (field.isAlias || field.isSystemField) continue;

    // Directus applies the last matching condition, so evaluate in order.
    let hidden: boolean | undefined;
    let required: boolean | undefined;
    for (const condition of field.conditions) {
      if (!condition?.rule) continue;
      if (!matchesFilter(row, condition.rule)) continue;
      if (typeof condition.hidden === 'boolean') hidden = condition.hidden;
      if (typeof condition.required === 'boolean') required = condition.required;
    }

    const value = row[field.field];
    const empty = value === null || value === undefined || value === '';

    if (hidden === true && !empty) {
      if (field.required) continue; // cannot clear a NOT NULL column
      row[field.field] = null;
      cleared.push(field.field);
      continue;
    }

    if (required === true && empty) {
      missing.push(field.field);
    }
  }

  return { cleared, missing };
}

/** Fields whose conditions depend on other fields — they must be built last. */
export function conditionDependencies(field: FieldDescriptor): string[] {
  if (!field.conditions) return [];
  const deps = new Set<string>();
  for (const condition of field.conditions) {
    collect(condition?.rule, deps);
  }
  deps.delete(field.field);
  return [...deps];
}

function collect(node: any, acc: Set<string>): void {
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (key === '_and' || key === '_or') {
      if (Array.isArray(value)) for (const sub of value) collect(sub, acc);
      continue;
    }
    if (key.startsWith('_')) continue;
    acc.add(key);
  }
}
