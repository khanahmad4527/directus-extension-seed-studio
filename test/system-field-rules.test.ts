import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lookupSystemFieldRule } from '../src/endpoint/core/system-field-rules.js';

describe('lookupSystemFieldRule', () => {
  it('returns null for non-system collections', () => {
    assert.equal(lookupSystemFieldRule('blog_posts', 'status'), null);
  });

  it('returns null for unknown system fields', () => {
    assert.equal(lookupSystemFieldRule('directus_unknown_collection', 'foo'), null);
  });

  it('returns inbox/archived for directus_notifications.status', () => {
    const s = lookupSystemFieldRule('directus_notifications', 'status');
    assert.equal(s?.kind, 'random_choice');
    assert.deepEqual((s as any).choices, ['inbox', 'archived']);
  });

  it('returns user-status enum for directus_users.status', () => {
    const s = lookupSystemFieldRule('directus_users', 'status');
    assert.equal(s?.kind, 'random_choice');
    assert.ok((s as any).choices.includes('active'));
    assert.ok((s as any).choices.includes('suspended'));
  });

  it('returns fixed placeholder for directus_users.password (Directus hashes on save)', () => {
    const s = lookupSystemFieldRule('directus_users', 'password');
    assert.equal(s?.kind, 'fixed');
  });

  it('returns mime faker for directus_files.type', () => {
    const s = lookupSystemFieldRule('directus_files', 'type');
    assert.equal(s?.kind, 'faker');
    assert.equal((s as any).method, 'system.mimeType');
  });

  it('returns null literal for fields better left empty (e.g. notifications.collection)', () => {
    const s = lookupSystemFieldRule('directus_notifications', 'collection');
    assert.equal(s?.kind, 'null');
  });

  it('operations.type uses real Directus operation types (item-create, not create)', () => {
    const s = lookupSystemFieldRule('directus_operations', 'type');
    assert.equal(s?.kind, 'random_choice');
    const choices = (s as any).choices as string[];
    assert.ok(choices.includes('item-create'));
    assert.ok(choices.includes('item-read'));
    assert.ok(choices.includes('item-update'));
    assert.ok(choices.includes('item-delete'));
    assert.ok(!choices.includes('create')); // wrong shorthand should NOT appear
  });

  it('translations.language has locale codes', () => {
    const s = lookupSystemFieldRule('directus_translations', 'language');
    assert.equal(s?.kind, 'random_choice');
    const choices = (s as any).choices as string[];
    assert.ok(choices.includes('en-US'));
    assert.ok(choices.includes('es-ES'));
  });

  it('policies.admin_access is fixed false (never grant admin in seed data)', () => {
    const s = lookupSystemFieldRule('directus_policies', 'admin_access');
    assert.equal(s?.kind, 'fixed');
    assert.equal((s as any).value, false);
  });

  it('presets.layout uses real layout values', () => {
    const s = lookupSystemFieldRule('directus_presets', 'layout');
    assert.equal(s?.kind, 'random_choice');
    const choices = (s as any).choices as string[];
    assert.ok(choices.includes('tabular'));
    assert.ok(choices.includes('cards'));
    assert.ok(choices.includes('kanban'));
  });

  it('folders.parent is null (self-ref unsupported in v1)', () => {
    const s = lookupSystemFieldRule('directus_folders', 'parent');
    assert.equal(s?.kind, 'null');
  });
});
