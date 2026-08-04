import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCollectionDescriptor, resolveDisplayName } from '../src/core/schema-model.js';
import { FakeDataSource, rawField } from './helpers.js';

function source() {
  return new FakeDataSource({
    collections: {
      posts: {
        primary: 'id',
        meta: {
          name: 'Blog Posts',
          sort_field: 'sort',
          archive_field: 'status',
          archive_value: 'archived',
          unarchive_value: 'draft',
          accountability: 'all',
        },
      },
      authors: { primary: 'id' },
    },
    fields: {
      posts: [
        rawField('id', 'uuid', {
          meta: { special: ['uuid'], hidden: true },
          schema: { is_primary_key: true, is_nullable: false, has_auto_increment: false },
        }),
        rawField('title', 'string', {
          meta: { interface: 'input', required: true, validation: { title: { _nnull: true } } },
          schema: { is_nullable: false, max_length: 200, is_unique: true },
        }),
        rawField('status', 'string', {
          meta: { interface: 'select-dropdown', options: { choices: [{ value: 'draft' }, { value: 'archived' }] } },
        }),
        rawField('sort', 'integer', { meta: { interface: 'input', hidden: true } }),
        rawField('divider', 'alias', { meta: { interface: 'presentation-divider', special: ['alias', 'no-data'] } }),
        rawField('author', 'uuid', { meta: { interface: 'select-dropdown-m2o' }, schema: { is_nullable: true } }),
        rawField('price', 'decimal', { schema: { numeric_precision: 6, numeric_scale: 2 } }),
        rawField('note', 'text', {
          meta: {
            interface: 'input-multiline',
            conditions: [{ name: 'only for drafts', rule: { status: { _eq: 'draft' } }, hidden: false }],
          },
        }),
      ],
      authors: [rawField('id', 'uuid', { schema: { is_primary_key: true } })],
    },
    relations: [{ collection: 'posts', field: 'author', related_collection: 'authors', meta: {} }],
    rows: { posts: [{ id: 'a' }, { id: 'b' }], authors: [{ id: 'x' }] },
  });
}

describe('buildCollectionDescriptor', () => {
  it('reads collection-level metadata', async () => {
    const descriptor = await buildCollectionDescriptor(source(), 'posts');
    assert.equal(descriptor.displayName, 'Blog Posts');
    assert.equal(descriptor.primaryKeyField, 'id');
    assert.equal(descriptor.primaryKeyType, 'uuid');
    assert.equal(descriptor.singleton, false);
    assert.equal(descriptor.rowCount, 2);
    assert.equal(descriptor.sortField, 'sort');
    assert.equal(descriptor.archiveField, 'status');
    assert.equal(descriptor.accountability, 'all');
  });

  it('marks the primary key and auto-managed fields as system', async () => {
    const descriptor = await buildCollectionDescriptor(source(), 'posts');
    const id = descriptor.fields.find((f) => f.field === 'id')!;
    assert.equal(id.isPrimaryKey, true);
    assert.equal(id.isSystemField, true);
    assert.equal(id.suggestedStrategy.kind, 'system');
  });

  it('flags alias fields and never suggests writing them', async () => {
    const descriptor = await buildCollectionDescriptor(source(), 'posts');
    const divider = descriptor.fields.find((f) => f.field === 'divider')!;
    assert.equal(divider.isAlias, true);
    assert.equal(divider.required, false, 'an alias field can never be required');
    assert.equal(divider.suggestedStrategy.kind, 'skip');
  });

  it('detects the many-to-one relation', async () => {
    const descriptor = await buildCollectionDescriptor(source(), 'posts');
    const author = descriptor.fields.find((f) => f.field === 'author')!;
    assert.equal(author.relation?.type, 'm2o');
    assert.equal(author.relation?.relatedCollection, 'authors');
    assert.equal(author.suggestedStrategy.kind, 'm2o_random');
  });

  it('carries constraints, uniqueness and length through to the field', async () => {
    const descriptor = await buildCollectionDescriptor(source(), 'posts');
    const title = descriptor.fields.find((f) => f.field === 'title')!;
    assert.equal(title.required, true);
    assert.equal(title.isUnique, true);
    assert.equal(title.maxLength, 200);
    assert.equal(title.constraints?.notNull, true);
  });

  it('derives the decimal ceiling from precision and scale', async () => {
    const descriptor = await buildCollectionDescriptor(source(), 'posts');
    const price = descriptor.fields.find((f) => f.field === 'price')!;
    assert.equal(price.numericScale, 2);
    assert.equal(Math.round((price.constraints?.max ?? 0) * 100) / 100, 9999.99);
  });

  it('keeps conditional-field rules', async () => {
    const descriptor = await buildCollectionDescriptor(source(), 'posts');
    const note = descriptor.fields.find((f) => f.field === 'note')!;
    assert.equal(note.conditions?.length, 1);
  });

  it('makes the sort column increment so drag-and-drop works', async () => {
    const descriptor = await buildCollectionDescriptor(source(), 'posts');
    const sort = descriptor.fields.find((f) => f.field === 'sort')!;
    assert.equal(sort.suggestedStrategy.kind, 'sequence');
  });

  it('keeps most rows unarchived on the archive column', async () => {
    const descriptor = await buildCollectionDescriptor(source(), 'posts');
    const status = descriptor.fields.find((f) => f.field === 'status')!;
    assert.equal(status.suggestedStrategy.kind, 'weighted_choice');
    const choices = (status.suggestedStrategy as any).choices as Array<{ value: unknown; weight: number }>;
    const archived = choices.find((c) => c.value === 'archived')!;
    const others = choices.filter((c) => c.value !== 'archived');
    assert.ok(others.every((c) => c.weight > archived.weight));
  });

  it('explains every suggestion', async () => {
    const descriptor = await buildCollectionDescriptor(source(), 'posts');
    for (const field of descriptor.fields) {
      assert.ok(field.reason && field.reason.length > 0, `${field.field} has no reason`);
    }
  });

  it('throws a clear error for an unknown collection', async () => {
    await assert.rejects(() => buildCollectionDescriptor(source(), 'nope'), /Collection not found/);
  });

  it('applies curated rules for Directus system collections', async () => {
    const ds = new FakeDataSource({
      collections: { directus_users: { primary: 'id' } },
      fields: {
        directus_users: [
          rawField('id', 'uuid', { meta: { special: ['uuid'] }, schema: { is_primary_key: true } }),
          rawField('provider', 'string', { meta: { interface: 'input' } }),
        ],
      },
    });
    const descriptor = await buildCollectionDescriptor(ds, 'directus_users');
    const provider = descriptor.fields.find((f) => f.field === 'provider')!;
    assert.deepEqual(provider.suggestedStrategy, { kind: 'fixed', value: 'default' });
    assert.match(provider.reason ?? '', /system field/i);
  });
});

describe('resolveDisplayName', () => {
  it('prefers the configured name', () => {
    assert.equal(resolveDisplayName('posts', { collection: 'posts', meta: { name: 'Articles' } }), 'Articles');
  });

  it('falls back to English translations', () => {
    const name = resolveDisplayName('posts', {
      collection: 'posts',
      meta: { translations: [{ language: 'en-US', translation: 'Stories' }] },
    });
    assert.equal(name, 'Stories');
  });

  it('humanises the key as a last resort', () => {
    assert.equal(resolveDisplayName('blog_posts', null), 'Blog Posts');
    assert.equal(resolveDisplayName('directus_activity', null), 'Activity');
  });
});
