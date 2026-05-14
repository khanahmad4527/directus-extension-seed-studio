import type { GenerationStrategy } from '../types.js';

/**
 * Per-field strategies for Directus system collections.
 * Values reflect the application-layer constraints (enums, valid choices, formats)
 * that aren't expressed in the field metadata schema.
 *
 * Source of truth: directus/packages/system-data/src/fields/*.yaml plus
 * Directus service-layer validation (NotificationsService, UsersService, etc).
 *
 * Strategies returned here REPLACE the heuristic auto-detection for system collections.
 * Fields not listed here fall back to the normal detector.
 *
 * Keep this file additive — when in doubt, omit the rule rather than guess.
 */
export const SYSTEM_FIELD_RULES: Record<string, Record<string, GenerationStrategy>> = {
  directus_notifications: {
    status: { kind: 'random_choice', choices: ['inbox', 'archived'] },
    subject: { kind: 'faker', method: 'lorem.sentence' },
    message: { kind: 'faker', method: 'lorem.paragraph' },
    collection: { kind: 'null' },
    item: { kind: 'null' },
    // recipient / sender resolved by normal m2o detector → directus_users
  },

  directus_users: {
    status: {
      kind: 'random_choice',
      choices: ['draft', 'invited', 'unverified', 'active', 'suspended', 'archived'],
    },
    first_name: { kind: 'faker', method: 'person.firstName' },
    last_name: { kind: 'faker', method: 'person.lastName' },
    email: { kind: 'faker', method: 'internet.email' },
    // Directus hashes password on save; supply plain placeholder
    password: { kind: 'fixed', value: 'Password123!' },
    location: { kind: 'faker', method: 'location.city' },
    title: { kind: 'faker', method: 'person.jobTitle' },
    description: { kind: 'faker', method: 'lorem.sentence' },
    tags: { kind: 'null' },
    avatar: { kind: 'file_reuse', mimeFilter: 'image/' },
    language: { kind: 'null' },
    appearance: { kind: 'random_choice', choices: ['auto', 'light', 'dark'] },
    theme_light: { kind: 'null' },
    theme_dark: { kind: 'null' },
    theme_light_overrides: { kind: 'null' },
    theme_dark_overrides: { kind: 'null' },
    tfa_secret: { kind: 'null' },
    auth_data: { kind: 'null' },
    provider: { kind: 'fixed', value: 'default' },
    external_identifier: { kind: 'null' },
    email_notifications: { kind: 'random_boolean', trueProbability: 0.5 },
    token: { kind: 'null' },
    last_access: { kind: 'random_date', daysBack: 30, daysForward: 0 },
    last_page: { kind: 'null' },
  },

  directus_files: {
    type: { kind: 'faker', method: 'system.mimeType' },
    title: { kind: 'faker', method: 'lorem.words' },
    description: { kind: 'faker', method: 'lorem.sentence' },
    location: { kind: 'faker', method: 'location.city' },
    tags: { kind: 'null' },
    metadata: { kind: 'null' },
    focal_point_x: { kind: 'null' },
    focal_point_y: { kind: 'null' },
    embed: { kind: 'null' },
    folder: { kind: 'null' },
    storage: { kind: 'fixed', value: 'local' },
    filename_disk: { kind: 'faker', method: 'system.fileName' },
    filename_download: { kind: 'faker', method: 'system.fileName' },
    charset: { kind: 'null' },
    filesize: { kind: 'random_int', min: 1024, max: 5_000_000 },
    width: { kind: 'random_int', min: 200, max: 4096 },
    height: { kind: 'random_int', min: 200, max: 4096 },
    duration: { kind: 'null' },
  },

  directus_activity: {
    action: {
      kind: 'random_choice',
      choices: ['create', 'update', 'delete', 'login', 'comment', 'revert'],
    },
    user_agent: { kind: 'faker', method: 'internet.userAgent' },
    ip: { kind: 'faker', method: 'internet.ip' },
    origin: { kind: 'faker', method: 'internet.url' },
    collection: { kind: 'random_user_collection' },
    item: { kind: 'random_item_of_field', collectionField: 'collection' },
    comment: { kind: 'faker', method: 'lorem.sentence' },
  },

  directus_comments: {
    comment: { kind: 'faker', method: 'lorem.paragraph' },
    collection: { kind: 'random_user_collection' },
    item: { kind: 'random_item_of_field', collectionField: 'collection' },
  },

  directus_collections: {
    icon: {
      kind: 'random_choice',
      choices: [
        'folder', 'dataset', 'description', 'article', 'task', 'event', 'inventory_2',
        'shopping_cart', 'store', 'person', 'group', 'business', 'work', 'place',
        'language', 'translate', 'palette', 'image', 'movie', 'music_note', 'book',
        'school', 'science', 'sports', 'restaurant', 'flight', 'home', 'apartment',
        'star', 'favorite', 'bookmark', 'label', 'category', 'topic', 'feed',
      ],
    },
    note: { kind: 'faker', method: 'lorem.sentence' },
    color: { kind: 'faker', method: 'internet.color' },
    display_template: { kind: 'null' },
    hidden: { kind: 'random_boolean', trueProbability: 0.1 },
    singleton: { kind: 'fixed', value: false },
    sort_field: { kind: 'null' },
    archive_field: { kind: 'null' }, // requires picking from collection's own fields — v2
    archive_value: { kind: 'null' },
    unarchive_value: { kind: 'null' },
    archive_app_filter: { kind: 'fixed', value: true },
    accountability: { kind: 'random_choice', choices: ['all', 'activity', null] },
    sort: { kind: 'null' },
    group: { kind: 'null' },
    versioning: { kind: 'fixed', value: false },
    item_duplication_fields: { kind: 'null' },
    /** Translations array shape: [{language, plural, singular, translation}] */
    translations: {
      kind: 'fixed',
      value: [
        { language: 'en-US', plural: 'Items', singular: 'Item', translation: 'Items' },
        { language: 'es-MX', plural: 'Elementos', singular: 'Elemento', translation: 'Elementos' },
      ],
    },
    preview_url: { kind: 'null' },
  },

  directus_flows: {
    name: { kind: 'faker', method: 'lorem.words' },
    icon: { kind: 'fixed', value: 'bolt' },
    color: { kind: 'faker', method: 'internet.color' },
    description: { kind: 'faker', method: 'lorem.sentence' },
    status: { kind: 'random_choice', choices: ['active', 'inactive'] },
    trigger: {
      kind: 'random_choice',
      choices: ['event', 'schedule', 'operation', 'webhook', 'manual'],
    },
    accountability: {
      kind: 'random_choice',
      choices: ['$trigger', '$full', '$public'],
    },
    options: { kind: 'fixed', value: {} },
  },

  directus_operations: {
    name: { kind: 'faker', method: 'lorem.words' },
    key: { kind: 'faker', method: 'lorem.slug' },
    type: {
      kind: 'random_choice',
      choices: [
        'log',
        'mail',
        'notification',
        'item-create',
        'item-read',
        'item-update',
        'item-delete',
        'webhook-request',
        'condition',
        'transform',
        'sleep',
        'trigger',
        'exec',
      ],
    },
    position_x: { kind: 'random_int', min: 0, max: 30 },
    position_y: { kind: 'random_int', min: 0, max: 30 },
    options: { kind: 'fixed', value: {} },
    flow: { kind: 'null' },
    resolve: { kind: 'null' },
    reject: { kind: 'null' },
  },

  directus_translations: {
    language: {
      kind: 'random_choice',
      choices: ['en-US', 'en-GB', 'es-ES', 'es-MX', 'de-DE', 'fr-FR', 'pt-BR', 'it-IT', 'ja-JP', 'zh-CN'],
    },
    key: { kind: 'faker', method: 'lorem.slug' },
    value: { kind: 'faker', method: 'lorem.sentence' },
    folder_name: { kind: 'null' },
    parent: { kind: 'null' },
    sort: { kind: 'null' },
    icon: { kind: 'null' },
    color: { kind: 'null' },
  },

  directus_policies: {
    name: { kind: 'faker', method: 'company.name' },
    icon: { kind: 'fixed', value: 'badge' },
    description: { kind: 'faker', method: 'lorem.sentence' },
    ip_access: { kind: 'null' },
    enforce_tfa: { kind: 'random_boolean', trueProbability: 0.2 },
    admin_access: { kind: 'fixed', value: false },
    app_access: { kind: 'random_boolean', trueProbability: 0.8 },
    parent: { kind: 'null' },
    sort: { kind: 'null' },
    color: { kind: 'faker', method: 'internet.color' },
    hidden: { kind: 'fixed', value: false },
    module_visibility: { kind: 'null' },
  },

  directus_presets: {
    bookmark: { kind: 'faker', method: 'lorem.words' },
    search: { kind: 'null' },
    layout: { kind: 'random_choice', choices: ['tabular', 'cards', 'detail', 'kanban', 'calendar', 'map'] },
    layout_query: { kind: 'fixed', value: {} },
    layout_options: { kind: 'fixed', value: {} },
    refresh_interval: { kind: 'null' },
    filter: { kind: 'null' },
    icon: { kind: 'fixed', value: 'bookmark' },
    color: { kind: 'faker', method: 'internet.color' },
    comment_count_interval: { kind: 'null' },
    collection: { kind: 'null' }, // user must pick — leaving null prevents bogus FK
  },

  directus_folders: {
    name: { kind: 'faker', method: 'lorem.words' },
    parent: { kind: 'null' }, // self-ref unsupported in v1
  },

  directus_permissions: {
    action: { kind: 'random_choice', choices: ['create', 'read', 'update', 'delete', 'share'] },
    permissions: { kind: 'fixed', value: {} },
    validation: { kind: 'fixed', value: {} },
    presets: { kind: 'null' },
    fields: { kind: 'fixed', value: '*' },
  },

  directus_roles: {
    name: { kind: 'faker', method: 'company.name' },
    icon: { kind: 'fixed', value: 'supervised_user_circle' },
    description: { kind: 'faker', method: 'lorem.sentence' },
  },

  directus_dashboards: {
    name: { kind: 'faker', method: 'lorem.words' },
    icon: { kind: 'fixed', value: 'dashboard' },
    note: { kind: 'faker', method: 'lorem.sentence' },
    color: { kind: 'faker', method: 'internet.color' },
  },

  directus_panels: {
    name: { kind: 'faker', method: 'lorem.words' },
    icon: { kind: 'fixed', value: 'dashboard' },
    color: { kind: 'faker', method: 'internet.color' },
    note: { kind: 'faker', method: 'lorem.sentence' },
    type: { kind: 'fixed', value: 'metric' },
    show_header: { kind: 'random_boolean', trueProbability: 0.5 },
    position_x: { kind: 'random_int', min: 0, max: 20 },
    position_y: { kind: 'random_int', min: 0, max: 20 },
    width: { kind: 'random_int', min: 8, max: 24 },
    height: { kind: 'random_int', min: 4, max: 12 },
    options: { kind: 'fixed', value: {} },
  },

  directus_shares: {
    name: { kind: 'faker', method: 'lorem.words' },
    password: { kind: 'null' },
    max_uses: { kind: 'random_int', min: 1, max: 100 },
    times_used: { kind: 'fixed', value: 0 },
    date_start: { kind: 'null' },
    date_end: { kind: 'null' },
  },
};

/**
 * Look up a predefined strategy for a system-collection field.
 * Returns null if no rule exists; caller should fall back to the heuristic detector.
 */
export function lookupSystemFieldRule(
  collection: string,
  field: string
): GenerationStrategy | null {
  if (!collection.startsWith('directus_')) return null;
  return SYSTEM_FIELD_RULES[collection]?.[field] ?? null;
}
