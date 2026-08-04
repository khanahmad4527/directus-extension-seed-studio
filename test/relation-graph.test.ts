import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRelationGraph,
  resolveRelation,
  suggestCounts,
  topoSortCollections,
} from '../src/core/relation-graph.js';
import type { RawField, RawRelation } from '../src/core/data-source.js';
import { rawField } from './helpers.js';

const relations: RawRelation[] = [
  { collection: 'posts', field: 'author', related_collection: 'authors', meta: {} },
  { collection: 'comments', field: 'post', related_collection: 'posts', meta: { one_field: 'comments' } },
  { collection: 'authors', field: 'manager', related_collection: 'authors', meta: {} },
];

const fields = new Map<string, RawField[]>([
  ['posts', [rawField('author', 'integer', { meta: { required: true }, schema: { is_nullable: false } })]],
  ['comments', [rawField('post', 'integer', { meta: { required: true }, schema: { is_nullable: false } })]],
  ['authors', [rawField('manager', 'integer', { schema: { is_nullable: true } })]],
]);

describe('buildRelationGraph', () => {
  it('records which collection depends on which', () => {
    const graph = buildRelationGraph(relations, fields);
    assert.deepEqual(
      graph.dependenciesOf('posts').map((e) => e.to),
      ['authors']
    );
    assert.deepEqual(
      graph.dependentsOf('posts').map((e) => e.from),
      ['comments']
    );
  });

  it('marks required foreign keys as unbreakable', () => {
    const graph = buildRelationGraph(relations, fields);
    const edge = graph.edges.find((e) => e.from === 'posts' && e.to === 'authors')!;
    assert.equal(edge.required, true);
    assert.equal(edge.breakable, false);
  });

  it('treats a self-reference as breakable', () => {
    const graph = buildRelationGraph(relations, fields);
    const edge = graph.edges.find((e) => e.from === 'authors' && e.to === 'authors')!;
    assert.equal(edge.breakable, true);
  });
});

describe('topoSortCollections', () => {
  it('puts parents before children', () => {
    const graph = buildRelationGraph(relations, fields);
    const { order, cycles } = topoSortCollections(['comments', 'posts', 'authors'], graph);
    assert.deepEqual(order, ['authors', 'posts', 'comments']);
    assert.deepEqual(cycles, []);
  });

  it('ignores dependencies outside the selection', () => {
    const graph = buildRelationGraph(relations, fields);
    const { order } = topoSortCollections(['comments'], graph);
    assert.deepEqual(order, ['comments']);
  });

  it('breaks a cycle on the optional edge and reports it', () => {
    const cyclic: RawRelation[] = [
      { collection: 'a', field: 'b_id', related_collection: 'b', meta: {} },
      { collection: 'b', field: 'a_id', related_collection: 'a', meta: {} },
    ];
    const cyclicFields = new Map<string, RawField[]>([
      ['a', [rawField('b_id', 'integer', { meta: { required: true }, schema: { is_nullable: false } })]],
      ['b', [rawField('a_id', 'integer', { schema: { is_nullable: true } })]],
    ]);

    const graph = buildRelationGraph(cyclic, cyclicFields);
    const { order, cycles } = topoSortCollections(['a', 'b'], graph);

    assert.equal(order.length, 2);
    assert.equal(cycles.length, 1);
    assert.equal(cycles[0]!.brokenAt?.from, 'b');
    // `a.b_id` is required, so `b` has to be seeded first.
    assert.deepEqual(order, ['b', 'a']);
  });

  it('still returns an order when a cycle has no optional edge', () => {
    const hard: RawRelation[] = [
      { collection: 'a', field: 'b_id', related_collection: 'b', meta: {} },
      { collection: 'b', field: 'a_id', related_collection: 'a', meta: {} },
    ];
    const hardFields = new Map<string, RawField[]>([
      ['a', [rawField('b_id', 'integer', { meta: { required: true }, schema: { is_nullable: false } })]],
      ['b', [rawField('a_id', 'integer', { meta: { required: true }, schema: { is_nullable: false } })]],
    ]);
    const graph = buildRelationGraph(hard, hardFields);
    const { order, cycles } = topoSortCollections(['a', 'b'], graph);
    assert.equal(order.length, 2);
    assert.equal(cycles[0]!.brokenAt, null);
  });
});

describe('suggestCounts', () => {
  it('gives lookup tables fewer rows than the tables pointing at them', () => {
    const graph = buildRelationGraph(relations, fields);
    const counts = suggestCounts(['authors', 'posts', 'comments'], graph, 200);
    assert.ok(counts.authors! < counts.posts!, `${counts.authors} !< ${counts.posts}`);
    assert.ok(counts.posts! < counts.comments!, `${counts.posts} !< ${counts.comments}`);
  });

  it('stays inside sane bounds', () => {
    const graph = buildRelationGraph(relations, fields);
    for (const value of Object.values(suggestCounts(['authors', 'posts', 'comments'], graph, 200))) {
      assert.ok(value >= 5 && value <= 5000);
    }
  });
});

describe('resolveRelation', () => {
  it('resolves a many-to-one', () => {
    assert.deepEqual(resolveRelation('posts', 'author', relations), {
      type: 'm2o',
      relatedCollection: 'authors',
    });
  });

  it('resolves a self-reference', () => {
    assert.deepEqual(resolveRelation('authors', 'manager', relations), {
      type: 'self',
      relatedCollection: 'authors',
    });
  });

  it('resolves a one-to-many including the child column', () => {
    assert.deepEqual(resolveRelation('posts', 'comments', relations), {
      type: 'o2m',
      relatedCollection: 'comments',
      childField: 'post',
    });
  });

  it('resolves a many-to-many with both junction columns', () => {
    const m2m: RawRelation[] = [
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
    ];
    assert.deepEqual(resolveRelation('posts', 'tags', m2m), {
      type: 'm2m',
      relatedCollection: 'tags',
      junction: 'posts_tags',
      junctionParentField: 'posts_id',
      junctionRelatedField: 'tags_id',
    });
  });

  it('resolves a many-to-any from the allowed collection list', () => {
    const m2a: RawRelation[] = [
      {
        collection: 'pages',
        field: 'blocks',
        related_collection: null,
        meta: { one_allowed_collections: ['text', 'image'] },
      },
    ];
    const resolved = resolveRelation('pages', 'blocks', m2a);
    assert.equal(resolved?.type, 'm2a');
    assert.deepEqual(resolved?.relatedCollections, ['text', 'image']);
  });

  it('returns null for a plain column', () => {
    assert.equal(resolveRelation('posts', 'title', relations), null);
  });
});
