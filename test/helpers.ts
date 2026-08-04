import { Faker, base, en } from '@faker-js/faker';
import type {
  EnvironmentInfo,
  GroupCount,
  InsertOptions,
  NumericStats,
  RawCollection,
  RawField,
  RawRelation,
  SeedDataSource,
} from '../src/core/data-source.js';
import { createRng, type Rng } from '../src/core/rng.js';
import type { EngineCapabilities, FieldDescriptor, FlowInfo, PrimaryKey } from '../src/core/types.js';

export function makeRng(seed = 1234): Rng {
  return createRng(new Faker({ locale: [en, base] }) as any, seed);
}

export function makeField(over: Partial<FieldDescriptor> = {}): FieldDescriptor {
  return {
    field: 'f',
    type: 'string',
    interface: null,
    required: false,
    nullable: true,
    readonly: false,
    isPrimaryKey: false,
    isSystemField: false,
    isAlias: false,
    relation: null,
    options: null,
    special: [],
    validation: null,
    defaultValue: null,
    suggestedStrategy: { kind: 'fixed', value: '' },
    ...over,
  };
}

export interface FakeDataSourceInput {
  collections?: Record<string, Partial<RawCollection>>;
  fields?: Record<string, RawField[]>;
  relations?: RawRelation[];
  rows?: Record<string, Record<string, unknown>[]>;
  capabilities?: Partial<EngineCapabilities>;
  flows?: FlowInfo[];
  environment?: EnvironmentInfo;
}

/**
 * In-memory `SeedDataSource`.
 *
 * The engine only talks to Directus through this interface, so the whole
 * generator — batching, relation pools, uniqueness, junction writes, undo — is
 * testable without a database.
 */
export class FakeDataSource implements SeedDataSource {
  readonly capabilities: EngineCapabilities;
  readonly inserts: Array<{ collection: string; rows: Record<string, unknown>[]; opts?: InsertOptions }> = [];
  readonly deletedIds: Array<{ collection: string; ids: PrimaryKey[] }> = [];
  wipedCollections: string[] = [];

  private collections: Record<string, RawCollection>;
  private fieldsByCollection: Record<string, RawField[]>;
  private relations: RawRelation[];
  private rows: Record<string, Record<string, unknown>[]>;
  private flows: FlowInfo[];
  private env: EnvironmentInfo;
  private nextId = 1;

  constructor(input: FakeDataSourceInput = {}) {
    this.capabilities = {
      engine: 'api',
      fastWrite: true,
      backgroundRuns: true,
      allLocales: true,
      largeBatches: true,
      flowInsights: true,
      auditTrail: true,
      ...input.capabilities,
    };

    this.collections = {};
    for (const [name, value] of Object.entries(input.collections ?? {})) {
      this.collections[name] = { collection: name, primary: 'id', singleton: false, meta: {}, ...value };
    }
    this.fieldsByCollection = input.fields ?? {};
    this.relations = input.relations ?? [];
    this.rows = input.rows ?? {};
    this.flows = input.flows ?? [];
    this.env = input.environment ?? { publicUrl: 'http://localhost:8055', isProduction: false };
  }

  async listCollections(): Promise<RawCollection[]> {
    return Object.values(this.collections);
  }

  async getCollection(collection: string): Promise<RawCollection | null> {
    return this.collections[collection] ?? null;
  }

  async getFields(collection: string): Promise<RawField[]> {
    return this.fieldsByCollection[collection] ?? [];
  }

  async getRelations(): Promise<RawRelation[]> {
    return this.relations;
  }

  async count(collection: string): Promise<number> {
    return (this.rows[collection] ?? []).length;
  }

  async readColumn(collection: string, field: string, limit: number): Promise<unknown[]> {
    return (this.rows[collection] ?? [])
      .map((row) => row[field])
      .filter((value) => value !== undefined && value !== null)
      .slice(0, limit);
  }

  async sample(collection: string, _fields: string[], limit: number): Promise<Record<string, unknown>[]> {
    return (this.rows[collection] ?? []).slice(0, limit);
  }

  async groupCount(collection: string, field: string, limit: number): Promise<GroupCount[]> {
    const counts = new Map<string, GroupCount>();
    for (const row of this.rows[collection] ?? []) {
      const value = row[field];
      if (value === null || value === undefined) continue;
      const key = String(value);
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { value, count: 1 });
    }
    return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit);
  }

  async numericStats(collection: string, field: string): Promise<NumericStats> {
    const values = (this.rows[collection] ?? [])
      .map((row) => Number(row[field]))
      .filter((n) => Number.isFinite(n));
    if (values.length === 0) return { min: null, max: null, avg: null, count: 0 };
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      count: values.length,
    };
  }

  async insertMany(
    collection: string,
    rows: Record<string, unknown>[],
    opts: InsertOptions = {}
  ): Promise<PrimaryKey[]> {
    this.inserts.push({ collection, rows, opts });
    const pk = this.collections[collection]?.primary ?? 'id';
    const keys: PrimaryKey[] = [];
    const store = (this.rows[collection] ??= []);
    for (const row of rows) {
      const key = (row[pk] as PrimaryKey) ?? this.nextId++;
      store.push({ ...row, [pk]: key });
      keys.push(key);
    }
    return keys;
  }

  async deleteAll(collection: string): Promise<void> {
    this.wipedCollections.push(collection);
    this.rows[collection] = [];
  }

  async deleteByIds(collection: string, ids: PrimaryKey[]): Promise<void> {
    this.deletedIds.push({ collection, ids });
    const pk = this.collections[collection]?.primary ?? 'id';
    const set = new Set(ids.map(String));
    this.rows[collection] = (this.rows[collection] ?? []).filter((row) => !set.has(String(row[pk])));
  }

  async listFlows(): Promise<FlowInfo[]> {
    return this.flows;
  }

  async environment(): Promise<EnvironmentInfo> {
    return this.env;
  }

  /** All rows written to a collection across every batch. */
  written(collection: string): Record<string, unknown>[] {
    return this.inserts.filter((i) => i.collection === collection).flatMap((i) => i.rows);
  }
}

/** Convenience: a field metadata row as Directus returns it. */
export function rawField(
  field: string,
  type: string,
  over: { meta?: any; schema?: any } = {}
): RawField {
  return {
    field,
    type,
    meta: over.meta ?? {},
    schema: over.schema ?? {},
  };
}
