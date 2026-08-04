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
 * `SeedDataSource` over the public REST API, driven from the admin app.
 *
 * This is the engine that works everywhere — including Directus Cloud, where an
 * unsandboxed API extension cannot be installed at all. It runs with the signed-in
 * user's token, so Directus enforces exactly the permissions that user has.
 *
 * What it gives up, and why the UI says so out loud:
 *
 * - No `emitEvents: false` / `skipTracking`. Flows fire per row and every insert
 *   writes activity + a revision when the collection is accountable.
 * - Batches must fit inside `MAX_PAYLOAD_SIZE` (1mb by default), so they are
 *   capped far below what `ItemsService` accepts.
 * - The run lives in the tab. Closing it stops the run.
 */
export class HttpDataSource implements SeedDataSource {
  readonly capabilities: EngineCapabilities = {
    engine: 'app',
    fastWrite: false,
    backgroundRuns: false,
    allLocales: false,
    largeBatches: false,
    flowInsights: true,
    auditTrail: false,
  };

  private collectionCache = new Map<string, RawCollection | null>();
  private fieldsCache = new Map<string, RawField[]>();
  private relationsCache: RawRelation[] | null = null;
  private listCache: RawCollection[] | null = null;

  constructor(private api: any) {}

  /** Directus exposes system collections on their own REST paths. */
  private endpoint(collection: string): string {
    return collection.startsWith('directus_') ? `/${collection.slice(9)}` : `/items/${collection}`;
  }

  private async get(url: string, params?: Record<string, unknown>): Promise<any> {
    const response = await this.api.get(url, params ? { params } : undefined);
    return response?.data?.data ?? response?.data ?? null;
  }

  async listCollections(): Promise<RawCollection[]> {
    if (this.listCache) return this.listCache;
    const rows = (await this.get('/collections')) as any[];
    // Deliberately not seeded into `collectionCache`: `/collections` does not
    // report the primary key, and a cached `id` guess would then be used for
    // inserts and foreign-key pools on collections keyed by something else.
    this.listCache = (rows ?? []).map((row) => normaliseCollection(row));
    return this.listCache;
  }

  async getCollection(collection: string): Promise<RawCollection | null> {
    if (this.collectionCache.has(collection)) return this.collectionCache.get(collection)!;
    let result: RawCollection | null = null;
    try {
      const row = await this.get(`/collections/${encodeURIComponent(collection)}`);
      result = row ? normaliseCollection(row) : null;
    } catch {
      result = null;
    }

    if (result) {
      // `/collections` does not report the primary key, so read it from the fields.
      const fields = await this.getFields(collection).catch(() => [] as RawField[]);
      const pk = fields.find((f) => f?.schema?.is_primary_key)?.field;
      if (pk) result.primary = pk;
    }

    this.collectionCache.set(collection, result);
    return result;
  }

  async getFields(collection: string): Promise<RawField[]> {
    const cached = this.fieldsCache.get(collection);
    if (cached) return cached;
    const rows = ((await this.get(`/fields/${encodeURIComponent(collection)}`)) ?? []) as RawField[];
    this.fieldsCache.set(collection, rows);
    return rows;
  }

  async getRelations(): Promise<RawRelation[]> {
    if (this.relationsCache) return this.relationsCache;
    this.relationsCache = ((await this.get('/relations')) ?? []) as RawRelation[];
    return this.relationsCache;
  }

  async count(collection: string): Promise<number> {
    try {
      const rows = await this.get(this.endpoint(collection), { 'aggregate[count]': '*' });
      const first = Array.isArray(rows) ? rows[0] : rows;
      const value = first?.count ?? first?.count?.['*'];
      const parsed = typeof value === 'string' ? parseInt(value, 10) : Number(value ?? 0);
      return Number.isNaN(parsed) ? 0 : parsed;
    } catch {
      return 0;
    }
  }

  async readColumn(collection: string, field: string, limit: number): Promise<unknown[]> {
    const values: unknown[] = [];
    const pageSize = Math.min(500, Math.max(1, limit));
    let page = 1;

    while (values.length < limit) {
      const rows = ((await this.get(this.endpoint(collection), {
        fields: field,
        limit: pageSize,
        page,
      })) ?? []) as any[];
      if (rows.length === 0) break;
      for (const row of rows) {
        const value = row?.[field];
        if (value !== null && value !== undefined) values.push(value);
      }
      if (rows.length < pageSize) break;
      page += 1;
      if (page > 200) break;
    }

    return values.slice(0, limit);
  }

  async sample(collection: string, fields: string[], limit: number): Promise<Record<string, unknown>[]> {
    const rows = ((await this.get(this.endpoint(collection), {
      fields: fields.length > 0 ? fields.join(',') : '*',
      limit: Math.min(limit, 500),
    })) ?? []) as Record<string, unknown>[];
    return rows;
  }

  async groupCount(collection: string, field: string, limit: number): Promise<GroupCount[]> {
    const rows = ((await this.get(this.endpoint(collection), {
      'aggregate[count]': '*',
      groupBy: field,
      limit,
    })) ?? []) as any[];
    return rows
      .map((row) => ({ value: row?.[field], count: Number(row?.count ?? 0) || 0 }))
      .sort((a, b) => b.count - a.count);
  }

  async numericStats(collection: string, field: string): Promise<NumericStats> {
    const rows = ((await this.get(this.endpoint(collection), {
      'aggregate[min]': field,
      'aggregate[max]': field,
      'aggregate[avg]': field,
      'aggregate[count]': '*',
    })) ?? []) as any[];
    const row = Array.isArray(rows) ? rows[0] : rows;
    return {
      min: toNumberOrNull(row?.min?.[field] ?? row?.min),
      max: toNumberOrNull(row?.max?.[field] ?? row?.max),
      avg: toNumberOrNull(row?.avg?.[field] ?? row?.avg),
      count: Number(row?.count ?? 0) || 0,
    };
  }

  async insertMany(
    collection: string,
    rows: Record<string, unknown>[],
    _opts: InsertOptions = {}
  ): Promise<PrimaryKey[]> {
    if (rows.length === 0) return [];
    const meta = await this.getCollection(collection);
    const pk = meta?.primary ?? 'id';

    const response = await this.api.post(this.endpoint(collection), rows, {
      params: { fields: pk },
    });
    const created = response?.data?.data ?? [];
    if (!Array.isArray(created)) return [];
    return created.map((item: any) => item?.[pk]).filter((key: any) => key !== undefined && key !== null);
  }

  /**
   * Delete every row by paging through primary keys.
   *
   * Delete-by-query over HTTP would be one request, but paging keeps each
   * request small and lets a huge wipe make visible progress instead of hitting
   * a gateway timeout.
   */
  async deleteAll(collection: string): Promise<void> {
    const meta = await this.getCollection(collection);
    const pk = meta?.primary ?? 'id';

    for (let guard = 0; guard < 10_000; guard++) {
      const rows = ((await this.get(this.endpoint(collection), { fields: pk, limit: 200 })) ?? []) as any[];
      const keys = rows.map((row) => row?.[pk]).filter((key) => key !== undefined && key !== null);
      if (keys.length === 0) return;
      await this.deleteByIds(collection, keys);
    }
    throw new Error(`Wipe of "${collection}" did not finish — too many rows to delete from the browser.`);
  }

  async deleteByIds(collection: string, ids: PrimaryKey[]): Promise<void> {
    if (ids.length === 0) return;
    const chunkSize = 200;
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunk = ids.slice(i, i + chunkSize);
      await this.api.delete(this.endpoint(collection), { data: chunk });
    }
  }

  async listFlows(): Promise<FlowInfo[]> {
    try {
      const rows = ((await this.get('/flows', {
        fields: 'id,name,status,trigger,options',
        limit: 500,
      })) ?? []) as any[];
      return rows.map((row) => {
        const options = row?.options ?? {};
        return {
          id: String(row.id),
          name: String(row.name ?? 'Untitled flow'),
          status: String(row.status ?? 'inactive'),
          trigger: String(row.trigger ?? ''),
          collections: Array.isArray(options.collections) ? options.collections : [],
          actions: Array.isArray(options.scope) ? options.scope : [],
        };
      });
    } catch {
      return [];
    }
  }

  async environment(): Promise<EnvironmentInfo> {
    // In the browser the only reliable signal is the URL the admin is served from.
    const host = typeof window !== 'undefined' ? window.location.hostname : '';
    const publicUrl = typeof window !== 'undefined' ? window.location.origin : null;
    const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(host);
    const devish = /(^|[.-])(dev|test|testing|staging|stage|qa|sandbox|preview|local|internal)([.-]|$)/i.test(host);
    return { publicUrl, isProduction: Boolean(host) && !local && !devish };
  }
}

function normaliseCollection(row: any): RawCollection {
  return {
    collection: row.collection,
    meta: row.meta ?? null,
    schema: row.schema ?? null,
    // Provisional: `getCollection` replaces this with the real primary key read
    // from `/fields`, which is the only place the REST API reports it.
    primary: 'id',
    singleton: Boolean(row.meta?.singleton),
  };
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
