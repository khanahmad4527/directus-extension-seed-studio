/**
 * Which collections are legal seed targets.
 *
 * Directus exposes all 33 of its system tables through the same ItemsService
 * used for user content, but only a handful of them hold anything resembling
 * *data*. The rest are the schema itself, the auth state, or the migration
 * ledger — writing Faker output into those does not produce test data, it
 * corrupts the instance. `directus_migrations` is the sharpest example: bogus
 * rows there convince Directus that migrations already ran, and the next
 * upgrade silently skips them.
 *
 * Source of truth for the collection list:
 * directus/packages/system-data/src/collections/collections.yaml
 *
 * The default for an unrecognised `directus_*` table is BLOCKED. New Directus
 * versions add system collections (the deployment and OAuth families are
 * recent), and failing closed means a new release cannot turn into a
 * data-corruption bug here without someone first classifying it below.
 */

/** Seed Studio's own bookkeeping tables. */
const SEED_STUDIO_PREFIX = 'seed_studio_';

export type BlockCategory = 'bookkeeping' | 'schema' | 'security' | 'platform' | 'unknown';

export interface SeedTargetVerdict {
  /** Whether a generate run may write to this collection at all. */
  seedable: boolean;
  /** Why it is blocked. Present only when `seedable` is false. */
  reason?: string;
  /** Kind of block, for grouping in the UI. */
  category?: BlockCategory;
  /** Shown alongside a seedable collection that still has a caveat. */
  warning?: string;
}

/**
 * System collections that are structurally unsafe to seed, with the reason the
 * UI shows the user. Grouped by why, because the groups explain themselves.
 */
const BLOCKED_SYSTEM: Record<string, { category: BlockCategory; reason: string }> = {
  // ── The data model itself ────────────────────────────────────────────────
  directus_collections: {
    category: 'schema',
    reason: 'Holds your data model. Directus manages it through CollectionsService — rows written directly here describe collections that do not exist.',
  },
  directus_fields: {
    category: 'schema',
    reason: 'Holds your field definitions. Writing rows here invents fields with no backing database column.',
  },
  directus_relations: {
    category: 'schema',
    reason: 'Holds your relationships. Fabricated rows point at columns that do not exist and break the schema graph.',
  },
  directus_migrations: {
    category: 'schema',
    reason: 'The migration ledger. Fake entries convince Directus that migrations already ran, so the next upgrade skips them.',
  },
  directus_extensions: {
    category: 'schema',
    reason: 'The extension registry, reconciled from disk on boot. Rows here do not correspond to installed extensions.',
  },
  directus_settings: {
    category: 'schema',
    reason: 'A singleton holding project configuration — there is nothing to generate more than one of.',
  },
  directus_revisions: {
    category: 'schema',
    reason: 'Item-history snapshots, each bound to a real activity row and a real item version. Detached revisions corrupt the revert and versioning features.',
  },
  directus_versions: {
    category: 'schema',
    reason: 'Content-versioning pointers into real items. Rows without a valid item leave the version picker in a broken state.',
  },

  // ── Auth and access control ─────────────────────────────────────────────
  directus_sessions: {
    category: 'security',
    reason: 'Live login sessions. Forged rows are credentials — and they break session cleanup.',
  },
  directus_access: {
    category: 'security',
    reason: 'Binds users and roles to policies. Random rows silently grant or revoke real permissions.',
  },
  directus_permissions: {
    category: 'security',
    reason: 'Grants access to collections. Generated rules can expose or lock out real data.',
  },
  directus_policies: {
    category: 'security',
    reason: 'Defines what a policy allows, including admin and app access. Not something to fill with random values.',
  },
  directus_shares: {
    category: 'security',
    reason: 'Each row is a public URL that grants unauthenticated access to a real item.',
  },
  directus_oauth_clients: {
    category: 'security',
    reason: 'Registered OAuth clients, including their secrets.',
  },
  directus_oauth_codes: {
    category: 'security',
    reason: 'Short-lived OAuth authorization codes — credentials, not data.',
  },
  directus_oauth_consents: {
    category: 'security',
    reason: 'Records which user consented to which OAuth client.',
  },
  directus_oauth_tokens: {
    category: 'security',
    reason: 'Live OAuth access and refresh tokens.',
  },

  // ── Live side effects ───────────────────────────────────────────────────
  // Present in Directus 11, removed in 12 (superseded by flows). A webhook row
  // is not inert data: Directus fires an HTTP request to its URL on every
  // matching item event, so generated rows turn any later seed run into a
  // burst of outbound calls to fabricated endpoints.
  directus_webhooks: {
    category: 'platform',
    reason: 'Each row makes Directus POST to a URL on item events — generated webhooks fire real outbound requests at fake endpoints.',
  },

  // ── Managed by the platform ─────────────────────────────────────────────
  directus_deployments: {
    category: 'platform',
    reason: 'Deployment records written by the Directus platform, not by users.',
  },
  directus_deployment_projects: {
    category: 'platform',
    reason: 'Deployment project records written by the Directus platform, not by users.',
  },
  directus_deployment_runs: {
    category: 'platform',
    reason: 'Deployment run history written by the Directus platform, not by users.',
  },
};

/**
 * System collections that genuinely hold data and are useful to seed, with any
 * caveat worth surfacing before the user commits to a run.
 */
const SEEDABLE_SYSTEM: Record<string, { warning?: string }> = {
  directus_users: {},
  directus_notifications: {},
  directus_comments: {},
  directus_folders: {},
  directus_translations: {},
  directus_dashboards: {},
  directus_panels: {},
  directus_files: {
    warning:
      'Generates file metadata only — no bytes are uploaded, so previews and downloads will 404. Useful for populating relations, not for real assets.',
  },
  directus_activity: {
    warning:
      'An append-only audit log that Directus maintains itself. Seeding it pollutes the real activity feed and cannot be told apart from genuine history afterwards.',
  },
  directus_presets: {
    warning:
      'Presets are scoped to a user or role. Generated rows appear as bookmarks and layout defaults in the app.',
  },
  directus_roles: {
    warning:
      'A role on its own grants no access — permissions come from policies. Safe to generate, but the roles do nothing until a policy is attached.',
  },
  directus_flows: {
    warning: 'Generated flows are created without operations, so they run as no-ops.',
  },
  directus_operations: {
    warning:
      'Operations belong to a flow and are chained by resolve/reject. Generated rows are unlinked, so the flow they belong to will not execute them in order.',
  },
};

/** True for Directus-owned tables. */
export function isSystemCollection(name: string): boolean {
  return name.startsWith('directus_');
}

/** True for Seed Studio's own run-history and preset tables. */
export function isSeedStudioCollection(name: string): boolean {
  return name.startsWith(SEED_STUDIO_PREFIX);
}

/**
 * Decide whether `name` may be written to, and explain the decision.
 * User collections are always seedable; system tables are allowlisted.
 */
export function classifySeedTarget(name: string): SeedTargetVerdict {
  if (isSeedStudioCollection(name)) {
    return {
      seedable: false,
      category: 'bookkeeping',
      reason:
        "Seed Studio's own run history and presets. Generating here would forge the audit trail that Undo reads back.",
    };
  }

  if (!isSystemCollection(name)) return { seedable: true };

  const blocked = BLOCKED_SYSTEM[name];
  if (blocked) {
    return { seedable: false, category: blocked.category, reason: blocked.reason };
  }

  const allowed = SEEDABLE_SYSTEM[name];
  if (allowed) {
    return allowed.warning ? { seedable: true, warning: allowed.warning } : { seedable: true };
  }

  // Fail closed: an unclassified system table in a newer Directus release is
  // more likely to be infrastructure than content.
  return {
    seedable: false,
    category: 'unknown',
    reason:
      'Not a recognised Directus system collection. Seed Studio blocks unclassified system tables rather than risk writing into schema or auth state.',
  };
}

/** Convenience guard for the write paths. */
export function assertSeedable(name: string): void {
  const verdict = classifySeedTarget(name);
  if (!verdict.seedable) {
    throw new Error(`"${name}" cannot be seeded: ${verdict.reason}`);
  }
}
