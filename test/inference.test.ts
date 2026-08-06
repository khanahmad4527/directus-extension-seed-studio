import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inferPattern, profileCollection } from '../src/core/inference.js';
import { buildCollectionDescriptor } from '../src/core/schema-model.js';
import { FakeDataSource, rawField } from './helpers.js';

function withRows(rows: Record<string, unknown>[]) {
  return new FakeDataSource({
    collections: { orders: { primary: 'id' } },
    fields: {
      orders: [
        rawField('id', 'integer', { schema: { is_primary_key: true } }),
        rawField('status', 'string', { meta: { interface: 'input' } }),
        rawField('total', 'float', { meta: { interface: 'input' } }),
        rawField('reference', 'string', { meta: { interface: 'input' } }),
        rawField('note', 'text', { meta: { interface: 'input-multiline' } }),
      ],
    },
    rows: { orders: rows },
  });
}

async function profile(rows: Record<string, unknown>[]) {
  const ds = withRows(rows);
  const descriptor = await buildCollectionDescriptor(ds, 'orders');
  const result = await profileCollection(ds, descriptor, 300);
  return { result, get: (field: string) => result.profiles.find((p) => p.field === field) };
}

describe('profileCollection', () => {
  it('reuses the real value distribution of a low-cardinality column', async () => {
    const rows = [
      ...Array.from({ length: 30 }, (_, i) => ({ id: i, status: 'paid', total: 10, reference: 'AB-00001', note: 'x' })),
      ...Array.from({ length: 5 }, (_, i) => ({ id: 100 + i, status: 'refunded', total: 20, reference: 'AB-00002', note: 'y' })),
    ];
    const { get } = await profile(rows);
    const status = get('status')!;

    assert.equal(status.suggested?.kind, 'weighted_choice');
    const choices = (status.suggested as any).choices as Array<{ value: unknown; weight: number }>;
    const paid = choices.find((c) => c.value === 'paid')!;
    const refunded = choices.find((c) => c.value === 'refunded')!;
    assert.ok(paid.weight > refunded.weight);
    assert.equal(status.confidence, 'high');
  });

  it('keeps generated numbers inside the observed range', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({
      id: i,
      status: `s${i % 30}`,
      total: 100 + i,
      reference: `R${i}`,
      note: 'n',
    }));
    const { get } = await profile(rows);
    const total = get('total')!;

    assert.equal(total.suggested?.kind, 'random_float');
    assert.equal((total.suggested as any).min, 100);
    assert.equal((total.suggested as any).max, 139);
  });

  it('learns an identifier format and reproduces it', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      status: `s${i}`,
      total: i,
      reference: `INV-${String(10000 + i)}`,
      note: 'n',
    }));
    const { get } = await profile(rows);
    const reference = get('reference')!;

    assert.equal(reference.suggested?.kind, 'regex');
    assert.equal((reference.suggested as any).pattern, '^[A-Z]{3}-[0-9]{5}$');
  });

  it('matches how often a column is left empty', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      status: `s${i}`,
      total: i,
      reference: `R${i}${i}${i}`,
      note: i < 10 ? null : 'filled',
    }));
    const { get } = await profile(rows);
    const note = get('note')!;

    assert.ok((note.nullRate ?? 0) > 0.4);
    assert.ok((note.suggested?.nullRate ?? 0) > 0.4);
  });

  it('returns nothing for an empty collection', async () => {
    const ds = withRows([]);
    const descriptor = await buildCollectionDescriptor(ds, 'orders');
    const result = await profileCollection(ds, descriptor, 300);
    assert.deepEqual(result.profiles, []);
  });

  it('skips primary keys and relations', async () => {
    const rows = Array.from({ length: 15 }, (_, i) => ({ id: i, status: 'x', total: i, reference: 'r', note: 'n' }));
    const { result } = await profile(rows);
    assert.equal(result.profiles.find((p) => p.field === 'id'), undefined);
  });
});

describe('inferPattern', () => {
  it('recognises a shared shape', () => {
    const values = Array.from({ length: 10 }, (_, i) => `AB-${1000 + i}`);
    assert.equal(inferPattern(values), '^[A-Z]{2}-[0-9]{4}$');
  });

  it('rejects mixed shapes', () => {
    assert.equal(inferPattern(['AB-1000', 'longer text here', 'AB-1002', 'x', 'y', 'z', 'q', 'w']), null);
  });

  it('rejects plain words, which are not a useful pattern', () => {
    assert.equal(inferPattern(['aaa', 'bbb', 'ccc', 'ddd', 'eee', 'fff', 'ggg', 'hhh']), null);
  });

  it('needs enough samples to be confident', () => {
    assert.equal(inferPattern(['AB-1000', 'AB-1001']), null);
  });
});

describe('profiling survives an unreadable column', () => {
  it('falls back to per-field reads instead of returning nothing', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      status: i % 2 === 0 ? 'paid' : 'refunded',
      total: i,
      reference: `AB-${1000 + i}`,
      note: 'n',
    }));
    const ds = withRows(rows);

    // One column throws — a geometry field on a database with no spatial
    // functions behaves exactly like this.
    const original = ds.sample.bind(ds);
    ds.sample = async (collection, fields, limit) => {
      if (fields.includes('reference')) throw new Error('no such function: st_asgeojson');
      return original(collection, fields, limit);
    };

    const descriptor = await buildCollectionDescriptor(ds, 'orders');
    const result = await profileCollection(ds, descriptor, 300);

    assert.ok(result.sampleSize > 0, 'the readable columns should still be sampled');
    const status = result.profiles.find((p) => p.field === 'status');
    assert.equal(status?.suggested?.kind, 'weighted_choice');
    const reference = result.profiles.find((p) => p.field === 'reference');
    assert.equal(reference?.suggested, undefined, 'the unreadable column yields no suggestion');
    assert.match(reference?.note ?? '', /could not be read/i);
    assert.equal(reference?.nullRate, 0, 'an unread column must not look "always empty"');
  });
});
