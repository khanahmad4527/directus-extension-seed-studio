#!/usr/bin/env node
// Bootstraps four UUID-PK test collections with M2O relations.
// Idempotent: re-running detects existing collections and exits cleanly.

const DIRECTUS_URL = process.env.DIRECTUS_URL ?? 'http://directus:8055';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'd1r3ctu5';

const COLLECTIONS = ['ss_authors', 'ss_categories', 'ss_posts', 'ss_comments'];

const log = (...args) => console.log('[seed]', ...args);
const die = (msg, err) => {
  console.error('[seed] FAILED:', msg);
  if (err) console.error(err);
  process.exit(1);
};

async function waitForDirectus(maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      // /server/health is admin-only; probe the public /server/ping instead.
      const res = await fetch(`${DIRECTUS_URL}/server/ping`);
      const body = await res.text().catch(() => '');
      if (res.ok && body.trim() === 'pong') {
        log('Directus is healthy.');
        return;
      }
    } catch {
      // not up yet
    }
    await sleep(2000);
  }
  die('Directus did not become healthy in time.');
}

async function login() {
  const res = await fetch(`${DIRECTUS_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.data?.access_token) {
    die(`Login failed (HTTP ${res.status}): ${JSON.stringify(body)}`);
  }
  log('Authenticated as admin.');
  return body.data.access_token;
}

async function api(token, method, path, body) {
  const res = await fetch(`${DIRECTUS_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const parsed = text ? safeJson(text) : null;
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} on ${method} ${path}: ${text}`);
    err.status = res.status;
    err.body = parsed;
    throw err;
  }
  return parsed;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function uuidPkField() {
  return {
    field: 'id',
    type: 'uuid',
    meta: {
      hidden: true,
      readonly: true,
      interface: 'input',
      special: ['uuid'],
    },
    schema: {
      is_primary_key: true,
      is_nullable: false,
      has_auto_increment: false,
    },
  };
}

function timestampField(name, special) {
  return {
    field: name,
    type: 'timestamp',
    meta: {
      hidden: true,
      readonly: true,
      interface: 'datetime',
      special,
      width: 'half',
      display: 'datetime',
      display_options: { relative: true },
    },
    schema: {},
  };
}

async function collectionExists(token, name) {
  try {
    await api(token, 'GET', `/collections/${encodeURIComponent(name)}`);
    return true;
  } catch (err) {
    if (err.status === 403 || err.status === 404) return false;
    throw err;
  }
}

async function createCollection(token, payload) {
  log(`Creating collection ${payload.collection}…`);
  await api(token, 'POST', '/collections', payload);
}

async function createField(token, collection, field) {
  await api(token, 'POST', `/fields/${encodeURIComponent(collection)}`, field);
}

async function createRelation(token, relation) {
  await api(token, 'POST', '/relations', relation);
}

async function createAuthors(token) {
  await createCollection(token, {
    collection: 'ss_authors',
    meta: {
      icon: 'person',
      note: 'Seed Studio test collection · authors',
      display_template: '{{name}}',
    },
    schema: {},
    fields: [
      uuidPkField(),
      {
        field: 'name',
        type: 'string',
        meta: { interface: 'input', required: true, width: 'half' },
        schema: { is_nullable: false },
      },
      {
        field: 'email',
        type: 'string',
        meta: { interface: 'input', width: 'half', options: { iconLeft: 'mail' } },
        schema: { is_nullable: true },
      },
      {
        field: 'bio',
        type: 'text',
        meta: { interface: 'input-multiline' },
        schema: { is_nullable: true },
      },
      {
        field: 'avatar',
        type: 'uuid',
        meta: {
          interface: 'file-image',
          display: 'image',
          special: ['file'],
        },
        schema: { is_nullable: true },
      },
      timestampField('date_created', ['date-created']),
      timestampField('date_updated', ['date-created', 'date-updated']),
    ],
  });

  await createRelation(token, {
    collection: 'ss_authors',
    field: 'avatar',
    related_collection: 'directus_files',
    schema: { on_delete: 'SET NULL' },
    meta: { sort_field: null },
  });
}

async function createCategories(token) {
  await createCollection(token, {
    collection: 'ss_categories',
    meta: {
      icon: 'sell',
      note: 'Seed Studio test collection · categories',
      display_template: '{{name}}',
    },
    schema: {},
    fields: [
      uuidPkField(),
      {
        field: 'name',
        type: 'string',
        meta: { interface: 'input', required: true, width: 'half' },
        schema: { is_nullable: false },
      },
      {
        field: 'slug',
        type: 'string',
        meta: { interface: 'input', width: 'half' },
        schema: { is_nullable: false, is_unique: true },
      },
      timestampField('date_created', ['date-created']),
    ],
  });
}

async function createPosts(token) {
  await createCollection(token, {
    collection: 'ss_posts',
    meta: {
      icon: 'article',
      note: 'Seed Studio test collection · posts',
      display_template: '{{title}}',
    },
    schema: {},
    fields: [
      uuidPkField(),
      {
        field: 'title',
        type: 'string',
        meta: { interface: 'input', required: true },
        schema: { is_nullable: false, max_length: 200 },
      },
      {
        field: 'slug',
        type: 'string',
        meta: { interface: 'input' },
        schema: { is_nullable: false, is_unique: true, max_length: 200 },
      },
      {
        field: 'status',
        type: 'string',
        meta: {
          interface: 'select-dropdown',
          width: 'half',
          options: {
            choices: [
              { text: 'Draft', value: 'draft' },
              { text: 'Published', value: 'published' },
              { text: 'Archived', value: 'archived' },
            ],
          },
        },
        schema: { is_nullable: false, default_value: 'draft' },
      },
      {
        field: 'view_count',
        type: 'integer',
        meta: { interface: 'input', width: 'half' },
        schema: { is_nullable: true, default_value: 0 },
      },
      {
        field: 'content',
        type: 'text',
        meta: { interface: 'input-rich-text-md' },
        schema: { is_nullable: true },
      },
      {
        field: 'cover',
        type: 'uuid',
        meta: { interface: 'file-image', display: 'image', special: ['file'] },
        schema: { is_nullable: true },
      },
      {
        field: 'author',
        type: 'uuid',
        meta: { interface: 'select-dropdown-m2o', display: 'related-values', display_options: { template: '{{name}}' }, required: true },
        schema: { is_nullable: false },
      },
      {
        field: 'category',
        type: 'uuid',
        meta: { interface: 'select-dropdown-m2o', display: 'related-values', display_options: { template: '{{name}}' } },
        schema: { is_nullable: true },
      },
      timestampField('date_created', ['date-created']),
      timestampField('date_updated', ['date-created', 'date-updated']),
    ],
  });

  await createRelation(token, {
    collection: 'ss_posts',
    field: 'cover',
    related_collection: 'directus_files',
    schema: { on_delete: 'SET NULL' },
    meta: { sort_field: null },
  });

  await createRelation(token, {
    collection: 'ss_posts',
    field: 'author',
    related_collection: 'ss_authors',
    schema: { on_delete: 'NO ACTION' },
    meta: { sort_field: null },
  });

  await createRelation(token, {
    collection: 'ss_posts',
    field: 'category',
    related_collection: 'ss_categories',
    schema: { on_delete: 'SET NULL' },
    meta: { sort_field: null },
  });
}

async function createComments(token) {
  await createCollection(token, {
    collection: 'ss_comments',
    meta: {
      icon: 'forum',
      note: 'Seed Studio test collection · comments',
      display_template: '{{body}}',
    },
    schema: {},
    fields: [
      uuidPkField(),
      {
        field: 'body',
        type: 'text',
        meta: { interface: 'input-multiline', required: true },
        schema: { is_nullable: false },
      },
      {
        field: 'rating',
        type: 'integer',
        meta: { interface: 'slider', width: 'half', options: { minValue: 1, maxValue: 5, stepInterval: 1 } },
        schema: { is_nullable: true },
      },
      {
        field: 'is_approved',
        type: 'boolean',
        meta: { interface: 'boolean', width: 'half' },
        schema: { is_nullable: false, default_value: false },
      },
      {
        field: 'post',
        type: 'uuid',
        meta: { interface: 'select-dropdown-m2o', display: 'related-values', display_options: { template: '{{title}}' }, required: true },
        schema: { is_nullable: false },
      },
      {
        field: 'author',
        type: 'uuid',
        meta: { interface: 'select-dropdown-m2o', display: 'related-values', display_options: { template: '{{name}}' }, required: true },
        schema: { is_nullable: false },
      },
      timestampField('date_created', ['date-created']),
    ],
  });

  await createRelation(token, {
    collection: 'ss_comments',
    field: 'post',
    related_collection: 'ss_posts',
    schema: { on_delete: 'CASCADE' },
    meta: { sort_field: null },
  });

  await createRelation(token, {
    collection: 'ss_comments',
    field: 'author',
    related_collection: 'ss_authors',
    schema: { on_delete: 'NO ACTION' },
    meta: { sort_field: null },
  });
}

async function main() {
  log(`Bootstrapping Seed Studio test collections at ${DIRECTUS_URL}…`);
  await waitForDirectus();
  const token = await login();

  const existing = await Promise.all(
    COLLECTIONS.map(async (name) => ({ name, exists: await collectionExists(token, name) }))
  );

  if (existing.every((c) => c.exists)) {
    log('All test collections already exist — nothing to do.');
    return;
  }

  if (existing.some((c) => c.exists)) {
    log('Partial state detected. Existing:', existing.filter((c) => c.exists).map((c) => c.name).join(', '));
    log('Refusing to mix old and new — please drop manually or run `docker compose down -v` to reset.');
    return;
  }

  try {
    await createAuthors(token);
    await createCategories(token);
    await createPosts(token);
    await createComments(token);
    log('✅ Created ss_authors, ss_categories, ss_posts, ss_comments with UUID PKs and M2O relations.');
  } catch (err) {
    die('Bootstrap failed mid-way. Inspect Directus and re-run after fixing.', err);
  }
}

main().catch((err) => die('Unexpected error', err));
