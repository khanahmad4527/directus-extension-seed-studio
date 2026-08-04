import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyInvariants } from '../src/core/invariants.js';
import { makeField } from './helpers.js';

const dateFields = [
  makeField({ field: 'created_at', type: 'dateTime' }),
  makeField({ field: 'updated_at', type: 'dateTime' }),
];

describe('applyInvariants — dates', () => {
  it('pushes updated after created', () => {
    const row: Record<string, unknown> = {
      created_at: '2024-06-01T10:00:00',
      updated_at: '2024-01-01T10:00:00',
    };
    const changes = applyInvariants(row, dateFields);

    assert.equal(changes.length, 1);
    assert.equal(changes[0]!.field, 'updated_at');
    assert.ok(new Date(row.updated_at as string) >= new Date(row.created_at as string));
  });

  it('leaves an already-correct pair alone', () => {
    const row = { created_at: '2024-01-01T10:00:00', updated_at: '2024-06-01T10:00:00' };
    assert.deepEqual(applyInvariants({ ...row }, dateFields), []);
  });

  it('orders start and end dates', () => {
    const row: Record<string, unknown> = { start_date: '2024-06-01', end_date: '2024-01-01' };
    const fields = [makeField({ field: 'start_date', type: 'date' }), makeField({ field: 'end_date', type: 'date' })];
    applyInvariants(row, fields);
    assert.ok(String(row.end_date) >= '2024-06-01');
    assert.match(String(row.end_date), /^\d{4}-\d{2}-\d{2}$/, 'date columns keep their format');
  });

  it('ignores bare time values, which have no ordering', () => {
    const row = { created_at: '10:00:00', updated_at: '09:00:00' };
    assert.deepEqual(applyInvariants({ ...row }, dateFields), []);
  });
});

describe('applyInvariants — numbers', () => {
  it('drops cost below price', () => {
    const row: Record<string, unknown> = { cost: 90, price: 50 };
    const changes = applyInvariants(row, [makeField({ field: 'cost' }), makeField({ field: 'price' })]);
    assert.equal(changes.length, 1);
    assert.ok((row.cost as number) < 50);
  });

  it('keeps a sale price at or below the regular price', () => {
    const row: Record<string, unknown> = { sale_price: 200, price: 100 };
    applyInvariants(row, [makeField({ field: 'sale_price' }), makeField({ field: 'price' })]);
    assert.ok((row.sale_price as number) <= 100);
  });

  it('recomputes a total from quantity and price', () => {
    const row: Record<string, unknown> = { quantity: 3, price: 10, total: 999 };
    const changes = applyInvariants(row, [
      makeField({ field: 'quantity' }),
      makeField({ field: 'price' }),
      makeField({ field: 'total' }),
    ]);
    assert.equal(row.total, 30);
    assert.ok(changes.some((c) => c.field === 'total'));
  });

  it('orders min and max fields', () => {
    const row: Record<string, unknown> = { min_guests: 10, max_guests: 4 };
    applyInvariants(row, [makeField({ field: 'min_guests' }), makeField({ field: 'max_guests' })]);
    assert.ok((row.min_guests as number) <= 4);
  });
});

describe('applyInvariants — status consistency', () => {
  it('clears the publication date on a draft', () => {
    const row: Record<string, unknown> = { status: 'draft', published_at: '2024-01-01T00:00:00' };
    const changes = applyInvariants(row, [
      makeField({ field: 'status' }),
      makeField({ field: 'published_at', type: 'dateTime' }),
    ]);
    assert.equal(row.published_at, null);
    assert.ok(changes.some((c) => c.rule.includes('drafts')));
  });

  it('gives a published row a date', () => {
    const row: Record<string, unknown> = {
      status: 'published',
      created_at: '2024-01-01T10:00:00',
      published_at: null,
    };
    applyInvariants(row, [
      makeField({ field: 'status' }),
      makeField({ field: 'created_at', type: 'dateTime' }),
      makeField({ field: 'published_at', type: 'dateTime' }),
    ]);
    assert.equal(row.published_at, '2024-01-01T10:00:00');
  });

  it('will not null a required publication date', () => {
    const row: Record<string, unknown> = { status: 'draft', published_at: '2024-01-01T00:00:00' };
    applyInvariants(row, [
      makeField({ field: 'status' }),
      makeField({ field: 'published_at', type: 'dateTime', required: true, nullable: false }),
    ]);
    assert.notEqual(row.published_at, null);
  });
});

describe('applyInvariants — names', () => {
  it('makes the full name agree with first and last', () => {
    const row: Record<string, unknown> = { first_name: 'Ana', last_name: 'Smith', full_name: 'Bob Jones' };
    applyInvariants(row, [
      makeField({ field: 'first_name' }),
      makeField({ field: 'last_name' }),
      makeField({ field: 'full_name' }),
    ]);
    assert.equal(row.full_name, 'Ana Smith');
  });

  it('respects maxLength when rewriting the name', () => {
    const row: Record<string, unknown> = { first_name: 'Alexandra', last_name: 'Fitzgerald', full_name: 'x' };
    applyInvariants(row, [
      makeField({ field: 'first_name' }),
      makeField({ field: 'last_name' }),
      makeField({ field: 'full_name', maxLength: 8 }),
    ]);
    assert.equal(String(row.full_name).length, 8);
  });
});
