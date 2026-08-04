import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { collectionInsights, insightWarnings } from '../src/core/insights.js';
import { planProject, runProject } from '../src/core/project.js';
import { looksLikeProduction } from '../src/endpoint/adapters/items-service-data-source.js';
import { FakeDataSource, makeRng, rawField } from './helpers.js';

function projectSource() {
  return new FakeDataSource({
    collections: {
      authors: { primary: 'id', meta: { accountability: 'all' } },
      posts: { primary: 'id', meta: { accountability: 'all' } },
      comments: { primary: 'id', meta: { accountability: null } },
    },
    fields: {
      authors: [
        rawField('id', 'integer', { schema: { is_primary_key: true } }),
        rawField('name', 'string', {}),
      ],
      posts: [
        rawField('id', 'integer', { schema: { is_primary_key: true } }),
        rawField('title', 'string', { meta: { required: true }, schema: { is_nullable: false } }),
        rawField('author', 'integer', { meta: { required: true }, schema: { is_nullable: false } }),
      ],
      comments: [
        rawField('id', 'integer', { schema: { is_primary_key: true } }),
        rawField('body', 'text', {}),
        rawField('post', 'integer', { meta: { required: true }, schema: { is_nullable: false } }),
      ],
    },
    relations: [
      { collection: 'posts', field: 'author', related_collection: 'authors', meta: {} },
      { collection: 'comments', field: 'post', related_collection: 'posts', meta: { one_field: 'comments' } },
    ],
    rows: { authors: [], posts: [], comments: [] },
    flows: [
      {
        id: 'f1',
        name: 'Send welcome email',
        status: 'active',
        trigger: 'event',
        collections: ['posts'],
        actions: ['items.create'],
      },
      {
        id: 'f2',
        name: 'Inactive cleanup',
        status: 'inactive',
        trigger: 'event',
        collections: ['posts'],
        actions: ['items.create'],
      },
      {
        id: 'f3',
        name: 'Nightly report',
        status: 'active',
        trigger: 'schedule',
        collections: [],
        actions: [],
      },
    ],
    environment: { publicUrl: 'https://cms.example.com', isProduction: true },
  });
}

describe('collectionInsights', () => {
  it('finds only the active item-create flows for this collection', async () => {
    const insights = await collectionInsights(projectSource(), 'posts');
    assert.deepEqual(
      insights.flows.map((f) => f.name),
      ['Send welcome email']
    );
  });

  it('reports the collections that must be seeded first', async () => {
    const insights = await collectionInsights(projectSource(), 'posts');
    const authors = insights.dependencies.find((d) => d.collection === 'authors')!;
    assert.equal(authors.required, true);
    assert.equal(authors.rowCount, 0);
  });

  it('reports the collections that point at this one', async () => {
    const insights = await collectionInsights(projectSource(), 'posts');
    assert.deepEqual(
      insights.dependents.map((d) => d.collection),
      ['comments']
    );
  });

  it('knows whether revisions will be written', async () => {
    const insights = await collectionInsights(projectSource(), 'posts');
    assert.equal(insights.writesRevisions, true);

    const quiet = await collectionInsights(projectSource(), 'comments');
    assert.equal(quiet.writesRevisions, false);
  });
});

describe('insightWarnings', () => {
  it('spells out the flow storm, the revision volume, the missing parents and production', async () => {
    const insights = await collectionInsights(projectSource(), 'posts');
    const warnings = insightWarnings(insights, 5000);
    const joined = warnings.join('\n');

    assert.match(joined, /looks like production/i);
    assert.match(joined, /Send welcome email/);
    assert.match(joined, /5,000 times/);
    assert.match(joined, /revision rows/i);
    assert.match(joined, /Seed authors first/i);
  });

  it('stays quiet about revisions on a small run', async () => {
    const insights = await collectionInsights(projectSource(), 'posts');
    const warnings = insightWarnings(insights, 10).join('\n');
    assert.doesNotMatch(warnings, /revision rows/i);
  });
});

describe('looksLikeProduction', () => {
  it('treats localhost and dev-ish hosts as not production', () => {
    assert.equal(looksLikeProduction('http://localhost:8055', 'production'), false);
    assert.equal(looksLikeProduction('https://staging.example.com', 'production'), false);
    assert.equal(looksLikeProduction('https://cms-dev.example.com', 'production'), false);
    assert.equal(looksLikeProduction('https://cms.example.com', 'development'), false);
  });

  it('treats a plain public host as production', () => {
    assert.equal(looksLikeProduction('https://cms.example.com', 'production'), true);
    assert.equal(looksLikeProduction('https://cms.example.com', ''), true);
  });
});

describe('planProject', () => {
  it('orders collections so parents exist first and sizes them from the graph', async () => {
    const plan = await planProject(projectSource(), { collections: ['comments', 'posts', 'authors'] });
    assert.deepEqual(plan.order, ['authors', 'posts', 'comments']);
    assert.ok(plan.counts.authors! < plan.counts.comments!);
  });

  it('warns when a required parent is outside the selection and empty', async () => {
    const plan = await planProject(projectSource(), { collections: ['posts'] });
    assert.match(plan.notes.join('\n'), /authors/);
  });

  it('honours explicit counts', async () => {
    const plan = await planProject(projectSource(), {
      collections: ['authors', 'posts'],
      counts: { authors: 3, posts: 7 },
    });
    assert.equal(plan.counts.authors, 3);
    assert.equal(plan.counts.posts, 7);
  });
});

describe('runProject', () => {
  it('seeds each collection in order and reports per-collection results', async () => {
    const ds = projectSource();
    const plan = await planProject(ds, {
      collections: ['authors', 'posts', 'comments'],
      counts: { authors: 2, posts: 3, comments: 4 },
    });

    const result = await runProject({ plan }, { ds, rng: makeRng(31) });

    assert.equal(result.totalRows, 9);
    assert.deepEqual(
      result.results.map((r) => r.collection),
      ['authors', 'posts', 'comments']
    );
    assert.equal(ds.written('posts').length, 3);
    // Posts must reference authors created earlier in the same run.
    const authorIds = new Set((await ds.readColumn('authors', 'id', 100)).map(String));
    for (const row of ds.written('posts')) {
      assert.ok(authorIds.has(String(row.author)), `unknown author ${row.author}`);
    }
  });

  it('keeps going after one collection fails and records the error', async () => {
    const ds = projectSource();
    const plan = await planProject(ds, {
      collections: ['authors', 'posts'],
      counts: { authors: 2, posts: 2 },
    });

    const original = ds.insertMany.bind(ds);
    ds.insertMany = async (collection, rows, opts) => {
      if (collection === 'posts') throw new Error('constraint violation');
      return original(collection, rows, opts);
    };

    const result = await runProject({ plan }, { ds, rng: makeRng(32) });
    assert.equal(result.results.find((r) => r.collection === 'authors')?.rowsWritten, 2);
    assert.match(result.results.find((r) => r.collection === 'posts')?.error ?? '', /constraint violation/);
  });

  it('only wipes the collections explicitly confirmed', async () => {
    const ds = projectSource();
    await ds.insertMany('authors', [{ name: 'existing' }]);
    const plan = await planProject(ds, { collections: ['authors', 'posts'], counts: { authors: 1, posts: 1 } });

    await runProject({ plan, wipeFirst: true, confirmWipe: ['authors'] }, { ds, rng: makeRng(33) });

    assert.deepEqual(ds.wipedCollections, ['authors']);
  });
});
