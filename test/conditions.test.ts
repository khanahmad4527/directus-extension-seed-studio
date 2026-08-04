import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyConditions, conditionDependencies } from '../src/core/conditions.js';
import { makeField } from './helpers.js';

describe('applyConditions', () => {
  it('clears a field the item form would hide', () => {
    const fields = [
      makeField({ field: 'status' }),
      makeField({
        field: 'published_at',
        conditions: [{ name: 'hide for drafts', rule: { status: { _eq: 'draft' } }, hidden: true }],
      }),
    ];
    const row: Record<string, unknown> = { status: 'draft', published_at: '2024-01-01T00:00:00' };

    const outcome = applyConditions(row, fields);
    assert.deepEqual(outcome.cleared, ['published_at']);
    assert.equal(row.published_at, null);
  });

  it('leaves the field alone when the condition does not match', () => {
    const fields = [
      makeField({ field: 'status' }),
      makeField({
        field: 'published_at',
        conditions: [{ rule: { status: { _eq: 'draft' } }, hidden: true }],
      }),
    ];
    const row: Record<string, unknown> = { status: 'published', published_at: '2024-01-01T00:00:00' };
    applyConditions(row, fields);
    assert.equal(row.published_at, '2024-01-01T00:00:00');
  });

  it('will not clear a NOT NULL column', () => {
    const fields = [
      makeField({ field: 'status' }),
      makeField({
        field: 'published_at',
        required: true,
        nullable: false,
        conditions: [{ rule: { status: { _eq: 'draft' } }, hidden: true }],
      }),
    ];
    const row: Record<string, unknown> = { status: 'draft', published_at: '2024-01-01T00:00:00' };
    const outcome = applyConditions(row, fields);
    assert.deepEqual(outcome.cleared, []);
    assert.notEqual(row.published_at, null);
  });

  it('reports a conditionally required field that came out empty', () => {
    const fields = [
      makeField({ field: 'kind' }),
      makeField({
        field: 'reason',
        conditions: [{ rule: { kind: { _eq: 'other' } }, required: true }],
      }),
    ];
    const outcome = applyConditions({ kind: 'other', reason: null }, fields);
    assert.deepEqual(outcome.missing, ['reason']);
  });

  it('applies the last matching condition, as Directus does', () => {
    const fields = [
      makeField({ field: 'status' }),
      makeField({
        field: 'note',
        conditions: [
          { rule: { status: { _eq: 'draft' } }, hidden: true },
          { rule: { status: { _eq: 'draft' } }, hidden: false },
        ],
      }),
    ];
    const row: Record<string, unknown> = { status: 'draft', note: 'keep me' };
    applyConditions(row, fields);
    assert.equal(row.note, 'keep me');
  });

  it('ignores alias and system fields', () => {
    const fields = [
      makeField({
        field: 'divider',
        isAlias: true,
        conditions: [{ rule: {}, hidden: true }],
      }),
    ];
    const outcome = applyConditions({ divider: 'x' }, fields);
    assert.deepEqual(outcome.cleared, []);
  });
});

describe('conditionDependencies', () => {
  it('lists the fields a condition reads', () => {
    const field = makeField({
      field: 'reason',
      conditions: [{ rule: { _and: [{ kind: { _eq: 'other' } }, { region: { _eq: 'eu' } }] } }],
    });
    assert.deepEqual(conditionDependencies(field).sort(), ['kind', 'region']);
  });

  it('drops a self-reference so the field can still be built', () => {
    const field = makeField({ field: 'kind', conditions: [{ rule: { kind: { _eq: 'x' } } }] });
    assert.deepEqual(conditionDependencies(field), []);
  });
});
