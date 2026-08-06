import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRowEntity, isEntityPath, readTrait } from '../src/core/entity.js';
import { invokeFaker, isValidFakerPath, resolveFakerCallable } from '../src/core/faker-methods.js';
import { runGeneration, runPreview } from '../src/core/generator.js';
import {
  LIMITS,
  ValidationError,
  isUnsafeFieldName,
  truncateMessage,
  validateRowCount,
  validateStrategyMap,
} from '../src/core/request-validation.js';
import { assertSafePattern } from '../src/core/rng.js';
import { renderTemplate } from '../src/core/template.js';
import { formatSequence } from '../src/core/validation.js';
import { FakeDataSource, makeRng, rawField } from './helpers.js';

/**
 * These cover the paths that take input from an HTTP request body: strategy
 * maps, faker paths, entity traits, regex patterns and template strings.
 */

describe('faker path resolution', () => {
  it('rejects inherited members that look like methods', () => {
    for (const path of [
      'person.constructor',
      'person.toString',
      'person.valueOf',
      'lorem.hasOwnProperty',
      'string.isPrototypeOf',
      'internet.propertyIsEnumerable',
      'person.bind',
      'person.call',
      'person.apply',
      'lorem.prototype',
    ]) {
      assert.equal(isValidFakerPath(path), false, `${path} should be rejected`);
    }
  });

  it('still accepts real faker methods', () => {
    for (const path of ['person.firstName', 'internet.email', 'commerce.productName', 'number.int']) {
      assert.equal(isValidFakerPath(path), true, `${path} should be allowed`);
    }
  });

  it('rejects traversal and multi-segment paths', () => {
    for (const path of [
      '__proto__.x',
      'constructor.constructor',
      'person.firstName.call',
      'person',
      '',
      'Person.firstName',
      'person.first_name',
    ]) {
      assert.equal(isValidFakerPath(path), false, `${path} should be rejected`);
    }
  });

  it('resolveFakerCallable never returns a constructor', () => {
    const rng = makeRng();
    assert.throws(() => resolveFakerCallable(rng.faker, 'person.constructor'), /Invalid faker method/);
  });

  it('a rejected path throws rather than returning something odd', () => {
    const rng = makeRng();
    assert.throws(() => invokeFaker(rng.faker, 'person.toString'), /Invalid faker method/);
  });
});

describe('entity trait paths', () => {
  const entity = createRowEntity(makeRng(3), { rowIndex: 0, collectionName: 'users' });

  it('accepts known namespace.trait paths only', () => {
    assert.equal(isEntityPath('person.firstName'), true);
    assert.equal(isEntityPath('commerce.price'), true);
    assert.equal(isEntityPath('person'), false);
    assert.equal(isEntityPath('person.firstName.length'), false);
    assert.equal(isEntityPath('nope.firstName'), false);
  });

  it('refuses prototype hops', () => {
    assert.equal(readTrait(entity, 'constructor.constructor'), null);
    assert.equal(readTrait(entity, '__proto__.x'), null);
    assert.equal(readTrait(entity, 'person.constructor'), null);
    assert.equal(readTrait(entity, 'person.hasOwnProperty'), null);
  });

  it('never returns a function', () => {
    assert.equal(readTrait(entity, 'person.toString'), null);
  });

  it('still reads real traits', () => {
    assert.equal(typeof readTrait(entity, 'person.firstName'), 'string');
  });
});

describe('pattern safety', () => {
  it('rejects a quantifier large enough to exhaust memory', () => {
    assert.throws(() => assertSafePattern('[a-z]{1000000}'), /repeats too many times/);
    assert.throws(() => assertSafePattern('[0-9]{1,999999}'), /repeats too many times/);
  });

  it('rejects an absurdly long pattern', () => {
    assert.throws(() => assertSafePattern('a'.repeat(600)), /too long/);
  });

  it('allows a normal identifier pattern', () => {
    assert.equal(assertSafePattern('^INV-[0-9]{5}$'), '^INV-[0-9]{5}$');
  });

  it('the rng caps generated length', () => {
    const rng = makeRng();
    const value = rng.fromRegExp('[a-z]{4000}');
    assert.ok(value.length <= 100_000);
  });
});

describe('sequence patterns', () => {
  it('caps the padding width instead of building a huge string', () => {
    const value = formatSequence(`X-{${'0'.repeat(100_000)}}`, 1, 0);
    assert.ok(value.length <= 200, `padded to ${value.length} characters`);
  });

  it('pads a sane pattern normally', () => {
    assert.equal(formatSequence('INV-{00000}', 41, 1), 'INV-00042');
  });

  it('a 60-zero placeholder stops at the cap', () => {
    const value = formatSequence(`{${'0'.repeat(60)}}`, 0, 7);
    assert.equal(value.length, 40);
  });
});

describe('template safety', () => {
  const ctx = () => {
    const rng = makeRng(11);
    return { rng, entity: createRowEntity(rng, { rowIndex: 0 }), row: {}, rowIndex: 0 };
  };

  it('cannot reach the runtime through any expression', () => {
    for (const expression of [
      '{{constructor.constructor}}',
      '{{__proto__.x}}',
      '{{faker.constructor.constructor}}',
      '{{person.constructor}}',
      '{{faker.person.toString}}',
    ]) {
      assert.equal(renderTemplate(expression, ctx()), '', `${expression} leaked a value`);
    }
  });
});

describe('strategy map validation', () => {
  it('rejects an unknown kind', () => {
    assert.throws(() => validateStrategyMap({ a: { kind: 'exec' } }), ValidationError);
  });

  it('rejects a strategy that is not an object', () => {
    assert.throws(() => validateStrategyMap({ a: 'faker' }), ValidationError);
    assert.throws(() => validateStrategyMap({ a: null }), ValidationError);
  });

  it('rejects reserved keys that would touch the prototype', () => {
    // Built the way an HTTP body arrives: an object literal with a `__proto__`
    // key sets the prototype instead of creating an own property, but JSON.parse
    // creates a real own property — which is exactly the dangerous case.
    const fromBody = JSON.parse('{"__proto__": {"kind": "null"}}');
    assert.throws(() => validateStrategyMap(fromBody), ValidationError);
    assert.throws(() => validateStrategyMap(JSON.parse('{"constructor": {"kind": "null"}}')), ValidationError);
  });

  it('rejects an invalid faker method', () => {
    assert.throws(() => validateStrategyMap({ a: { kind: 'faker', method: 'person.constructor' } }), ValidationError);
    assert.throws(() => validateStrategyMap({ a: { kind: 'faker', method: 42 } }), ValidationError);
  });

  it('rejects malformed choice lists', () => {
    assert.throws(() => validateStrategyMap({ a: { kind: 'random_choice', choices: 'x' } }), ValidationError);
    assert.throws(() => validateStrategyMap({ a: { kind: 'random_choice', choices: [] } }), ValidationError);
    assert.throws(
      () => validateStrategyMap({ a: { kind: 'weighted_choice', choices: [{ value: 1, weight: 0 }] } }),
      ValidationError
    );
  });

  it('rejects out-of-range probabilities and null rates', () => {
    assert.throws(() => validateStrategyMap({ a: { kind: 'random_boolean', trueProbability: 5 } }), ValidationError);
    assert.throws(
      () => validateStrategyMap({ a: { kind: 'faker', method: 'lorem.word', nullRate: 7 } }),
      ValidationError
    );
  });

  it('rejects an unsafe regex pattern', () => {
    assert.throws(() => validateStrategyMap({ a: { kind: 'regex', pattern: '[a-z]{9999999}' } }), ValidationError);
  });

  it('rejects an unknown coherent trait', () => {
    assert.throws(() => validateStrategyMap({ a: { kind: 'coherent', trait: 'person.constructor' } }), ValidationError);
  });

  it('rejects an oversized fixed value', () => {
    const big = { blob: 'x'.repeat(LIMITS.maxFixedBytes + 10) };
    assert.throws(() => validateStrategyMap({ a: { kind: 'fixed', value: big } }), ValidationError);
  });

  it('caps m2m links per row', () => {
    assert.throws(() => validateStrategyMap({ a: { kind: 'm2m_random', min: 0, max: 5000 } }), ValidationError);
  });

  it('accepts a realistic strategy map', () => {
    validateStrategyMap({
      title: { kind: 'coherent', trait: 'content.title' },
      slug: { kind: 'template', template: '{{row.title | slug}}' },
      status: { kind: 'weighted_choice', choices: [{ value: 'a', weight: 2 }] },
      sku: { kind: 'regex', pattern: '^X-[0-9]{4}$' },
      note: { kind: 'faker', method: 'lorem.words', nullRate: 0.2 },
      tags: { kind: 'm2m_random', min: 0, max: 4 },
    });
  });
});

describe('row count limits', () => {
  it('rejects non-positive and non-integer counts', () => {
    assert.throws(() => validateRowCount(0), ValidationError);
    assert.throws(() => validateRowCount(-5), ValidationError);
    assert.throws(() => validateRowCount(1.5), ValidationError);
    assert.throws(() => validateRowCount('abc'), ValidationError);
  });

  it('caps a run that would never finish', () => {
    assert.throws(() => validateRowCount(1e12), /capped/);
    assert.equal(validateRowCount(LIMITS.maxRowsPerRun), LIMITS.maxRowsPerRun);
  });
});

describe('error message size', () => {
  it('truncates a message that quotes a whole SQL statement', () => {
    const message = truncateMessage('x'.repeat(50_000));
    assert.ok(message.length <= LIMITS.maxErrorMessage + 20);
    assert.match(message, /truncated/);
  });
});

describe('prototype-polluting field names', () => {
  it('flags the reserved keys', () => {
    assert.equal(isUnsafeFieldName('__proto__'), true);
    assert.equal(isUnsafeFieldName('constructor'), true);
    assert.equal(isUnsafeFieldName('title'), false);
  });

  it('a column named __proto__ is never written', async () => {
    const ds = new FakeDataSource({
      collections: { odd: { primary: 'id' } },
      fields: {
        odd: [
          rawField('id', 'integer', { schema: { is_primary_key: true } }),
          rawField('__proto__', 'string', { meta: { interface: 'input' } }),
          rawField('title', 'string', { meta: { interface: 'input' } }),
        ],
      },
    });

    const result = await runPreview({ collection: 'odd', strategies: {}, count: 2 }, { ds, rng: makeRng() });
    for (const row of result.rows) {
      assert.ok(!Object.prototype.hasOwnProperty.call(row, '__proto__'));
      assert.ok('title' in row);
    }
    assert.equal(({} as any).polluted, undefined);
  });
});

describe('generation rejects bad input before writing', () => {
  const ds = () =>
    new FakeDataSource({
      collections: { posts: { primary: 'id' } },
      fields: {
        posts: [
          rawField('id', 'integer', { schema: { is_primary_key: true } }),
          rawField('title', 'string', { meta: { interface: 'input' } }),
        ],
      },
    });

  it('refuses an unknown strategy kind', async () => {
    const source = ds();
    await assert.rejects(
      () => runGeneration({ collection: 'posts', strategies: { title: { kind: 'nope' } as any }, count: 5 }, { ds: source, rng: makeRng() }),
      ValidationError
    );
    assert.equal(source.inserts.length, 0);
  });

  it('refuses a run larger than the cap', async () => {
    const source = ds();
    await assert.rejects(
      () => runGeneration({ collection: 'posts', strategies: {}, count: 5_000_000 }, { ds: source, rng: makeRng() }),
      /capped/
    );
    assert.equal(source.inserts.length, 0);
  });
});

describe('geometry bounds', () => {
  it('clamps an out-of-range bounding box to real coordinates', async () => {
    const ds = new FakeDataSource({
      collections: { places: { primary: 'id' } },
      fields: {
        places: [
          rawField('id', 'integer', { schema: { is_primary_key: true } }),
          rawField('area', 'geometry.Point', { meta: { interface: 'map' } }),
        ],
      },
    });

    const result = await runPreview(
      {
        collection: 'places',
        strategies: { area: { kind: 'geometry', geometryType: 'Point', bbox: [-9999, -9999, 9999, 9999] } },
        count: 5,
      },
      { ds, rng: makeRng() }
    );

    for (const row of result.rows) {
      const [lng, lat] = (row.area as any).coordinates;
      assert.ok(lng >= -180 && lng <= 180, `lng ${lng}`);
      assert.ok(lat >= -90 && lat <= 90, `lat ${lat}`);
    }
  });
});
