import type {
  EngineCapabilities,
  FlowInfo,
  PrimaryKey,
  RunOptions,
} from './types.js';

/** Raw `directus_fields` row shape (only the parts we read). */
export interface RawField {
  collection?: string;
  field: string;
  type: string;
  meta?: any;
  schema?: any;
}

/** Raw `directus_relations` row shape. */
export interface RawRelation {
  collection: string;
  field: string;
  related_collection: string | null;
  meta?: any;
  schema?: any;
}

/** Raw `directus_collections` row shape, merged with schema info. */
export interface RawCollection {
  collection: string;
  meta?: any;
  schema?: any;
  primary?: string;
  singleton?: boolean;
  fields?: Record<string, any>;
}

export interface InsertOptions {
  /** Suppress hooks/flows, revisions and activity. Ignored when unsupported. */
  fast?: boolean;
}

export interface GroupCount {
  value: unknown;
  count: number;
}

export interface NumericStats {
  min: number | null;
  max: number | null;
  avg: number | null;
  count: number;
}

export interface EnvironmentInfo {
  publicUrl: string | null;
  isProduction: boolean;
}

/**
 * Everything the engine needs from Directus.
 *
 * Two adapters implement it: one over `ItemsService` (API extension, privileged
 * and fast) and one over the REST API (admin app, works on Directus Cloud where
 * unsandboxed API extensions cannot be installed).
 */
export interface SeedDataSource {
  readonly capabilities: EngineCapabilities;

  listCollections(): Promise<RawCollection[]>;
  getCollection(collection: string): Promise<RawCollection | null>;
  getFields(collection: string): Promise<RawField[]>;
  getRelations(): Promise<RawRelation[]>;

  count(collection: string): Promise<number>;
  /** Distinct-ish column read used for FK pools and uniqueness pre-loading. */
  readColumn(collection: string, field: string, limit: number): Promise<unknown[]>;
  sample(collection: string, fields: string[], limit: number): Promise<Record<string, unknown>[]>;
  groupCount(collection: string, field: string, limit: number): Promise<GroupCount[]>;
  numericStats(collection: string, field: string): Promise<NumericStats>;

  insertMany(
    collection: string,
    rows: Record<string, unknown>[],
    opts?: InsertOptions
  ): Promise<PrimaryKey[]>;
  deleteAll(collection: string): Promise<void>;
  deleteByIds(collection: string, ids: PrimaryKey[]): Promise<void>;

  listFlows?(): Promise<FlowInfo[]>;
  environment?(): Promise<EnvironmentInfo>;
}

/** Resolve the effective write mode for a data source. */
export function resolveInsertOptions(
  ds: SeedDataSource,
  options?: RunOptions
): InsertOptions {
  const wantsFast = options?.writeMode === 'fast';
  return { fast: wantsFast && ds.capabilities.fastWrite };
}
