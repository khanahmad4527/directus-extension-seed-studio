import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildConstraints,
  clampNumber,
  formatSequence,
  mutateForUniqueness,
  postProcessValue,
  truncateString,
  UniqueRegistry,
  validateRow,
} from '../src/core/validation.js';
import { makeField, rawField } from './helpers.js';

describe('buildConstraints — validation is a filter AST, not { min, max }', () => {
  it('reads _gte / _lte from the AST', () => {
    const constraints = buildConstraints(
      rawField('price', 'float', { meta: { validation: { price: { _gte: 5, _lte: 50 } } } })
    );
    assert.equal(constraints.min, 5);
    assert.equal(constraints.max, 50);
  });

  it('walks _and branches', () => {
    const constraints = buildConstraints(
      rawField('sku', 'string', {
        meta: {
          validation: {
            _and: [{ sku: { _regex: '^[A-Z]{3}$' } }, { sku: { _nnull: true } }],
          },
        },
      })
    );
    assert.equal(constraints.regex, '^[A-Z]{3}$');
    assert.equal(constraints.notNull, true);
  });

  it('turns _in into a value list', () => {
    const constraints = buildConstraints(
      rawField('status', 'string', { meta: { validation: { status: { _in: ['a', 'b'] } } } })
    );
    assert.deepEqual(constraints.oneOf, ['a', 'b']);
  });

  it('_gt on an integer becomes an inclusive minimum one step up', () => {
    const constraints = buildConstraints(
      rawField('qty', 'integer', { meta: { validation: { qty: { _gt: 0 } } } })
    );
    assert.equal(constraints.min, 1);
  });

  it('ignores rules that target a different field', () => {
    const constraints = buildConstraints(
      rawField('price', 'float', { meta: { validation: { other: { _gte: 100 } } } })
    );
    assert.equal(constraints.min, undefined);
  });

  it('does not read an integer column\'s bit width as decimal digits', () => {
    // Postgres reports numeric_precision 32 for int4 — bits, not digits. Read
    // as digits it yields a 10^32 ceiling, and the insert dies with
    // `invalid input syntax for type integer: "8.69e+31"`.
    const constraints = buildConstraints(
      rawField('view_count', 'integer', { schema: { numeric_precision: 32, numeric_scale: 0 } })
    );
    assert.equal(constraints.max, undefined, 'must not invent a ceiling for a bare integer');
    assert.equal(constraints.min, undefined, 'must not invent a floor for a bare integer');
  });

  it('leaves bigInteger bit width alone too', () => {
    const constraints = buildConstraints(
      rawField('big', 'bigInteger', { schema: { numeric_precision: 64, numeric_scale: 0 } })
    );
    assert.equal(constraints.max, undefined);
  });

  it('clamps a user-set integer bound to what the column can hold', () => {
    // An explicit rule wider than int4 is narrowed rather than dropped.
    const constraints = buildConstraints(
      rawField('view_count', 'integer', {
        schema: { numeric_precision: 32, numeric_scale: 0 },
        meta: { validation: { view_count: { _lte: 10_000_000_000 } } },
      })
    );
    assert.equal(constraints.max, 2_147_483_647);
  });

  it('keeps a user-set integer bound that already fits', () => {
    const constraints = buildConstraints(
      rawField('rating', 'integer', {
        schema: { numeric_precision: 32, numeric_scale: 0 },
        meta: { validation: { rating: { _gte: 1, _lte: 5 } } },
      })
    );
    assert.equal(constraints.min, 1);
    assert.equal(constraints.max, 5);
  });

  it('derives the ceiling of a decimal column from precision and scale', () => {
    const constraints = buildConstraints(
      rawField('total', 'decimal', { schema: { numeric_precision: 5, numeric_scale: 2 } })
    );
    // decimal(5,2) tops out at 999.99
    assert.equal(Math.round((constraints.max ?? 0) * 100) / 100, 999.99);
  });

  it('takes max_length from the column', () => {
    const constraints = buildConstraints(rawField('title', 'string', { schema: { max_length: 12 } }));
    assert.equal(constraints.maxLength, 12);
  });
});

describe('validation utilities', () => {
  it('truncates strings longer than maxLength', () => {
    assert.equal(truncateString('abcdefgh', 3), 'abc');
    assert.equal(truncateString('ab', 5), 'ab');
    assert.equal(truncateString('ab', null), 'ab');
  });

  it('clamps numbers into min/max range', () => {
    assert.equal(clampNumber(5, 10, 20), 10);
    assert.equal(clampNumber(25, 10, 20), 20);
    assert.equal(clampNumber(15, 10, 20), 15);
  });

  it('postProcessValue truncates by maxLength', () => {
    const value = postProcessValue('abcdefgh', makeField({ maxLength: 4 }), { rowIndex: 0 });
    assert.equal(value, 'abcd');
  });

  it('postProcessValue clamps numbers using compiled constraints', () => {
    const field = makeField({ type: 'integer', constraints: { min: 10, max: 20 } });
    assert.equal(postProcessValue(2, field, { rowIndex: 0 }), 10);
    assert.equal(postProcessValue(99, field, { rowIndex: 0 }), 20);
  });

  it('postProcessValue rounds to the column scale', () => {
    const field = makeField({ type: 'decimal', numericScale: 2 });
    assert.equal(postProcessValue(1.23456, field, { rowIndex: 0 }), 1.23);
  });

  it('formatSequence pads INV-{0000} with zeros', () => {
    assert.equal(formatSequence('INV-{0000}', 7, 1), 'INV-0008');
  });

  it('formatSequence respects startFrom', () => {
    assert.equal(formatSequence('{000}', 0, 100), '100');
  });
});

describe('UniqueRegistry — only collides when it has to', () => {
  it('returns the value untouched the first time', () => {
    const registry = new UniqueRegistry();
    assert.equal(registry.reserve('email', 'a@b.com'), 'a@b.com');
  });

  it('keeps emails valid when resolving a collision', () => {
    const registry = new UniqueRegistry();
    registry.reserve('email', 'ana.smith@example.com');
    const second = registry.reserve('email', 'ana.smith@example.com') as string;
    assert.notEqual(second, 'ana.smith@example.com');
    assert.match(second, /^[^@]+@example\.com$/);
  });

  it('never returns a value that already exists in the table', () => {
    const registry = new UniqueRegistry();
    registry.preload('slug', ['hello', 'hello-2']);
    const value = registry.reserve('slug', 'hello');
    assert.ok(value !== 'hello' && value !== 'hello-2');
  });

  it('increments numbers instead of appending text', () => {
    const registry = new UniqueRegistry();
    registry.reserve('code', 41);
    assert.equal(registry.reserve('code', 41), 42);
  });

  it('respects maxLength while resolving collisions', () => {
    const registry = new UniqueRegistry();
    registry.reserve('code', 'abcdefgh', 8);
    const second = registry.reserve('code', 'abcdefgh', 8) as string;
    assert.ok(second.length <= 8, `expected <= 8 chars, got ${second}`);
    assert.notEqual(second, 'abcdefgh');
  });

  it('mutateForUniqueness keeps URLs usable', () => {
    assert.equal(mutateForUniqueness('https://example.com/x', 2), 'https://example.com/x/2');
  });

  it('postProcessValue routes unique fields through the registry', () => {
    const registry = new UniqueRegistry();
    const field = makeField({ field: 'slug', isUnique: true });
    const first = postProcessValue('a', field, { rowIndex: 0, registry });
    const second = postProcessValue('a', field, { rowIndex: 1, registry });
    assert.equal(first, 'a');
    assert.notEqual(second, 'a');
  });
});

describe('validateRow — the dry run', () => {
  const fields = [
    makeField({ field: 'title', required: true, nullable: false, maxLength: 5 }),
    makeField({ field: 'price', type: 'float', constraints: { min: 10, max: 20 } }),
    makeField({
      field: 'sku',
      validation: { sku: { _regex: '^[A-Z]{2}$' } },
    }),
  ];

  it('accepts a valid row', () => {
    const issues = validateRow({ title: 'ok', price: 15, sku: 'AB' }, fields, 0);
    assert.deepEqual(issues, []);
  });

  it('reports a missing required field', () => {
    const issues = validateRow({ price: 15, sku: 'AB' }, fields, 3);
    assert.equal(issues.length, 1);
    assert.equal(issues[0]!.field, 'title');
    assert.equal(issues[0]!.rowIndex, 3);
  });

  it('reports a value that is too long for the column', () => {
    const issues = validateRow({ title: 'far too long', price: 15, sku: 'AB' }, fields, 0);
    assert.equal(issues.length, 1);
    assert.match(issues[0]!.message, /Longer than/);
  });

  it('reports a number outside the allowed range', () => {
    const issues = validateRow({ title: 'ok', price: 99, sku: 'AB' }, fields, 0);
    assert.equal(issues.length, 1);
    assert.match(issues[0]!.message, /maximum/);
  });

  it('reports a value that fails the Directus validation rule', () => {
    const issues = validateRow({ title: 'ok', price: 15, sku: 'abc' }, fields, 0);
    assert.equal(issues.length, 1);
    assert.match(issues[0]!.message, /validation rule/);
  });

  it('ignores alias fields, which have no column', () => {
    const issues = validateRow({}, [makeField({ field: 'divider', isAlias: true, required: true })], 0);
    assert.deepEqual(issues, []);
  });
});
