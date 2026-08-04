import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRowEntity, detectFlavor, readTrait, slugify } from '../src/core/entity.js';
import { makeRng } from './helpers.js';

describe('detectFlavor', () => {
  it('reads the shape of the collection from its name', () => {
    assert.equal(detectFlavor('users'), 'person');
    assert.equal(detectFlavor('crm_customers'), 'person');
    assert.equal(detectFlavor('companies'), 'company');
    assert.equal(detectFlavor('products'), 'product');
    assert.equal(detectFlavor('blog_posts'), 'content');
    assert.equal(detectFlavor('widgets'), 'generic');
    assert.equal(detectFlavor(undefined), 'generic');
  });
});

describe('row coherence', () => {
  it('derives the email from the same person as the name', () => {
    const entity = createRowEntity(makeRng(7), { rowIndex: 0, collectionName: 'users' });
    const first = slugify(entity.person.firstName);
    const last = slugify(entity.person.lastName);
    assert.ok(entity.contact.email.startsWith(`${first}.${last}@`), `${entity.contact.email} vs ${first}.${last}`);
  });

  it('keeps the full name consistent with first and last', () => {
    const entity = createRowEntity(makeRng(8), { rowIndex: 0, collectionName: 'users' });
    assert.equal(entity.person.fullName, `${entity.person.firstName} ${entity.person.lastName}`);
  });

  it('reads a trait twice and gets the same value', () => {
    const entity = createRowEntity(makeRng(9), { rowIndex: 0, collectionName: 'articles' });
    assert.equal(entity.content.title, entity.content.title);
    assert.equal(entity.company.name, entity.company.name);
  });

  it('derives the slug from the title', () => {
    const entity = createRowEntity(makeRng(10), { rowIndex: 3, collectionName: 'articles' });
    assert.ok(entity.content.slug.startsWith(slugify(entity.content.title)));
    assert.ok(entity.content.slug.endsWith('-4'), entity.content.slug);
  });

  it('uses the work domain for the work email', () => {
    const entity = createRowEntity(makeRng(11), { rowIndex: 0, collectionName: 'employees' });
    assert.ok(entity.contact.workEmail.endsWith(`@${entity.company.domain}`));
  });

  it('keeps cost and sale price below price', () => {
    const entity = createRowEntity(makeRng(12), { rowIndex: 0, collectionName: 'products' });
    assert.ok(entity.commerce.cost < entity.commerce.price);
    assert.ok(entity.commerce.salePrice <= entity.commerce.price);
  });

  it('keeps updated at or after created', () => {
    const entity = createRowEntity(makeRng(13), { rowIndex: 0, collectionName: 'posts' });
    assert.ok(entity.time.updated.getTime() >= entity.time.created.getTime());
  });

  it('titles a person collection with a person name', () => {
    const entity = createRowEntity(makeRng(14), { rowIndex: 0, collectionName: 'customers' });
    assert.equal(entity.content.title, entity.person.fullName);
  });

  it('produces different entities for different rows', () => {
    const rng = makeRng(15);
    rng.seedRow(0);
    const first = createRowEntity(rng, { rowIndex: 0, collectionName: 'users' }).person.fullName;
    rng.seedRow(1);
    const second = createRowEntity(rng, { rowIndex: 1, collectionName: 'users' }).person.fullName;
    assert.notEqual(first, second);
  });

  it('readTrait resolves dotted paths and rejects nonsense safely', () => {
    const entity = createRowEntity(makeRng(16), { rowIndex: 0 });
    assert.equal(typeof readTrait(entity, 'location.city'), 'string');
    assert.equal(readTrait(entity, 'nope.nothing'), null);
  });
});

describe('slugify', () => {
  it('strips accents, punctuation and casing', () => {
    assert.equal(slugify('Crème Brûlée & Co.'), 'creme-brulee-co');
    assert.equal(slugify("O'Brien's Pub"), 'obriens-pub');
  });
});
