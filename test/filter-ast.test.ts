import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileConstraints, fieldsInFilter, matchesFilter } from '../src/core/filter-ast.js';

describe('compileConstraints', () => {
  it('takes the tightest of several bounds', () => {
    const constraints = compileConstraints(
      { _and: [{ n: { _gte: 5 } }, { n: { _gte: 10 } }, { n: { _lte: 100 } }, { n: { _lte: 50 } }] },
      'n'
    );
    assert.equal(constraints.min, 10);
    assert.equal(constraints.max, 50);
  });

  it('handles _between', () => {
    const constraints = compileConstraints({ n: { _between: [1, 9] } }, 'n');
    assert.equal(constraints.min, 1);
    assert.equal(constraints.max, 9);
  });

  it('collects negative constraints', () => {
    const constraints = compileConstraints({ s: { _neq: 'bad' } }, 's');
    assert.deepEqual(constraints.notOneOf, ['bad']);
  });

  it('uses the first _or branch as a hint but not as a hard regex', () => {
    const constraints = compileConstraints(
      { _or: [{ s: { _starts_with: 'A' } }, { s: { _starts_with: 'B' } }] },
      's'
    );
    assert.equal(constraints.startsWith, 'A');
  });

  it('returns nothing for an empty or unrelated AST', () => {
    assert.deepEqual(compileConstraints(null, 'x'), {});
    assert.deepEqual(compileConstraints({ other: { _eq: 1 } }, 'x'), {});
  });
});

describe('matchesFilter', () => {
  it('evaluates equality loosely across string/number', () => {
    assert.equal(matchesFilter({ id: 5 }, { id: { _eq: '5' } }), true);
    assert.equal(matchesFilter({ id: 5 }, { id: { _eq: 6 } }), false);
  });

  it('handles _and / _or nesting', () => {
    const filter = {
      _and: [{ status: { _eq: 'published' } }, { _or: [{ views: { _gt: 100 } }, { featured: { _eq: true } }] }],
    };
    assert.equal(matchesFilter({ status: 'published', views: 5, featured: true }, filter), true);
    assert.equal(matchesFilter({ status: 'published', views: 5, featured: false }, filter), false);
    assert.equal(matchesFilter({ status: 'draft', views: 500, featured: true }, filter), false);
  });

  it('handles emptiness operators the way conditional fields use them', () => {
    assert.equal(matchesFilter({ note: '' }, { note: { _empty: true } }), true);
    assert.equal(matchesFilter({ note: 'x' }, { note: { _empty: true } }), false);
    assert.equal(matchesFilter({ note: null }, { note: { _nnull: true } }), false);
  });

  it('compares dates chronologically, not alphabetically', () => {
    assert.equal(
      matchesFilter({ date: '2024-02-01T00:00:00' }, { date: { _gt: '2024-01-15T00:00:00' } }),
      true
    );
  });

  it('never fails a row over an operator it does not model', () => {
    assert.equal(matchesFilter({ x: 1 }, { x: { _some_future_op: 'y' } as any }), true);
  });

  it('survives an invalid stored regex', () => {
    assert.equal(matchesFilter({ x: 'a' }, { x: { _regex: '([' } }), true);
  });
});

describe('fieldsInFilter', () => {
  it('lists every field referenced anywhere in the tree', () => {
    const fields = fieldsInFilter({ _and: [{ a: { _eq: 1 } }, { _or: [{ b: { _eq: 2 } }, { c: { _eq: 3 } }] }] });
    assert.deepEqual([...fields].sort(), ['a', 'b', 'c']);
  });
});
