import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { orderFieldsByDependency, runGeneration, runPreview, undoRun } from '../src/core/generator.js';
import type { GenerationRequest, StrategyMap } from '../src/core/types.js';
import { FakeDataSource, makeField, makeRng, rawField } from './helpers.js';

function postsSource(extra: Partial<ConstructorParameters<typeof FakeDataSource>[0]> = {}) {
  return new FakeDataSource({
    collections: { posts: { primary: 'id' }, authors: { primary: 'id' } },
    fields: {
      posts: [
        rawField('id', 'integer', { schema: { is_primary_key: true, is_nullable: false, has_auto_increment: true } }),
        rawField('title', 'string', { meta: { interface: 'input', required: true }, schema: { is_nullable: false, max_length: 80 } }),
        rawField('status', 'string', {
          meta: {
            interface: 'select-dropdown',
            options: { choices: [{ value: 'published' }, { value: 'draft' }, { value: 'archived' }] },
          },
        }),
        rawField('layout_divider', 'alias', { meta: { interface: 'presentation-divider', special: ['alias', 'no-data'] } }),
        rawField('author', 'integer', { meta: { interface: 'select-dropdown-m2o' } }),
        rawField('date_created', 'timestamp', { meta: { special: ['date-created'] } }),
      ],
      authors: [rawField('id', 'integer', { schema: { is_primary_key: true } })],
    },
    relations: [{ collection: 'posts', field: 'author', related_collection: 'authors', meta: {} }],
    rows: { authors: [{ id: 1 }, { id: 2 }], posts: [] },
    ...extra,
  });
}

function request(over: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    collection: 'posts',
    strategies: {},
    count: 6,
    batchSize: 2,
    ...over,
  };
}

describe('runGeneration', () => {
  it('writes the requested number of rows in batches', async () => {
    const ds = postsSource();
    const result = await runGeneration(request(), { ds, rng: makeRng() });

    assert.equal(result.rowsWritten, 6);
    assert.equal(ds.inserts.filter((i) => i.collection === 'posts').length, 3);
    assert.equal(result.createdIds.length, 6);
  });

  it('never writes alias or auto-managed columns', async () => {
    const ds = postsSource();
    await runGeneration(request({ count: 3 }), { ds, rng: makeRng() });

    for (const row of ds.written('posts')) {
      assert.ok(!('layout_divider' in row), 'presentation field must not be written');
      assert.ok(!('date_created' in row), 'date-created is filled by Directus');
      assert.ok(!('id' in row), 'primary key is filled by the database');
    }
  });

  it('respects max_length on generated strings', async () => {
    const ds = postsSource();
    await runGeneration(request({ count: 5 }), { ds, rng: makeRng() });
    for (const row of ds.written('posts')) {
      assert.ok(String(row.title).length <= 80);
    }
  });

  it('is reproducible: the same seed produces identical rows', async () => {
    const first = postsSource();
    const second = postsSource();
    await runGeneration(request(), { ds: first, rng: makeRng(4242) });
    await runGeneration(request(), { ds: second, rng: makeRng(4242) });

    assert.deepEqual(first.written('posts'), second.written('posts'));
  });

  it('a different seed produces different rows', async () => {
    const first = postsSource();
    const second = postsSource();
    await runGeneration(request(), { ds: first, rng: makeRng(1) });
    await runGeneration(request(), { ds: second, rng: makeRng(2) });

    assert.notDeepEqual(first.written('posts'), second.written('posts'));
  });

  it('batch size does not change the rows produced', async () => {
    const wide = postsSource();
    const narrow = postsSource();
    await runGeneration(request({ batchSize: 6 }), { ds: wide, rng: makeRng(77) });
    await runGeneration(request({ batchSize: 1 }), { ds: narrow, rng: makeRng(77) });

    assert.deepEqual(wide.written('posts'), narrow.written('posts'));
  });

  it('refuses to wipe without a typed confirmation', async () => {
    const ds = postsSource();
    await assert.rejects(
      () => runGeneration(request({ wipeFirst: true }), { ds, rng: makeRng() }),
      /confirmation missing/i
    );
    assert.deepEqual(ds.wipedCollections, []);
  });

  it('wipes when the confirmation matches', async () => {
    const ds = postsSource({ rows: { authors: [{ id: 1 }], posts: [{ id: 9 }] } });
    await runGeneration(request({ wipeFirst: true, confirm: 'posts', count: 2 }), {
      ds,
      rng: makeRng(),
    });
    assert.deepEqual(ds.wipedCollections, ['posts']);
  });

  it('refuses to generate into a singleton', async () => {
    const ds = new FakeDataSource({
      collections: { settings: { singleton: true } },
      fields: { settings: [rawField('id', 'integer', { schema: { is_primary_key: true } })] },
    });
    await assert.rejects(
      () => runGeneration(request({ collection: 'settings' }), { ds, rng: makeRng() }),
      /singleton/i
    );
  });

  it('fails before writing when a required relation has nothing to point at', async () => {
    const ds = new FakeDataSource({
      collections: { posts: { primary: 'id' }, authors: { primary: 'id' } },
      fields: {
        posts: [
          rawField('id', 'integer', { schema: { is_primary_key: true } }),
          rawField('author', 'integer', { meta: { required: true }, schema: { is_nullable: false } }),
        ],
        authors: [rawField('id', 'integer', { schema: { is_primary_key: true } })],
      },
      relations: [{ collection: 'posts', field: 'author', related_collection: 'authors', meta: {} }],
      rows: { authors: [] },
    });

    await assert.rejects(() => runGeneration(request(), { ds, rng: makeRng() }), /has no rows/i);
    assert.equal(ds.inserts.length, 0, 'nothing should have been written');
  });

  it('rejects a required field configured to produce nothing', async () => {
    const ds = postsSource();
    const strategies: StrategyMap = { title: { kind: 'null' } };
    await assert.rejects(
      () => runGeneration(request({ strategies }), { ds, rng: makeRng() }),
      /required but strategy/i
    );
  });

  it('rejects a required field with a null rate', async () => {
    const ds = postsSource();
    const strategies: StrategyMap = { title: { kind: 'faker', method: 'lorem.words', nullRate: 0.5 } };
    await assert.rejects(
      () => runGeneration(request({ strategies }), { ds, rng: makeRng() }),
      /leaves 50% of rows empty/i
    );
  });

  it('reports progress from start to completion', async () => {
    const ds = postsSource();
    const events: string[] = [];
    await runGeneration(request(), {
      ds,
      rng: makeRng(),
      onProgress: (event) => events.push(event.type),
    });
    assert.equal(events[0], 'start');
    assert.equal(events.at(-1), 'complete');
    assert.ok(events.filter((e) => e === 'batch').length === 3);
  });

  it('stops when the cancellation token trips, keeping what it wrote', async () => {
    const ds = postsSource();
    let aborted = false;
    const result = await runGeneration(request({ count: 10, batchSize: 2 }), {
      ds,
      rng: makeRng(),
      token: {
        get aborted() {
          return aborted;
        },
      },
      onProgress: (event) => {
        if (event.type === 'batch' && (event.rowsWritten ?? 0) >= 4) aborted = true;
      },
    });

    assert.equal(result.cancelled, true);
    assert.equal(result.rowsWritten, 4);
  });

  it('passes the fast-write flag through to the data source', async () => {
    const ds = postsSource();
    await runGeneration(request({ count: 2, options: { writeMode: 'fast' } }), { ds, rng: makeRng() });
    assert.equal(ds.inserts[0]!.opts?.fast, true);
  });

  it('warns instead of silently downgrading when fast write is unsupported', async () => {
    const ds = postsSource({ capabilities: { fastWrite: false } });
    const result = await runGeneration(request({ count: 2, options: { writeMode: 'fast' } }), {
      ds,
      rng: makeRng(),
    });
    assert.equal(ds.inserts[0]!.opts?.fast, false);
    assert.match(result.warnings.join(' '), /cannot suppress hooks/i);
  });
});

describe('runGeneration — m2m junctions', () => {
  it('writes junction rows for the parents it created', async () => {
    const ds = new FakeDataSource({
      collections: { posts: { primary: 'id' }, tags: { primary: 'id' }, posts_tags: { primary: 'id' } },
      fields: {
        posts: [
          rawField('id', 'integer', { schema: { is_primary_key: true } }),
          rawField('title', 'string', {}),
          rawField('tags', 'alias', { meta: { special: ['m2m'], interface: 'list-m2m' } }),
        ],
        tags: [rawField('id', 'integer', { schema: { is_primary_key: true } })],
      },
      relations: [
        {
          collection: 'posts_tags',
          field: 'posts_id',
          related_collection: 'posts',
          meta: { one_field: 'tags', junction_field: 'tags_id' },
        },
        {
          collection: 'posts_tags',
          field: 'tags_id',
          related_collection: 'tags',
          meta: { one_field: null, junction_field: 'posts_id' },
        },
      ],
      rows: { tags: [{ id: 1 }, { id: 2 }, { id: 3 }], posts: [] },
    });

    const result = await runGeneration(
      request({ collection: 'posts', count: 8, batchSize: 4, strategies: { tags: { kind: 'm2m_random', min: 1, max: 3 } } }),
      { ds, rng: makeRng(5) }
    );

    const junctionRows = ds.written('posts_tags');
    assert.ok(junctionRows.length >= 8, `expected at least one link per post, got ${junctionRows.length}`);
    assert.equal(result.junctionRowsWritten, junctionRows.length);
    for (const row of junctionRows) {
      assert.ok(row.posts_id !== undefined);
      assert.ok([1, 2, 3].includes(row.tags_id as number));
    }
  });
});

describe('runPreview', () => {
  it('returns rows without writing anything', async () => {
    const ds = postsSource();
    const result = await runPreview({ collection: 'posts', strategies: {}, count: 4 }, { ds, rng: makeRng() });
    assert.equal(result.rows.length, 4);
    assert.equal(ds.inserts.length, 0);
  });

  it('reports the values Directus would reject', async () => {
    const ds = postsSource();
    const result = await runPreview(
      { collection: 'posts', strategies: { title: { kind: 'fixed', value: 'x'.repeat(200) } }, count: 2 },
      { ds, rng: makeRng() }
    );
    assert.ok(result.issues.length === 0, 'over-long values are truncated before validation');

    const nulled = await runPreview(
      { collection: 'posts', strategies: { title: { kind: 'fixed', value: '' } }, count: 1 },
      { ds, rng: makeRng() }
    );
    assert.equal(nulled.issues.length, 1);
    assert.equal(nulled.issues[0]!.field, 'title');
  });

  it('caps the row count so a preview stays cheap', async () => {
    const ds = postsSource();
    const result = await runPreview({ collection: 'posts', strategies: {}, count: 5000 }, { ds, rng: makeRng() });
    assert.equal(result.rows.length, 50);
  });
});

describe('undoRun', () => {
  it('deletes exactly the ids it is given, in chunks', async () => {
    const ds = new FakeDataSource({
      collections: { posts: { primary: 'id' } },
      rows: { posts: [{ id: 1 }, { id: 2 }, { id: 3 }] },
    });
    const deleted = await undoRun(ds, 'posts', [1, 3], 1);
    assert.equal(deleted, 2);
    assert.equal(ds.deletedIds.length, 2);
    assert.deepEqual(await ds.readColumn('posts', 'id', 10), [2]);
  });
});

describe('orderFieldsByDependency', () => {
  it('builds a field after the field it reads', () => {
    const fields = [
      makeField({ field: 'item', suggestedStrategy: { kind: 'random_item_of_field', collectionField: 'collection' } }),
      makeField({ field: 'collection', suggestedStrategy: { kind: 'random_user_collection' } }),
    ];
    const ordered = orderFieldsByDependency(fields, {}).map((f) => f.field);
    assert.ok(ordered.indexOf('collection') < ordered.indexOf('item'));
  });

  it('orders template dependencies too', () => {
    const fields = [
      makeField({ field: 'slug', suggestedStrategy: { kind: 'template', template: '{{row.title | slug}}' } }),
      makeField({ field: 'title', suggestedStrategy: { kind: 'faker', method: 'lorem.words' } }),
    ];
    const ordered = orderFieldsByDependency(fields, {}).map((f) => f.field);
    assert.ok(ordered.indexOf('title') < ordered.indexOf('slug'));
  });

  it('does not hang on a cycle', () => {
    const fields = [
      makeField({ field: 'a', suggestedStrategy: { kind: 'template', template: '{{row.b}}' } }),
      makeField({ field: 'b', suggestedStrategy: { kind: 'template', template: '{{row.a}}' } }),
    ];
    const ordered = orderFieldsByDependency(fields, {}).map((f) => f.field);
    assert.equal(ordered.length, 2);
  });
});
