import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRowEntity } from '../src/core/entity.js';
import { renderTemplate, templateDependencies } from '../src/core/template.js';
import { makeRng } from './helpers.js';

function ctx(row: Record<string, unknown> = {}, rowIndex = 0) {
  const rng = makeRng(2024);
  return { rng, entity: createRowEntity(rng, { rowIndex, collectionName: 'articles' }), row, rowIndex };
}

describe('renderTemplate', () => {
  it('interpolates entity traits', () => {
    const context = ctx();
    const output = renderTemplate('{{person.firstName}} {{person.lastName}}', context);
    assert.equal(output, `${context.entity.person.firstName} ${context.entity.person.lastName}`);
  });

  it('reads other fields of the same row', () => {
    const output = renderTemplate('{{row.title}}!', ctx({ title: 'Hello' }));
    assert.equal(output, 'Hello!');
  });

  it('applies filters', () => {
    assert.equal(renderTemplate('{{row.title | slug}}', ctx({ title: 'Hello World' })), 'hello-world');
    assert.equal(renderTemplate('{{row.title | upper}}', ctx({ title: 'ab' })), 'AB');
    assert.equal(renderTemplate('{{row.title | truncate:3}}', ctx({ title: 'abcdef' })), 'abc');
    assert.equal(renderTemplate('{{seq | pad:5}}', ctx({}, 41)), '00042');
    assert.equal(renderTemplate('{{row.name | initials}}', ctx({ name: 'ada lovelace' })), 'AL');
  });

  it('supports index and seq', () => {
    assert.equal(renderTemplate('{{index}}/{{seq}}', ctx({}, 4)), '4/5');
  });

  it('supports pick, int and float helpers', () => {
    const value = renderTemplate('{{pick(a,b,c)}}', ctx());
    assert.ok(['a', 'b', 'c'].includes(value));

    const n = Number(renderTemplate('{{int(3,5)}}', ctx()));
    assert.ok(n >= 3 && n <= 5);

    const f = Number(renderTemplate('{{float(1,2,3)}}', ctx()));
    assert.ok(f >= 1 && f <= 2);
  });

  it('calls faker methods by path', () => {
    const value = renderTemplate('{{faker.lorem.word}}', ctx());
    assert.ok(value.length > 0);
    assert.ok(!value.includes('{'));
  });

  it('generates a uuid', () => {
    assert.match(renderTemplate('{{uuid}}', ctx()), /^[0-9a-f]{8}-/i);
  });

  it('renders an unknown expression as empty rather than throwing', () => {
    assert.equal(renderTemplate('[{{nope.nothing}}]', ctx()), '[]');
  });

  it('cannot reach the JS runtime through property traversal', () => {
    assert.equal(renderTemplate('{{constructor.constructor}}', ctx()), '');
    assert.equal(renderTemplate('{{__proto__.x}}', ctx()), '');
    assert.equal(renderTemplate('{{faker.constructor.constructor}}', ctx()), '');
  });

  it('is deterministic for a given seed', () => {
    const a = renderTemplate('{{int(1,1000000)}}-{{faker.lorem.word}}', ctx());
    const b = renderTemplate('{{int(1,1000000)}}-{{faker.lorem.word}}', ctx());
    assert.equal(a, b);
  });
});

describe('templateDependencies', () => {
  it('finds the row fields a template reads', () => {
    assert.deepEqual(templateDependencies('{{row.title | slug}}-{{row.id}}'), ['title', 'id']);
    assert.deepEqual(templateDependencies('{{person.firstName}}'), []);
  });
});
