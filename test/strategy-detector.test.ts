import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectField,
  detectStrategy,
  hasAutoManagedSpecial,
  isAliasField,
} from '../src/core/strategy-detector.js';
import type { DetectContext } from '../src/core/strategy-detector.js';

function ctx(overrides: Partial<DetectContext> = {}): DetectContext {
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
  it('field named "id" WITHOUT pk/special is NOT system', () => {
    assert.notEqual(detectStrategy(ctx({ fieldName: 'id', type: 'string' })).kind, 'system');
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

describe('detectStrategy — alias and presentation fields', () => {
  it('type alias is an alias field', () => {
    assert.equal(isAliasField([], 'alias', null), true);
  });
  it('presentation-divider is an alias field', () => {
    assert.equal(isAliasField([], 'string', 'presentation-divider'), true);
  });
  it('group specials are alias fields', () => {
    assert.equal(isAliasField(['group'], 'alias', 'group-detail'), true);
    assert.equal(isAliasField(['no-data'], 'string', null), true);
  });
  it('a normal input is not an alias field', () => {
    assert.equal(isAliasField([], 'string', 'input'), false);
  });
  it('divider fields are skipped, never written', () => {
    const result = detectField(
      ctx({ fieldName: 'focal_point_divider', type: 'alias', interfaceName: 'presentation-divider' })
    );
    assert.equal(result.strategy.kind, 'skip');
    assert.match(result.reason, /no database column/i);
  });
});

describe('detectStrategy — names', () => {
  const method = (c: Partial<DetectContext>) => (detectStrategy(ctx(c)) as any).method;

  it('email field maps to internet.email', () => {
    assert.equal(method({ fieldName: 'email' }), 'internet.email');
  });
  it('user_email also maps to email faker', () => {
    assert.equal(method({ fieldName: 'user_email' }), 'internet.email');
  });
  it('first_name maps to person.firstName', () => {
    assert.equal(method({ fieldName: 'first_name' }), 'person.firstName');
  });
  it('users.name maps to person.fullName', () => {
    assert.equal(method({ fieldName: 'name', collectionName: 'users' }), 'person.fullName');
  });
  it('companies.name maps to company.name', () => {
    assert.equal(method({ fieldName: 'name', collectionName: 'companies' }), 'company.name');
  });
  it('products.name maps to commerce.productName', () => {
    assert.equal(method({ fieldName: 'name', collectionName: 'products' }), 'commerce.productName');
  });
  it('title resolves through the row entity so it matches the rest of the row', () => {
    const strategy = detectStrategy(ctx({ fieldName: 'title', collectionName: 'articles' }));
    assert.equal(strategy.kind, 'coherent');
    assert.equal((strategy as any).trait, 'content.title');
  });
  it('slug is derived from the row title, not random words', () => {
    const strategy = detectStrategy(ctx({ fieldName: 'slug' }));
    assert.equal(strategy.kind, 'template');
    assert.match((strategy as any).template, /content\.title/);
  });
});

describe('detectStrategy — validation rules outrank name heuristics', () => {
  it('_in constraint becomes a choice list', () => {
    const strategy = detectStrategy(
      ctx({ fieldName: 'title', constraints: { oneOf: ['a', 'b', 'c'] } })
    );
    assert.equal(strategy.kind, 'random_choice');
    assert.deepEqual((strategy as any).choices, ['a', 'b', 'c']);
  });
  it('_regex constraint becomes a pattern strategy', () => {
    const strategy = detectStrategy(ctx({ fieldName: 'sku', constraints: { regex: '^X-[0-9]{3}$' } }));
    assert.equal(strategy.kind, 'regex');
    assert.equal((strategy as any).pattern, '^X-[0-9]{3}$');
  });
  it('numeric bounds are respected by the generated range', () => {
    const strategy = detectStrategy(
      ctx({ fieldName: 'quantity', type: 'integer', constraints: { min: 5, max: 9 } })
    );
    assert.equal(strategy.kind, 'random_int');
    assert.equal((strategy as any).min, 5);
    assert.equal((strategy as any).max, 9);
  });
});

describe('detectStrategy — dropdown choices', () => {
  it('status choices are weighted so common states dominate', () => {
    const strategy = detectStrategy(
      ctx({
        fieldName: 'status',
        options: { choices: [{ value: 'published' }, { value: 'draft' }, { value: 'archived' }] },
      })
    );
    assert.equal(strategy.kind, 'weighted_choice');
    const choices = (strategy as any).choices as Array<{ value: string; weight: number }>;
    const weight = (value: string) => choices.find((c) => c.value === value)!.weight;
    assert.ok(weight('published') > weight('draft'));
    assert.ok(weight('draft') > weight('archived'));
  });

  it('neutral choices stay uniform', () => {
    const strategy = detectStrategy(
      ctx({ fieldName: 'category', options: { choices: ['red', 'green', 'blue'] } })
    );
    assert.equal(strategy.kind, 'random_choice');
  });
});

describe('detectStrategy — relations', () => {
  it('m2o picks an existing related row', () => {
    const strategy = detectStrategy(
      ctx({ fieldName: 'author', relation: { type: 'm2o', relatedCollection: 'authors' } })
    );
    assert.equal(strategy.kind, 'm2o_random');
    assert.equal((strategy as any).relatedCollection, 'authors');
  });

  it('file relations reuse an existing image', () => {
    const strategy = detectStrategy(
      ctx({ fieldName: 'avatar', relation: { type: 'm2o', relatedCollection: 'directus_files' } })
    );
    assert.equal(strategy.kind, 'file_reuse');
  });

  // Directus stores every m2m/o2m/m2a field as `type: 'alias'` with a relational
  // special. Detection has to look past that, or junction rows never get written.
  it('m2m fields generate junction rows even though Directus types them as alias', () => {
    const strategy = detectStrategy(
      ctx({
        fieldName: 'tags',
        type: 'alias',
        specials: ['m2m'],
        interfaceName: 'list-m2m',
        relation: {
          type: 'm2m',
          relatedCollection: 'tags',
          junction: 'posts_tags',
          junctionParentField: 'posts_id',
          junctionRelatedField: 'tags_id',
        },
      })
    );
    assert.equal(strategy.kind, 'm2m_random');
  });

  it('o2m is skipped with an explanation pointing at the child collection', () => {
    const result = detectField(
      ctx({
        fieldName: 'comments',
        type: 'alias',
        specials: ['o2m'],
        relation: { type: 'o2m', relatedCollection: 'comments' },
      })
    );
    assert.equal(result.strategy.kind, 'skip');
    assert.match(result.reason, /comments/);
  });

  it('a presentation alias with no relation is still skipped as no-data', () => {
    const result = detectField(
      ctx({ fieldName: 'meta_group', type: 'alias', specials: ['group'], interfaceName: 'group-detail' })
    );
    assert.equal(result.strategy.kind, 'skip');
    assert.match(result.reason, /no database column/i);
  });
});

describe('detectStrategy — geometry', () => {
  it('uses the configured geometry type instead of a constant point', () => {
    const strategy = detectStrategy(
      ctx({ fieldName: 'area', type: 'geometry.Polygon', interfaceName: 'map' })
    );
    assert.equal(strategy.kind, 'geometry');
    assert.equal((strategy as any).geometryType, 'Polygon');
  });

  it('reads the geometry type from interface options', () => {
    const strategy = detectStrategy(
      ctx({ fieldName: 'route', type: 'geometry', interfaceName: 'map', options: { geometryType: 'LineString' } })
    );
    assert.equal((strategy as any).geometryType, 'LineString');
  });
});

describe('detectStrategy — rich text', () => {
  it('markdown editors get structured markdown', () => {
    assert.equal(detectStrategy(ctx({ fieldName: 'body', interfaceName: 'input-rich-text-md' })).kind, 'markdown');
  });
  it('WYSIWYG editors get HTML', () => {
    assert.equal(detectStrategy(ctx({ fieldName: 'body', interfaceName: 'input-rich-text-html' })).kind, 'html');
  });
});

describe('detectStrategy — realistic nulls', () => {
  it('optional fields get a null rate only when asked for', () => {
    const without = detectStrategy(ctx({ fieldName: 'nickname', nullable: true, required: false }));
    assert.equal(without.nullRate, undefined);

    const withNulls = detectStrategy(
      ctx({
        fieldName: 'nickname',
        nullable: true,
        required: false,
        detectOptions: { realisticNulls: true },
      })
    );
    assert.ok((withNulls.nullRate ?? 0) > 0);
  });

  it('required fields are never given a null rate', () => {
    const strategy = detectStrategy(
      ctx({
        fieldName: 'nickname',
        nullable: false,
        required: true,
        detectOptions: { realisticNulls: true },
      })
    );
    assert.equal(strategy.nullRate, undefined);
  });
});

describe('detectStrategy — coherence', () => {
  it('maps faker methods onto row entity traits when coherence is on', () => {
    const strategy = detectStrategy(
      ctx({ fieldName: 'email', detectOptions: { coherentRows: true } })
    );
    assert.equal(strategy.kind, 'coherent');
    assert.equal((strategy as any).trait, 'contact.email');
  });

  it('leaves faker methods alone when coherence is off', () => {
    const strategy = detectStrategy(ctx({ fieldName: 'email', detectOptions: { coherentRows: false } }));
    assert.equal(strategy.kind, 'faker');
  });
});
