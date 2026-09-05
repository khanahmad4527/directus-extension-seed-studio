import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { preflightDependencies } from '../src/core/preflight.js';
import { FakeDataSource, rawField } from './helpers.js';

/**
 * A blog-shaped schema: comments → posts → authors, plus an optional category.
 * `required` comes from `schema.is_nullable === false`, matching how
 * buildRelationGraph reads real Directus metadata.
 */
function blogSource(rows: Record<string, Record<string, unknown>[]> = {}) {
  const fk = (field: string, nullable: boolean) =>
    rawField(field, 'uuid', { schema: { is_nullable: nullable } });

  return new FakeDataSource({
    collections: {
      ss_authors: {},
      ss_categories: {},
      ss_posts: {},
      ss_comments: {},
    },
    fields: {
      ss_authors: [rawField('id', 'uuid'), rawField('name', 'string')],
      ss_categories: [rawField('id', 'uuid'), rawField('name', 'string')],
      ss_posts: [rawField('id', 'uuid'), fk('author', false), fk('category', true)],
      ss_comments: [rawField('id', 'uuid'), fk('post', false)],
    },
    relations: [
      { collection: 'ss_posts', field: 'author', related_collection: 'ss_authors', meta: {} },
      { collection: 'ss_posts', field: 'category', related_collection: 'ss_categories', meta: {} },
      { collection: 'ss_comments', field: 'post', related_collection: 'ss_posts', meta: {} },
    ] as any,
    rows,
  });
}

describe('preflightDependencies — the empty-parent case', () => {
  it('reports the whole chain when nothing has been seeded yet', async () => {
    const result = await preflightDependencies(blogSource(), 'ss_comments', 100);

    assert.equal(result.satisfied, false);
    const blocking = result.blocking.map((p) => p.collection);
    // comments needs posts, and posts in turn needs authors.
    assert.deepEqual(blocking, ['ss_posts', 'ss_authors']);
  });

  it('orders the suggested run parents-first, ending with the target', async () => {
    const result = await preflightDependencies(blogSource(), 'ss_comments', 100);
    const order = result.suggestedOrder;

    assert.ok(
      order.indexOf('ss_authors') < order.indexOf('ss_posts'),
      `authors must precede posts, got ${order.join(' → ')}`
    );
    assert.ok(
      order.indexOf('ss_posts') < order.indexOf('ss_comments'),
      `posts must precede comments, got ${order.join(' → ')}`
    );
    assert.equal(order.at(-1), 'ss_comments');
  });

  it('sizes each parent below its child, and never below the floor', async () => {
    const result = await preflightDependencies(blogSource(), 'ss_comments', 100);
    const counts = result.suggestedCounts;

    assert.equal(counts.ss_comments, 100);
    assert.equal(counts.ss_posts, 20); // 100 / 5
    assert.equal(counts.ss_authors, 4); // 20 / 5
    for (const [name, value] of Object.entries(counts)) {
      assert.ok(value >= 1, `${name} got a nonsense count of ${value}`);
    }
  });

  it('stops descending once a parent already has rows', async () => {
    // posts exist, so authors is irrelevant to seeding comments.
    const result = await preflightDependencies(
      blogSource({ ss_posts: [{ id: 'p1' }] }),
      'ss_comments',
      50
    );

    assert.equal(result.satisfied, true);
    assert.deepEqual(result.blocking, []);
    assert.deepEqual(result.suggestedOrder, ['ss_comments']);
  });
});

describe('preflightDependencies — required vs optional', () => {
  it('treats a nullable empty parent as a warning, not a blocker', async () => {
    // authors exists so the required FK is satisfied; category is nullable.
    const result = await preflightDependencies(
      blogSource({ ss_authors: [{ id: 'a1' }] }),
      'ss_posts',
      10
    );

    assert.equal(result.satisfied, true, 'a nullable gap must not block the run');
    assert.deepEqual(result.blocking, []);
    assert.deepEqual(
      result.warnings.map((w) => w.collection),
      ['ss_categories']
    );
    assert.equal(result.warnings[0]?.required, false);
  });

  it('does not pull an optional parent into the suggested run', async () => {
    const result = await preflightDependencies(
      blogSource({ ss_authors: [{ id: 'a1' }] }),
      'ss_posts',
      10
    );
    assert.ok(
      !result.suggestedOrder.includes('ss_categories'),
      'an optional empty parent should be reported, not scheduled'
    );
  });

  it('records which field created the dependency', async () => {
    const result = await preflightDependencies(blogSource(), 'ss_comments', 10);
    const posts = result.blocking.find((p) => p.collection === 'ss_posts');
    assert.equal(posts?.neededBy, 'ss_comments');
    assert.equal(posts?.field, 'post');
    assert.equal(posts?.required, true);
    assert.deepEqual(posts?.requiredBy, [
      { collection: 'ss_comments', field: 'post', required: true },
    ]);
  });

  it('merges a collection demanded by more than one field into one entry', async () => {
    // Two nullable file references, one parent. Rendering it twice would give
    // the panel duplicate rows sharing a single checkbox and count.
    const ds = new FakeDataSource({
      collections: { gallery: {}, directus_files: {} },
      fields: {
        gallery: [
          rawField('id', 'uuid'),
          rawField('cover', 'uuid', { schema: { is_nullable: true } }),
          rawField('thumbnail', 'uuid', { schema: { is_nullable: true } }),
        ],
      },
      relations: [
        { collection: 'gallery', field: 'cover', related_collection: 'directus_files', meta: {} },
        { collection: 'gallery', field: 'thumbnail', related_collection: 'directus_files', meta: {} },
      ] as any,
    });

    const result = await preflightDependencies(ds, 'gallery', 10);
    assert.equal(result.warnings.length, 1, 'one entry per collection');
    assert.deepEqual(
      result.warnings[0]?.requiredBy.map((r) => r.field).sort(),
      ['cover', 'thumbnail']
    );
  });

  it('treats a parent demanded by both a required and an optional field as required', async () => {
    const ds = new FakeDataSource({
      collections: { parent: {}, child: {} },
      fields: {
        child: [
          rawField('id', 'uuid'),
          rawField('main', 'uuid', { schema: { is_nullable: false } }),
          rawField('backup', 'uuid', { schema: { is_nullable: true } }),
        ],
      },
      relations: [
        { collection: 'child', field: 'backup', related_collection: 'parent', meta: {} },
        { collection: 'child', field: 'main', related_collection: 'parent', meta: {} },
      ] as any,
    });

    const result = await preflightDependencies(ds, 'child', 10);
    assert.equal(result.satisfied, false);
    assert.deepEqual(result.warnings, [], 'must not be downgraded to a warning');
    assert.deepEqual(
      result.blocking.map((p) => p.collection),
      ['parent']
    );
  });
});

describe('preflightDependencies — things it must not choke on', () => {
  it('ignores a self-reference', async () => {
    const ds = new FakeDataSource({
      collections: { staff: {} },
      fields: {
        staff: [rawField('id', 'uuid'), rawField('manager', 'uuid', { schema: { is_nullable: false } })],
      },
      relations: [{ collection: 'staff', field: 'manager', related_collection: 'staff', meta: {} }] as any,
    });

    const result = await preflightDependencies(ds, 'staff', 10);
    assert.equal(result.satisfied, true, 'a self-reference is filled in a later pass');
    assert.deepEqual(result.blocking, []);
  });

  it('separates a required parent it refuses to seed from ones it can', async () => {
    const ds = new FakeDataSource({
      collections: { audit_notes: {} },
      fields: {
        audit_notes: [
          rawField('id', 'uuid'),
          rawField('revision', 'uuid', { schema: { is_nullable: false } }),
        ],
      },
      relations: [
        { collection: 'audit_notes', field: 'revision', related_collection: 'directus_revisions', meta: {} },
      ] as any,
    });

    const result = await preflightDependencies(ds, 'audit_notes', 10);
    assert.equal(result.satisfied, false);
    assert.deepEqual(result.blocking, [], 'a blocked system table is not offerable');
    assert.deepEqual(
      result.unresolvable.map((p) => p.collection),
      ['directus_revisions']
    );
    assert.equal(result.unresolvable[0]?.seedable, false);
    assert.ok((result.unresolvable[0]?.blockedReason ?? '').length > 0);
  });

  it('survives a two-collection cycle without hanging', async () => {
    const ds = new FakeDataSource({
      collections: { a: {}, b: {} },
      fields: {
        a: [rawField('id', 'uuid'), rawField('b_id', 'uuid', { schema: { is_nullable: false } })],
        b: [rawField('id', 'uuid'), rawField('a_id', 'uuid', { schema: { is_nullable: true } })],
      },
      relations: [
        { collection: 'a', field: 'b_id', related_collection: 'b', meta: {} },
        { collection: 'b', field: 'a_id', related_collection: 'a', meta: {} },
      ] as any,
    });

    const result = await preflightDependencies(ds, 'a', 10);
    // b is required by a and empty, so it is a blocker; b's own link back to a
    // is nullable, which is the edge the topological sort defers.
    assert.deepEqual(
      result.blocking.map((p) => p.collection),
      ['b']
    );
    assert.equal(result.suggestedOrder.at(-1), 'a');
  });

  it('treats an unreadable collection as having no dependencies', async () => {
    const ds = new FakeDataSource({ collections: { lonely: {} } });
    const result = await preflightDependencies(ds, 'lonely', 10);
    assert.equal(result.satisfied, true);
    assert.deepEqual(result.suggestedOrder, ['lonely']);
  });
});
