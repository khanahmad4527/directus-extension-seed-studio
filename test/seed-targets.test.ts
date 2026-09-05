import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertSeedable,
  classifySeedTarget,
  isSeedStudioCollection,
  isSystemCollection,
} from '../src/core/seed-targets.js';

describe('classifySeedTarget — user collections', () => {
  it('allows any non-system collection', () => {
    for (const name of ['posts', 'ss_authors', 'my_weird_table', 'directusish']) {
      assert.equal(classifySeedTarget(name).seedable, true, name);
    }
  });

  it('does not mistake a prefix-lookalike for a reserved collection', () => {
    assert.equal(isSystemCollection('directusish'), false);
    // The prefix carries a trailing underscore, so a user's own
    // "seed_studios" collection stays theirs.
    assert.equal(isSeedStudioCollection('seed_studios'), false);
    assert.equal(isSeedStudioCollection('seeded_studio_runs'), false);
    assert.equal(isSeedStudioCollection('seed_studio_runs'), true);
  });
});

describe("classifySeedTarget — Seed Studio's own tables", () => {
  it('refuses the run history and presets', () => {
    for (const name of ['seed_studio_runs', 'seed_studio_presets']) {
      const verdict = classifySeedTarget(name);
      assert.equal(verdict.seedable, false, name);
      assert.equal(verdict.category, 'bookkeeping');
      assert.match(verdict.reason ?? '', /Undo/);
    }
  });
});

describe('classifySeedTarget — system collections', () => {
  it('blocks the tables that hold the data model', () => {
    for (const name of [
      'directus_collections',
      'directus_fields',
      'directus_relations',
      'directus_migrations',
      'directus_settings',
      'directus_revisions',
      'directus_versions',
      'directus_extensions',
    ]) {
      const verdict = classifySeedTarget(name);
      assert.equal(verdict.seedable, false, name);
      assert.equal(verdict.category, 'schema', name);
    }
  });

  it('blocks auth and access-control tables', () => {
    for (const name of [
      'directus_sessions',
      'directus_access',
      'directus_permissions',
      'directus_policies',
      'directus_shares',
      'directus_oauth_clients',
      'directus_oauth_codes',
      'directus_oauth_consents',
      'directus_oauth_tokens',
    ]) {
      const verdict = classifySeedTarget(name);
      assert.equal(verdict.seedable, false, name);
      assert.equal(verdict.category, 'security', name);
    }
  });

  it('blocks directus_webhooks, which fires real outbound requests', () => {
    // Present in Directus 11, removed in 12 — the extension supports both.
    const verdict = classifySeedTarget('directus_webhooks');
    assert.equal(verdict.seedable, false);
    assert.match(verdict.reason ?? '', /outbound/);
  });

  it('allows the system tables that genuinely hold data', () => {
    for (const name of [
      'directus_users',
      'directus_notifications',
      'directus_comments',
      'directus_folders',
      'directus_translations',
      'directus_dashboards',
      'directus_panels',
    ]) {
      assert.equal(classifySeedTarget(name).seedable, true, name);
    }
  });

  it('allows but warns where the result is only half-real', () => {
    const files = classifySeedTarget('directus_files');
    assert.equal(files.seedable, true);
    assert.match(files.warning ?? '', /metadata only/);

    const activity = classifySeedTarget('directus_activity');
    assert.equal(activity.seedable, true);
    assert.match(activity.warning ?? '', /audit log/);
  });

  it('fails closed for an unrecognised system table', () => {
    // A future Directus release adding a table must not silently become
    // seedable just because nobody classified it.
    const verdict = classifySeedTarget('directus_something_new');
    assert.equal(verdict.seedable, false);
    assert.equal(verdict.category, 'unknown');
  });

  it('never returns a blocked verdict without a reason', () => {
    const names = [
      'directus_migrations',
      'directus_sessions',
      'directus_webhooks',
      'directus_deployments',
      'directus_future_thing',
      'seed_studio_runs',
    ];
    for (const name of names) {
      const verdict = classifySeedTarget(name);
      assert.equal(verdict.seedable, false, name);
      assert.ok((verdict.reason ?? '').length > 20, `${name} needs an explanation`);
    }
  });
});

describe('assertSeedable', () => {
  it('passes for a user collection', () => {
    assert.doesNotThrow(() => assertSeedable('posts'));
  });

  it('throws naming the collection and the reason', () => {
    assert.throws(() => assertSeedable('directus_migrations'), /directus_migrations.*migration ledger/s);
  });
});
