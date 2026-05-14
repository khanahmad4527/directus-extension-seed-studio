import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectStrategy, hasAutoManagedSpecial } from '../src/endpoint/core/strategy-detector.js';

function ctx(overrides: Partial<Parameters<typeof detectStrategy>[0]> = {}) {
  return {
    fieldName: 'foo',
    type: 'string',
    interfaceName: null,
    options: null,
    specials: [],
    relation: null,
    nullable: true,
    isPrimaryKey: false,
    ...overrides,
  };
}

describe('detectStrategy — auto-managed by special', () => {
  it('primary key returns system', () => {
    assert.equal(detectStrategy(ctx({ fieldName: 'id', isPrimaryKey: true })).kind, 'system');
  });
  it('special uuid returns system', () => {
    assert.equal(detectStrategy(ctx({ fieldName: 'token', specials: ['uuid'] })).kind, 'system');
  });
  it('special date-created returns system', () => {
    assert.equal(detectStrategy(ctx({ fieldName: 'created_at', specials: ['date-created'] })).kind, 'system');
  });
  it('special user-created returns system', () => {
    assert.equal(detectStrategy(ctx({ fieldName: 'owner', specials: ['user-created'] })).kind, 'system');
  });
  it('field named "id" WITHOUT pk/special is NOT system — treated as plain field', () => {
    const s = detectStrategy(ctx({ fieldName: 'id', type: 'string' }));
    assert.notEqual(s.kind, 'system');
  });
  it('field named "sort" WITHOUT special is NOT system', () => {
    const s = detectStrategy(ctx({ fieldName: 'sort', type: 'integer' }));
    assert.notEqual(s.kind, 'system');
  });
  it('hasAutoManagedSpecial flags auto-managed specials only', () => {
    assert.equal(hasAutoManagedSpecial(['uuid']), true);
    assert.equal(hasAutoManagedSpecial(['date-created']), true);
    assert.equal(hasAutoManagedSpecial(['user-updated']), true);
    assert.equal(hasAutoManagedSpecial(['hash']), false);
    assert.equal(hasAutoManagedSpecial(['file']), false);
    assert.equal(hasAutoManagedSpecial([]), false);
  });
});

describe('detectStrategy — emails', () => {
  it('email field maps to internet.email', () => {
    const s = detectStrategy(ctx({ fieldName: 'email' }));
    assert.equal(s.kind, 'faker');
    assert.equal((s as any).method, 'internet.email');
  });
  it('user_email also maps to email faker', () => {
    const s = detectStrategy(ctx({ fieldName: 'user_email' }));
    assert.equal(s.kind, 'faker');
    assert.equal((s as any).method, 'internet.email');
  });
  it('contact_email also maps to email faker', () => {
    const s = detectStrategy(ctx({ fieldName: 'contact_email' }));
    assert.equal(s.kind, 'faker');
    assert.equal((s as any).method, 'internet.email');
  });
});

describe('detectStrategy — relations', () => {
  it('m2o relation returns m2o_random with related collection', () => {
    const s = detectStrategy(
      ctx({
        fieldName: 'author',
        relation: { type: 'm2o', relatedCollection: 'authors' },
      })
    );
    assert.equal(s.kind, 'm2o_random');
    assert.equal((s as any).relatedCollection, 'authors');
  });
  it('directus_files relation returns file_reuse', () => {
    const s = detectStrategy(
      ctx({
        fieldName: 'cover',
        relation: { type: 'm2o', relatedCollection: 'directus_files' },
      })
    );
    assert.equal(s.kind, 'file_reuse');
  });
});

describe('detectStrategy — name field uses collection context', () => {
  it('users.name -> person.fullName', () => {
    const s = detectStrategy(ctx({ fieldName: 'name', collectionName: 'users' }));
    assert.equal(s.kind, 'faker');
    assert.equal((s as any).method, 'person.fullName');
  });
  it('authors.name -> person.fullName', () => {
    const s = detectStrategy(ctx({ fieldName: 'name', collectionName: 'authors' }));
    assert.equal((s as any).method, 'person.fullName');
  });
  it('companies.name -> company.name', () => {
    const s = detectStrategy(ctx({ fieldName: 'name', collectionName: 'companies' }));
    assert.equal((s as any).method, 'company.name');
  });
  it('products.name -> commerce.productName', () => {
    const s = detectStrategy(ctx({ fieldName: 'name', collectionName: 'products' }));
    assert.equal((s as any).method, 'commerce.productName');
  });
  it('books.name -> lorem.sentence (titles)', () => {
    const s = detectStrategy(ctx({ fieldName: 'name', collectionName: 'books' }));
    assert.equal((s as any).method, 'lorem.sentence');
  });
  it('categories.name -> lorem.words (fallback)', () => {
    const s = detectStrategy(ctx({ fieldName: 'name', collectionName: 'categories' }));
    assert.equal((s as any).method, 'lorem.words');
  });
  it('full_name always -> person.fullName regardless of collection', () => {
    const s = detectStrategy(ctx({ fieldName: 'full_name', collectionName: 'whatever' }));
    assert.equal((s as any).method, 'person.fullName');
  });
});

describe('detectStrategy — choices', () => {
  it('returns random_choice for select-dropdown with choices', () => {
    const s = detectStrategy(
      ctx({
        fieldName: 'status',
        interfaceName: 'select-dropdown',
        options: { choices: [{ value: 'a' }, { value: 'b' }] },
      })
    );
    assert.equal(s.kind, 'random_choice');
    assert.deepEqual((s as any).choices, ['a', 'b']);
  });

  it('returns random_choice for select-radio with choices', () => {
    const s = detectStrategy(
      ctx({
        fieldName: 'priority',
        interfaceName: 'select-radio',
        options: { choices: [{ value: 'low' }, { value: 'high' }] },
      })
    );
    assert.equal(s.kind, 'random_choice');
    assert.deepEqual((s as any).choices, ['low', 'high']);
  });

  it('returns random_choice for ANY interface when options.choices present', () => {
    const s = detectStrategy(
      ctx({
        fieldName: 'visibility',
        interfaceName: 'custom-toggle',
        options: { choices: ['public', 'private', 'unlisted'] },
      })
    );
    assert.equal(s.kind, 'random_choice');
    assert.deepEqual((s as any).choices, ['public', 'private', 'unlisted']);
  });
});

describe('detectStrategy — slider with options', () => {
  it('honors minValue/maxValue from slider options', () => {
    const s = detectStrategy(
      ctx({
        fieldName: 'rating',
        type: 'integer',
        interfaceName: 'slider',
        options: { minValue: 1, maxValue: 5, stepInterval: 1 },
      })
    );
    assert.equal(s.kind, 'random_int');
    assert.equal((s as any).min, 1);
    assert.equal((s as any).max, 5);
  });

  it('falls back to 0-100 when slider options missing', () => {
    const s = detectStrategy(
      ctx({ fieldName: 'x', type: 'integer', interfaceName: 'slider' })
    );
    assert.equal(s.kind, 'random_int');
    assert.equal((s as any).min, 0);
    assert.equal((s as any).max, 100);
  });
});

describe('detectStrategy — type fallback', () => {
  it('integer falls back to random_int', () => {
    const s = detectStrategy(ctx({ fieldName: 'x', type: 'integer' }));
    assert.equal(s.kind, 'random_int');
  });
  it('boolean falls back to random_boolean', () => {
    const s = detectStrategy(ctx({ fieldName: 'flag', type: 'boolean' }));
    assert.equal(s.kind, 'random_boolean');
  });
  it('uuid type (no special) returns uuid', () => {
    const s = detectStrategy(ctx({ fieldName: 'other_id', type: 'uuid' }));
    assert.equal(s.kind, 'uuid');
  });
});
