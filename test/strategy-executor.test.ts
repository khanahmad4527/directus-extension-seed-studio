import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StrategyExecutor } from '../src/core/strategy-executor.js';
import { invokeFaker, isValidFakerPath } from '../src/core/faker-methods.js';
import type { GenerationStrategy } from '../src/core/types.js';
import { FakeDataSource, makeField, makeRng } from './helpers.js';

function executor(ds = new FakeDataSource(), seed = 99) {
  const rng = makeRng(seed);
  return { exec: new StrategyExecutor(ds, rng), rng, ds };
}

async function run(strategy: GenerationStrategy, field = makeField(), seed = 99) {
  const { exec, rng } = executor(new FakeDataSource(), seed);
  const entity = exec.newEntity(0, 'items');
  return exec.execute(strategy, field, { rowIndex: 0, row: {}, entity });
}

describe('StrategyExecutor.execute', () => {
  it('faker person.firstName returns a non-empty string', async () => {
    const value = await run({ kind: 'faker', method: 'person.firstName' });
    assert.equal(typeof value, 'string');
    assert.ok((value as string).length > 0);
  });

  it('random_int respects min and max', async () => {
    const { exec } = executor();
    const entity = exec.newEntity(0, 'items');
    for (let i = 0; i < 50; i++) {
      const value = (await exec.execute({ kind: 'random_int', min: 5, max: 7 }, makeField(), {
        rowIndex: i,
        row: {},
        entity,
      })) as number;
      assert.ok(value >= 5 && value <= 7, `${value} out of range`);
    }
  });

  it('uuid returns a v4-shaped id', async () => {
    const value = (await run({ kind: 'uuid' })) as string;
    assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('fixed returns the value as-is', async () => {
    assert.equal(await run({ kind: 'fixed', value: 'abc' }), 'abc');
  });

  it('null returns null', async () => {
    assert.equal(await run({ kind: 'null' }), null);
  });

  it('random_choice picks from the list', async () => {
    const value = await run({ kind: 'random_choice', choices: ['a', 'b'] });
    assert.ok(['a', 'b'].includes(value as string));
  });

  it('weighted_choice honours the weights', async () => {
    const { exec } = executor();
    const entity = exec.newEntity(0, 'items');
    const counts: Record<string, number> = { common: 0, rare: 0 };
    for (let i = 0; i < 400; i++) {
      const value = (await exec.execute(
        { kind: 'weighted_choice', choices: [{ value: 'common', weight: 95 }, { value: 'rare', weight: 5 }] },
        makeField(),
        { rowIndex: i, row: {}, entity }
      )) as string;
      counts[value] = (counts[value] ?? 0) + 1;
    }
    assert.ok(counts.common > counts.rare * 3, `weights ignored: ${JSON.stringify(counts)}`);
  });

  it('regex generates a matching value', async () => {
    const value = (await run({ kind: 'regex', pattern: '^INV-[0-9]{5}$' })) as string;
    assert.match(value, /^INV-\d{5}$/);
  });
});

describe('StrategyExecutor — dates', () => {
  it('random_date with daysForward can produce a future date', async () => {
    const { exec } = executor();
    const entity = exec.newEntity(0, 'items');
    const field = makeField({ type: 'dateTime' });
    let sawFuture = false;

    for (let i = 0; i < 60; i++) {
      const value = (await exec.execute(
        { kind: 'random_date', daysBack: 0, daysForward: 30 },
        field,
        { rowIndex: i, row: {}, entity }
      )) as string;
      if (new Date(value).getTime() > Date.now() + 1000) sawFuture = true;
    }

    assert.ok(sawFuture, 'daysForward never produced a future date');
  });

  it('date columns are formatted as YYYY-MM-DD', async () => {
    const value = (await run({ kind: 'random_date', daysBack: 30, daysForward: 0 }, makeField({ type: 'date' }))) as string;
    assert.match(value, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('dateTime columns are sent without a timezone suffix', async () => {
    const value = (await run(
      { kind: 'random_date', daysBack: 30, daysForward: 0 },
      makeField({ type: 'dateTime' })
    )) as string;
    assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });
});

describe('StrategyExecutor — geometry', () => {
  it('generates a Polygon with a closed ring', async () => {
    const value = (await run({ kind: 'geometry', geometryType: 'Polygon' })) as any;
    assert.equal(value.type, 'Polygon');
    const ring = value.coordinates[0];
    assert.ok(ring.length >= 4);
    assert.deepEqual(ring[0], ring[ring.length - 1]);
  });

  it('generates distinct points rather than a constant', async () => {
    const { exec } = executor();
    const entity = exec.newEntity(0, 'items');
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      exec.seedRow(i);
      const value = (await exec.execute({ kind: 'geometry', geometryType: 'Point' }, makeField(), {
        rowIndex: i,
        row: {},
        entity,
      })) as any;
      seen.add(JSON.stringify(value.coordinates));
    }
    assert.ok(seen.size > 5, 'points repeat too often');
  });

  it('keeps coordinates inside the requested bounding box', async () => {
    const value = (await run({ kind: 'geometry', geometryType: 'Point', bbox: [10, 20, 11, 21] })) as any;
    const [lng, lat] = value.coordinates;
    assert.ok(lng >= 10 && lng <= 11, `lng ${lng}`);
    assert.ok(lat >= 20 && lat <= 21, `lat ${lat}`);
  });
});

describe('StrategyExecutor — relations', () => {
  it('m2o_random picks an id that exists', async () => {
    const ds = new FakeDataSource({
      collections: { authors: { primary: 'id' } },
      rows: { authors: [{ id: 7 }, { id: 8 }] },
    });
    const { exec } = executor(ds);
    await exec.prepare({ author: { kind: 'm2o_random', relatedCollection: 'authors' } });
    const entity = exec.newEntity(0, 'posts');
    const value = await exec.execute({ kind: 'm2o_random', relatedCollection: 'authors' }, makeField(), {
      rowIndex: 0,
      row: {},
      entity,
    });
    assert.ok([7, 8].includes(value as number));
  });

  it('m2o_random yields null when the related collection is empty', async () => {
    const ds = new FakeDataSource({ collections: { authors: {} }, rows: { authors: [] } });
    const { exec } = executor(ds);
    await exec.prepare({ author: { kind: 'm2o_random', relatedCollection: 'authors' } });
    const entity = exec.newEntity(0, 'posts');
    const value = await exec.execute({ kind: 'm2o_random', relatedCollection: 'authors' }, makeField(), {
      rowIndex: 0,
      row: {},
      entity,
    });
    assert.equal(value, null);
  });

  it('file_reuse filters by mime type', async () => {
    const ds = new FakeDataSource({
      collections: { directus_files: {} },
      rows: {
        directus_files: [
          { id: 'img', type: 'image/png' },
          { id: 'pdf', type: 'application/pdf' },
        ],
      },
    });
    const { exec } = executor(ds);
    await exec.prepare({ avatar: { kind: 'file_reuse', mimeFilter: 'image/' } });
    const entity = exec.newEntity(0, 'users');
    const value = await exec.execute({ kind: 'file_reuse', mimeFilter: 'image/' }, makeField(), {
      rowIndex: 0,
      row: {},
      entity,
    });
    assert.equal(value, 'img');
  });

  it('only loads the pools a run actually needs', async () => {
    const ds = new FakeDataSource({
      collections: { a: {}, b: {}, c: {} },
      rows: { a: [{ id: 1 }], b: [{ id: 2 }], c: [{ id: 3 }] },
    });
    let reads = 0;
    const original = ds.readColumn.bind(ds);
    ds.readColumn = async (collection, field, limit) => {
      reads += 1;
      return original(collection, field, limit);
    };

    const { exec } = executor(ds);
    await exec.prepare({ ref: { kind: 'm2o_random', relatedCollection: 'a' } });
    assert.equal(reads, 1, 'prepare() should not read unrelated collections');
  });
});

describe('StrategyExecutor — null rate', () => {
  it('leaves the field empty roughly at the configured rate', async () => {
    const { exec } = executor();
    const field = makeField({ nullable: true, required: false });
    let nulls = 0;
    for (let i = 0; i < 300; i++) {
      exec.seedRow(i);
      const entity = exec.newEntity(i, 'items');
      const value = await exec.execute(
        { kind: 'faker', method: 'lorem.word', nullRate: 0.5 },
        field,
        { rowIndex: i, row: {}, entity }
      );
      if (value === null) nulls += 1;
    }
    assert.ok(nulls > 90 && nulls < 210, `expected ~150 nulls, got ${nulls}`);
  });

  it('never nulls a required field', async () => {
    const { exec } = executor();
    const field = makeField({ nullable: false, required: true });
    for (let i = 0; i < 50; i++) {
      exec.seedRow(i);
      const entity = exec.newEntity(i, 'items');
      const value = await exec.execute(
        { kind: 'faker', method: 'lorem.word', nullRate: 1 },
        field,
        { rowIndex: i, row: {}, entity }
      );
      assert.notEqual(value, null);
    }
  });
});

describe('faker path safety', () => {
  it('accepts a real module.method path', () => {
    assert.equal(isValidFakerPath('person.firstName'), true);
  });

  it('rejects prototype traversal', () => {
    assert.equal(isValidFakerPath('constructor.constructor'), false);
    assert.equal(isValidFakerPath('__proto__.x'), false);
    assert.equal(isValidFakerPath('person.firstName.call'), false);
    assert.equal(isValidFakerPath('helpers'), false);
  });

  it('invokeFaker throws on an unknown module', () => {
    const rng = makeRng();
    assert.throws(() => invokeFaker(rng.faker, 'nope.nope'), /Invalid faker method/);
  });
});
