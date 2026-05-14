import type { AuditRunRow, PresetRow, StrategyMap } from '../types.js';

const RUNS_COLLECTION = 'seed_studio_runs';
const PRESETS_COLLECTION = 'seed_studio_presets';

type Logger = { warn?: (...a: any[]) => void; error?: (...a: any[]) => void };

interface CollectionSpec {
  name: string;
  meta: Record<string, unknown>;
  fields: any[];
  relations: any[];
}

function runsSpec(): CollectionSpec {
  return {
    name: RUNS_COLLECTION,
    meta: {
      icon: 'history',
      note: 'Seed Studio · Generation history',
      hidden: false,
      singleton: false,
      sort_field: 'started_at',
      display_template: '{{collection}} — {{status}} ({{row_count_written}} rows)',
      archive_field: 'status',
      archive_value: 'failed',
      unarchive_value: 'success',
    },
    fields: [
      {
        field: 'id',
        type: 'uuid',
        meta: {
          hidden: true,
          readonly: true,
          interface: 'input',
          special: ['uuid'],
          sort: 1,
        },
        schema: { is_primary_key: true, is_nullable: false, has_auto_increment: false },
      },
      {
        field: 'status',
        type: 'string',
        meta: {
          interface: 'select-dropdown',
          display: 'labels',
          options: {
            choices: [
              { text: 'Running', value: 'running' },
              { text: 'Success', value: 'success' },
              { text: 'Failed', value: 'failed' },
            ],
          },
          display_options: {
            choices: [
              { text: 'Running', value: 'running', foreground: '#FFFFFF', background: '#FFA439' },
              { text: 'Success', value: 'success', foreground: '#FFFFFF', background: '#2ECDA7' },
              { text: 'Failed', value: 'failed', foreground: '#FFFFFF', background: '#E35169' },
            ],
            showAsDot: false,
          },
          readonly: true,
          width: 'half',
          sort: 2,
        },
        schema: { is_nullable: false },
      },
      {
        field: 'collection',
        type: 'string',
        meta: {
          interface: 'system-collection',
          display: 'collection',
          options: { includeSystem: false },
          readonly: true,
          width: 'half',
          sort: 3,
        },
        schema: { is_nullable: false },
      },
      {
        field: 'row_count_requested',
        type: 'integer',
        meta: {
          interface: 'input',
          display: 'formatted-value',
          display_options: { suffix: ' rows' },
          readonly: true,
          width: 'half',
          sort: 4,
        },
      },
      {
        field: 'row_count_written',
        type: 'integer',
        meta: {
          interface: 'input',
          display: 'formatted-value',
          display_options: { suffix: ' rows', bold: true },
          readonly: true,
          width: 'half',
          sort: 5,
        },
      },
      {
        field: 'dry_run',
        type: 'boolean',
        meta: {
          interface: 'boolean',
          display: 'boolean',
          readonly: true,
          width: 'half',
          sort: 6,
        },
        schema: { default_value: false },
      },
      {
        field: 'wipe_first',
        type: 'boolean',
        meta: {
          interface: 'boolean',
          display: 'boolean',
          readonly: true,
          width: 'half',
          sort: 7,
        },
        schema: { default_value: false },
      },
      {
        field: 'duration_ms',
        type: 'integer',
        meta: {
          interface: 'input',
          display: 'formatted-value',
          display_options: { suffix: ' ms' },
          readonly: true,
          width: 'half',
          sort: 8,
        },
      },
      {
        field: 'started_at',
        type: 'timestamp',
        meta: {
          interface: 'datetime',
          display: 'datetime',
          display_options: { relative: true },
          readonly: true,
          width: 'half',
          sort: 9,
        },
      },
      {
        field: 'completed_at',
        type: 'timestamp',
        meta: {
          interface: 'datetime',
          display: 'datetime',
          display_options: { relative: true },
          readonly: true,
          width: 'half',
          sort: 10,
        },
      },
      {
        field: 'strategies',
        type: 'json',
        meta: {
          interface: 'input-code',
          options: { language: 'json', lineNumber: true },
          readonly: true,
          width: 'full',
          note: 'Snapshot of strategies used for this run',
          sort: 11,
        },
      },
      {
        field: 'error_message',
        type: 'text',
        meta: {
          interface: 'input-multiline',
          display: 'formatted-value',
          display_options: { color: '#E35169' },
          readonly: true,
          width: 'full',
          conditions: [
            {
              name: 'Hide when no error',
              rule: { _and: [{ error_message: { _empty: true } }] },
              hidden: true,
            },
          ],
          sort: 12,
        },
      },
      {
        field: 'user_created',
        type: 'uuid',
        meta: {
          interface: 'select-dropdown-m2o',
          display: 'user',
          display_options: { display: 'name' },
          special: ['user-created'],
          readonly: true,
          width: 'half',
          sort: 13,
        },
      },
    ],
    relations: [
      {
        collection: RUNS_COLLECTION,
        field: 'user_created',
        related_collection: 'directus_users',
        schema: { on_delete: 'SET NULL' },
        meta: { sort_field: null },
      },
    ],
  };
}

function presetsSpec(): CollectionSpec {
  return {
    name: PRESETS_COLLECTION,
    meta: {
      icon: 'bookmark',
      note: 'Seed Studio · Saved strategy configurations',
      hidden: false,
      singleton: false,
      sort_field: 'name',
      display_template: '{{name}} · {{collection}}',
    },
    fields: [
      {
        field: 'id',
        type: 'uuid',
        meta: {
          hidden: true,
          readonly: true,
          interface: 'input',
          special: ['uuid'],
          sort: 1,
        },
        schema: { is_primary_key: true, is_nullable: false, has_auto_increment: false },
      },
      {
        field: 'name',
        type: 'string',
        meta: {
          interface: 'input',
          required: true,
          width: 'half',
          sort: 2,
          options: { placeholder: 'e.g. Demo blog data' },
        },
        schema: { is_nullable: false, max_length: 200 },
      },
      {
        field: 'collection',
        type: 'string',
        meta: {
          interface: 'system-collection',
          display: 'collection',
          options: { includeSystem: false },
          required: true,
          width: 'half',
          sort: 3,
        },
        schema: { is_nullable: false },
      },
      {
        field: 'strategies',
        type: 'json',
        meta: {
          interface: 'input-code',
          options: { language: 'json', lineNumber: true },
          width: 'full',
          note: 'Strategy map keyed by field name',
          sort: 4,
        },
      },
      {
        field: 'date_created',
        type: 'timestamp',
        meta: {
          interface: 'datetime',
          display: 'datetime',
          display_options: { relative: true },
          special: ['date-created'],
          readonly: true,
          width: 'half',
          sort: 5,
        },
      },
      {
        field: 'user_created',
        type: 'uuid',
        meta: {
          interface: 'select-dropdown-m2o',
          display: 'user',
          display_options: { display: 'name' },
          special: ['user-created'],
          readonly: true,
          width: 'half',
          sort: 6,
        },
      },
    ],
    relations: [
      {
        collection: PRESETS_COLLECTION,
        field: 'user_created',
        related_collection: 'directus_users',
        schema: { on_delete: 'SET NULL' },
        meta: { sort_field: null },
      },
    ],
  };
}

export async function ensureAuditCollections(
  services: any,
  schema: any,
  logger?: Logger,
  getSchema?: () => Promise<any>
): Promise<void> {
  const { CollectionsService, RelationsService } = services;
  if (!CollectionsService) return;

  const collectionsService = new CollectionsService({ schema, accountability: { admin: true } });

  for (const spec of [runsSpec(), presetsSpec()]) {
    const created = await ensureCollection(collectionsService, spec, logger);
    if (created && RelationsService) {
      // Re-fetch schema so RelationsService sees the freshly created collection.
      const freshSchema = getSchema ? await getSchema() : schema;
      const relationsService = new RelationsService({
        schema: freshSchema,
        accountability: { admin: true },
      });
      await ensureRelations(relationsService, spec.relations, logger);
    }
  }
}

async function ensureCollection(
  collectionsService: any,
  spec: CollectionSpec,
  logger?: Logger
): Promise<boolean> {
  try {
    await collectionsService.readOne(spec.name);
    return false;
  } catch {
    // does not exist; proceed to create
  }
  try {
    await collectionsService.createOne({
      collection: spec.name,
      meta: spec.meta,
      schema: {},
      fields: spec.fields,
    });
    return true;
  } catch (err: any) {
    try {
      await collectionsService.readOne(spec.name);
      return false;
    } catch {
      // still missing — real failure
    }
    logger?.error?.({ err: err?.message, collection: spec.name }, 'Seed Studio: audit collection create failed');
    throw new Error(`Failed to create audit collection ${spec.name}: ${err?.message ?? err}`);
  }
}

async function ensureRelations(
  relationsService: any,
  relations: any[],
  logger?: Logger
): Promise<void> {
  for (const rel of relations) {
    try {
      await relationsService.createOne(rel);
    } catch (err: any) {
      logger?.warn?.({ err: err?.message, relation: rel }, 'Seed Studio: relation create skipped (already exists?)');
    }
  }
}

export async function writeAuditStart(
  services: any,
  schema: any,
  accountability: any,
  row: AuditRunRow
): Promise<string> {
  const { ItemsService } = services;
  const svc = new ItemsService(RUNS_COLLECTION, { schema, accountability });
  const id = (row.id ?? crypto.randomUUID()) as string;
  await svc.createOne({ ...row, id });
  return id;
}

export async function updateAuditEnd(
  services: any,
  schema: any,
  accountability: any,
  id: string,
  patch: Partial<AuditRunRow>
): Promise<void> {
  const { ItemsService } = services;
  const svc = new ItemsService(RUNS_COLLECTION, { schema, accountability });
  await svc.updateOne(id, patch as any);
}

export async function listRuns(
  services: any,
  schema: any,
  accountability: any,
  limit: number,
  offset: number
): Promise<unknown[]> {
  const { ItemsService } = services;
  const svc = new ItemsService(RUNS_COLLECTION, { schema, accountability });
  return svc.readByQuery({ sort: ['-started_at'], limit, offset });
}

export async function listPresets(
  services: any,
  schema: any,
  accountability: any,
  collection: string
): Promise<unknown[]> {
  const { ItemsService } = services;
  const svc = new ItemsService(PRESETS_COLLECTION, { schema, accountability });
  return svc.readByQuery({ filter: { collection: { _eq: collection } }, sort: ['-date_created'], limit: 200 });
}

export async function createPreset(
  services: any,
  schema: any,
  accountability: any,
  row: PresetRow
): Promise<string> {
  const { ItemsService } = services;
  const svc = new ItemsService(PRESETS_COLLECTION, { schema, accountability });
  const id = (await svc.createOne({ ...row, id: row.id ?? crypto.randomUUID() })) as string;
  return id;
}

export async function deletePreset(
  services: any,
  schema: any,
  accountability: any,
  id: string
): Promise<void> {
  const { ItemsService } = services;
  const svc = new ItemsService(PRESETS_COLLECTION, { schema, accountability });
  await svc.deleteOne(id);
}

export const AUDIT_COLLECTIONS = { RUNS_COLLECTION, PRESETS_COLLECTION } as const;

export type _Unused = StrategyMap;
