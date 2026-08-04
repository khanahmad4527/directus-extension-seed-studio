import { isEntityPath, readTrait, slugify, titleCase, type RowEntity } from './entity.js';
import { invokeFaker, isValidFakerPath } from './faker-methods.js';
import type { Rng } from './rng.js';

/**
 * A tiny template DSL, because one-faker-method-per-field is not expressive
 * enough for real content:
 *
 *   {{person.firstName}} <{{contact.email}}>
 *   {{company.name}} — {{company.catchPhrase}}
 *   INV-{{seq | pad:5}}
 *   {{row.title | slug}}
 *   {{pick(draft|published|archived)}}
 *   {{int(1,5)}} × {{commerce.productName}}
 *
 * Resolution order per expression: specials → entity trait → faker path → row
 * field. Unknown expressions render as an empty string rather than throwing, so
 * a typo degrades one value instead of failing a 100k-row run.
 *
 * This is deliberately NOT an eval. Even in the API extension the only reachable
 * callables are faker modules on an allowlist (see `faker-methods.ts`), so a
 * template arriving in a request body cannot reach the JS runtime.
 */

export interface TemplateContext {
  rng: Rng;
  entity: RowEntity;
  row: Record<string, unknown>;
  rowIndex: number;
}

const EXPRESSION = /\{\{([^}]+)\}\}/g;

export function renderTemplate(template: string, ctx: TemplateContext): string {
  if (typeof template !== 'string' || template.length === 0) return '';
  return template.replace(EXPRESSION, (_match, body: string) => {
    const [rawExpr, ...filters] = body.split('|').map((part) => part.trim());
    const value = resolveExpression(rawExpr ?? '', ctx);
    return applyFilters(value, filters);
  });
}

function resolveExpression(expr: string, ctx: TemplateContext): unknown {
  if (!expr) return '';

  // pick(a|b|c) — split on the raw expression before filter parsing loses the pipes.
  const pickMatch = /^pick\((.*)\)$/s.exec(expr);
  if (pickMatch) {
    const options = (pickMatch[1] ?? '').split(',').map((s) => s.trim());
    return options.length > 0 ? ctx.rng.pick(options) : '';
  }

  const call = /^([a-zA-Z_]+)\(([^)]*)\)$/.exec(expr);
  if (call) {
    const fn = call[1] ?? '';
    const args = (call[2] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return callHelper(fn, args, ctx);
  }

  switch (expr) {
    case 'index':
      return ctx.rowIndex;
    case 'seq':
      return ctx.rowIndex + 1;
    case 'uuid':
      return ctx.rng.uuid();
    case 'now':
      return new Date().toISOString();
    default:
      break;
  }

  if (expr.startsWith('row.')) {
    return ctx.row[expr.slice(4)] ?? '';
  }

  if (isEntityPath(expr)) {
    return readTrait(ctx.entity, expr) ?? '';
  }

  const fakerPath = expr.startsWith('faker.') ? expr.slice(6) : expr;
  if (isValidFakerPath(fakerPath)) {
    try {
      return invokeFaker(ctx.rng.faker, fakerPath);
    } catch {
      return '';
    }
  }

  return '';
}

function callHelper(fn: string, args: string[], ctx: TemplateContext): unknown {
  const nums = args.map((a) => Number(a));
  switch (fn) {
    case 'int':
      return ctx.rng.int(nums[0] ?? 0, nums[1] ?? 100);
    case 'float':
      return ctx.rng.float(nums[0] ?? 0, nums[1] ?? 100, nums[2] ?? 2);
    case 'bool':
      return ctx.rng.bool(nums[0] ?? 0.5);
    case 'words':
      return String(ctx.rng.faker.lorem.words({ min: nums[0] ?? 2, max: nums[1] ?? nums[0] ?? 5 }));
    case 'sentence':
      return String(ctx.rng.faker.lorem.sentence());
    case 'regex':
      try {
        return ctx.rng.fromRegExp(args.join(','));
      } catch {
        return '';
      }
    case 'date': {
      // date(daysBack, daysForward) relative to now, ISO output.
      const back = nums[0] ?? 30;
      const forward = nums[1] ?? 0;
      const now = Date.now();
      const from = now - Math.abs(back) * 86_400_000;
      const to = now + Math.abs(forward) * 86_400_000;
      return new Date(from + (to - from) * ctx.rng.float(0, 1, 6)).toISOString();
    }
    default:
      return '';
  }
}

function applyFilters(value: unknown, filters: string[]): string {
  let out = value === null || value === undefined ? '' : String(value);
  for (const filter of filters) {
    if (!filter) continue;
    const [name, arg] = filter.split(':').map((s) => s.trim());
    switch (name) {
      case 'upper':
        out = out.toUpperCase();
        break;
      case 'lower':
        out = out.toLowerCase();
        break;
      case 'title':
        out = titleCase(out);
        break;
      case 'slug':
        out = slugify(out);
        break;
      case 'trim':
        out = out.trim();
        break;
      case 'truncate':
        out = out.slice(0, Math.max(0, Number(arg) || 20));
        break;
      case 'pad':
        out = out.padStart(Math.max(0, Number(arg) || 2), '0');
        break;
      case 'initials':
        out = out
          .split(/\s+/)
          .map((w) => w.charAt(0).toUpperCase())
          .join('');
        break;
      default:
        break;
    }
  }
  return out;
}

/** Row fields a template depends on — drives field ordering inside a row. */
export function templateDependencies(template: string): string[] {
  const deps: string[] = [];
  for (const match of String(template).matchAll(EXPRESSION)) {
    const expr = (match[1] ?? '').split('|')[0]?.trim() ?? '';
    if (expr.startsWith('row.')) deps.push(expr.slice(4));
  }
  return deps;
}
