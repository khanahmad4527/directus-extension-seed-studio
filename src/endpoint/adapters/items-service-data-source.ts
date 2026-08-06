import type {
  EnvironmentInfo,
  GroupCount,
  InsertOptions,
  NumericStats,
  RawCollection,
  RawField,
  RawRelation,
  SeedDataSource,
} from '../../core/data-source.js';
import type { EngineCapabilities, FlowInfo, PrimaryKey } from '../../core/types.js';

/**
 * `SeedDataSource` over Directus services.
 *
 * This is the privileged engine: it can suppress hooks and revisions, batch far
 * beyond `MAX_PAYLOAD_SIZE`, and keep running after the browser tab closes.
 *
 * Fast write deserves an explanation. Directus 11 gates activity and revision
 * writes on `accountability` being non-null (`skipTracking` only exists in 12),
 * so the only portable way to skip them is to run the service without
 * accountability. That is the same authority an admin already has here — the
 * routes are admin-only — but it does mean `user_created` stays empty on
 * fast-written rows. Callers opt in explicitly.
 */
export class ItemsServiceDataSource implements SeedDataSource {
  readonly capabilities: EngineCapabilities = {
    engine: 'api',
    fastWrite: true,
    backgroundRuns: true,
    allLocales: true,
    largeBatches: true,
    flowInsights: true,
    auditTrail: true,
  };

  private collectionMetaCache = new Map<string, RawCollection | null>();
  private fieldsCache = new Map<string, RawField[]>();
  private relationsCache: RawRelation[] | null = null;

  constructor(
    private services: any,
    private schema: any,
    private accountability: any,
    private env?: Record<string, any>
  ) {}

  private items(collection: string, opts: { anonymous?: boolean } = {}) {
    const { ItemsService } = this.services;
    return new ItemsService(collection, {
      schema: this.schema,
      accountability: opts.anonymous ? null : this.accountability,
    });
  }

  async listCollections(): Promise<RawCollection[]> {
    const { CollectionsService } = this.services;
    if (CollectionsService) {
      try {
        const service = new CollectionsService({ schema: this.schema, accountability: this.accountability });
        const rows = (await service.readByQuery()) as any[];
        return rows.map((row) => this.mergeCollection(row.collection, row));
      } catch {
        // Fall through to the schema overview.
      }
    }
    return Object.values<any>(this.schema.collections ?? {}).map((overview) =>
      this.mergeCollection(overview.collection, null, overview)
    );
  }

  async getCollection(collection: string): Promise<RawCollection | null> {
    if (this.collectionMetaCache.has(collection)) return this.collectionMetaCache.get(collection)!;

    const overview = this.schema.collections?.[collection];
    let meta: any = null;
    const { CollectionsService } = this.services;
    if (CollectionsService) {
      try {
        const service = new CollectionsService({ schema: this.schema, accountability: this.accountability });
        meta = await service.readOne(collection);
      } catch {
        meta = null;
      }
    }

    const merged = overview || meta ? this.mergeCollection(collection, meta, overview) : null;
    this.collectionMetaCache.set(collection, merged);
    return merged;
  }

  /**
   * `schema.collections[x]` carries the primary key, singleton flag and
   * accountability; `directus_collections` carries the display name, sort field
   * and archive configuration. The engine needs both.
   */
  private mergeCollection(collection: string, metaRow: any, overview?: any): RawCollection {
    const view = overview ?? this.schema.collections?.[collection];
    const meta = metaRow?.meta ?? metaRow ?? null;
    return {
      collection,
      primary: view?.primary ?? 'id',
      singleton: Boolean(view?.singleton ?? meta?.singleton),
      fields: view?.fields,
      schema: metaRow?.schema ?? null,
      meta: {
        ...(meta ?? {}),
        sort_field: meta?.sort_field ?? view?.sortField ?? null,
        // `null` means "no accountability tracking", so it must survive the merge;
        // only an absent key falls through to the schema overview or the default.
        accountability: firstDefined(meta?.accountability, view?.accountability, 'all'),
        note: meta?.note ?? view?.note ?? null,
      },
    };
  }

  async getFields(collection: string): Promise<RawField[]> {
    const cached = this.fieldsCache.get(collection);
    if (cached) return cached;

    const { FieldsService } = this.services;
    let fields: RawField[] = [];

    if (FieldsService) {
      const service = new FieldsService({ schema: this.schema, accountability: this.accountability });
      fields = (await service.readAll(collection)) as RawField[];
    } else {
      // Test/non-Directus context: synthesise from the schema overview.
      const overview = this.schema.collections?.[collection];
      const flat = overview?.fields ?? this.schema.fields?.[collection] ?? {};
      fields = Object.values<any>(flat);
    }

    this.fieldsCache.set(collection, fields);
    return fields;
  }

  async getRelations(): Promise<RawRelation[]> {
    if (this.relationsCache) return this.relationsCache;
    this.relationsCache = (this.schema.relations ?? []) as RawRelation[];
    return this.relationsCache;
  }

  async count(collection: string): Promise<number> {
    try {
      // `Aggregate.count` is `string[]`. Passing the bare string '*' makes query
      // validation drop the aggregate, and the call quietly returns ordinary rows
      // with no `count` — i.e. every collection reports 0.
      const result = await this.items(collection).readByQuery({ aggregate: { count: ['*'] } });
      const first = Array.isArray(result) ? result[0] : result;
      const value = first?.count;
      const parsed = typeof value === 'string' ? parseInt(value, 10) : Number(value ?? 0);
      return Number.isNaN(parsed) ? 0 : parsed;
    } catch {
      return 0;
    }
  }

  async readColumn(collection: string, field: string, limit: number): Promise<unknown[]> {
    const rows = (await this.items(collection).readByQuery({
      fields: [field],
      limit,
    })) as any[];
    return rows.map((row) => row?.[field]).filter((value) => value !== undefined && value !== null);
  }

  async sample(collection: string, fields: string[], limit: number): Promise<Record<string, unknown>[]> {
    return (await this.items(collection).readByQuery({
      fields: fields.length > 0 ? fields : ['*'],
      limit,
    })) as Record<string, unknown>[];
  }

  async groupCount(collection: string, field: string, limit: number): Promise<GroupCount[]> {
    // The REST parameter is `groupBy`, but the internal Query field is `group`
    // (see `sanitizeQuery`). Passing `groupBy` here is silently ignored, which
    // returns ungrouped rows and makes value-frequency profiling look like
    // "not enough signal". Sorting happens below rather than in SQL, because
    // ordering by an aggregate alias is not accepted on this path.
    const rows = (await this.items(collection).readByQuery({
      aggregate: { count: ['*'] },
      group: [field],
      limit,
    })) as any[];
    return rows
      .map((row) => ({
        value: row?.[field],
        count: Number(row?.count ?? row?.count?.['*'] ?? 0) || 0,
      }))
      .sort((a, b) => b.count - a.count);
  }

  async numericStats(collection: string, field: string): Promise<NumericStats> {
    const rows = (await this.items(collection).readByQuery({
      aggregate: { min: [field], max: [field], avg: [field], count: ['*'] },
    })) as any[];
    const row = Array.isArray(rows) ? rows[0] : rows;
    return {
      min: toNumberOrNull(row?.min?.[field]),
      max: toNumberOrNull(row?.max?.[field]),
      avg: toNumberOrNull(row?.avg?.[field]),
      count: Number(row?.count ?? 0) || 0,
    };
  }

  async insertMany(
    collection: string,
    rows: Record<string, unknown>[],
    opts: InsertOptions = {}
  ): Promise<PrimaryKey[]> {
    if (rows.length === 0) return [];
    const service = this.items(collection, { anonymous: Boolean(opts.fast) });
    const keys = await service.createMany(rows, {
      ...(opts.fast
        ? { emitEvents: false, skipTracking: true, autoPurgeCache: false, autoPurgeSystemCache: false }
        : {}),
    });
    return (keys ?? []) as PrimaryKey[];
  }

  async deleteAll(collection: string): Promise<void> {
    try {
      await this.items(collection).deleteByQuery({ limit: -1 });
    } catch (err: any) {
      throw new Error(`Wipe failed: ${err?.message ?? err}`);
    }
  }

  async deleteByIds(collection: string, ids: PrimaryKey[]): Promise<void> {
    if (ids.length === 0) return;
    await this.items(collection).deleteMany(ids);
  }

  async listFlows(): Promise<FlowInfo[]> {
    try {
      const rows = (await this.items('directus_flows').readByQuery({
        fields: ['id', 'name', 'status', 'trigger', 'options'],
        limit: 500,
      })) as any[];

      return rows.map((row) => {
        const options = row?.options ?? {};
        const collections = Array.isArray(options.collections) ? options.collections : [];
        const scope = Array.isArray(options.scope) ? options.scope : [];
        return {
          id: String(row.id),
          name: String(row.name ?? 'Untitled flow'),
          status: String(row.status ?? 'inactive'),
          trigger: String(row.trigger ?? ''),
          collections,
          actions: scope,
        };
      });
    } catch {
      return [];
    }
  }

  async environment(): Promise<EnvironmentInfo> {
    const env = this.env ?? {};
    const publicUrl = typeof env['PUBLIC_URL'] === 'string' ? env['PUBLIC_URL'] : null;
    const nodeEnv = String(env['NODE_ENV'] ?? '');
    return {
      publicUrl,
      isProduction: looksLikeProduction(publicUrl, nodeEnv),
    };
  }
}

/**
 * A best-effort production check. Wrong in either direction is survivable: the
 * UI only uses it to decide how loudly to warn.
 */
export function looksLikeProduction(publicUrl: string | null, nodeEnv: string): boolean {
  if (nodeEnv === 'development' || nodeEnv === 'test') return false;
  if (!publicUrl) return nodeEnv === 'production';

  let host = publicUrl;
  try {
    host = new URL(publicUrl).hostname;
  } catch {
    host = publicUrl;
  }

  const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal)$/i.test(host);
  const devish = /(^|[.-])(dev|test|testing|staging|stage|qa|sandbox|preview|local|localhost|internal)([.-]|$)/i.test(host);
  if (local || devish) return false;
  return true;
}

function firstDefined<T>(...values: T[]): T | undefined {
  for (const value of values) {
    if (value !== undefined) return value;
  }
  return undefined;
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
