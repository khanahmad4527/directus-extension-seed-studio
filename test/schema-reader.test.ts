import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCollectionDescriptor } from '../src/endpoint/core/schema-reader.js';

function fakeItemsService() {
  return class {
    constructor(public collection: string, public ctx: any) {}
    async readByQuery() {
      return [{ count: 42 }];
    }
  };
}

describe('buildCollectionDescriptor', () => {
  const services = { ItemsService: fakeItemsService() };

  it('detects M2O via relations and adds m2o_random strategy', async () => {
    const schema = {
      collections: {
        posts: { collection: 'posts', primary: 'id', meta: { name: 'Posts' } },
        authors: { collection: 'authors', primary: 'id', meta: { name: 'Authors' } },
      },
      fields: {
        posts: {
          id: {
            field: 'id',
            type: 'uuid',
            schema: { is_primary_key: true, is_nullable: false },
            meta: {},
          },
          title: {
            field: 'title',
            type: 'string',
            schema: { is_nullable: false, max_length: 200 },
            meta: { interface: 'input' },
          },
          author: {
            field: 'author',
            type: 'uuid',
            schema: { is_nullable: true },
            meta: { interface: 'select-dropdown-m2o' },
          },
        },
      },
      relations: [
        { collection: 'posts', field: 'author', related_collection: 'authors', meta: {} },
      ],
    };

    const descriptor = await buildCollectionDescriptor('posts', services, schema, { admin: true });

    assert.equal(descriptor.collection, 'posts');
    assert.equal(descriptor.rowCount, 42);
    assert.equal(descriptor.primaryKeyField, 'id');

    const author = descriptor.fields.find((f) => f.field === 'author')!;
    assert.equal(author.relation?.type, 'm2o');
    assert.equal(author.relation?.relatedCollection, 'authors');
    assert.equal(author.suggestedStrategy.kind, 'm2o_random');

    const title = descriptor.fields.find((f) => f.field === 'title')!;
    assert.equal(title.maxLength, 200);
    assert.equal(title.required, true);
  });

  it('detects directus_files relation as file_reuse', async () => {
    const schema = {
      collections: {
        posts: { collection: 'posts', primary: 'id', meta: {} },
        directus_files: { collection: 'directus_files', primary: 'id', meta: {} },
      },
      fields: {
        posts: {
          cover: { field: 'cover', type: 'uuid', schema: { is_nullable: true }, meta: {} },
        },
      },
      relations: [{ collection: 'posts', field: 'cover', related_collection: 'directus_files', meta: {} }],
    };
    const d = await buildCollectionDescriptor('posts', services, schema, { admin: true });
    const cover = d.fields.find((f) => f.field === 'cover')!;
    assert.equal(cover.suggestedStrategy.kind, 'file_reuse');
  });
});
