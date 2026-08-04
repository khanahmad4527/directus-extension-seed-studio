/**
 * Shared types for the Seed Studio engine.
 *
 * This module is environment-agnostic: it must never import Node built-ins,
 * express, faker, or `@directus/*` runtime code. Both the API extension and the
 * admin-app module compile against it.
 */

export type PrimaryKey = string | number;

/** Dotted path into a `RowEntity` — see `entity.ts`. */
export type CoherentTrait = string;

export interface WeightedChoice {
  value: unknown;
  weight: number;
}

/** [minLng, minLat, maxLng, maxLat] */
export type Bbox = [number, number, number, number];

/**
 * Every strategy may carry a `nullRate` (0–1): the chance the field is emitted
 * as null instead of a generated value. Real datasets are not 100% populated.
 * Ignored for required fields.
 */
export interface StrategyModifiers {
  nullRate?: number;
}

export type GenerationStrategyBase =
  | { kind: 'system' }
  | { kind: 'skip'; reason?: string }
  | { kind: 'null' }
  | { kind: 'fixed'; value: unknown }
  | { kind: 'faker'; method: string; args?: unknown[] }
  | { kind: 'random_choice'; choices: unknown[] }
  | { kind: 'weighted_choice'; choices: WeightedChoice[] }
  | { kind: 'random_int'; min: number; max: number }
  | { kind: 'random_float'; min: number; max: number; fractionDigits: number }
  | { kind: 'random_date'; daysBack: number; daysForward: number; skew?: 'recent' | 'uniform' }
  | { kind: 'random_boolean'; trueProbability: number }
  | { kind: 'uuid' }
  | { kind: 'sequence'; pattern: string; startFrom?: number }
  | { kind: 'm2o_random'; relatedCollection: string }
  | { kind: 'file_reuse'; mimeFilter?: string }
  | { kind: 'lorem_paragraphs'; count: number }
  | { kind: 'random_user_collection' }
  | { kind: 'random_item_of_field'; collectionField: string }
  /** Draw from the row's coherent entity so related fields agree with each other. */
  | { kind: 'coherent'; trait: CoherentTrait }
  /** Mini template DSL — see `template.ts`. */
  | { kind: 'template'; template: string }
  /** Generate a value matching a regular expression. */
  | { kind: 'regex'; pattern: string }
  /** GeoJSON matching the field's configured geometry type. */
  | { kind: 'geometry'; geometryType?: string; bbox?: Bbox }
  /** Markdown body with headings/lists, not just paragraphs. */
  | { kind: 'markdown'; paragraphs?: number }
  /** HTML body suitable for a WYSIWYG field. */
  | { kind: 'html'; paragraphs?: number }
  /**
   * Link this row to N random rows of the related collection through its
   * junction table. Resolved after the parent rows are inserted, so the
   * executor returns `undefined` for it during row building.
   */
  | { kind: 'm2m_random'; min: number; max: number };

export type GenerationStrategy = GenerationStrategyBase & StrategyModifiers;

export type StrategyKind = GenerationStrategyBase['kind'];

export interface RelationDescriptor {
  type: 'm2o' | 'o2m' | 'm2m' | 'm2a' | 'self';
  relatedCollection: string | null;
  relatedCollections?: string[];
  /** Junction collection for m2m/m2a. */
  junction?: string;
  /** Junction column pointing back at this collection. */
  junctionParentField?: string;
  /** Junction column pointing at the related collection. */
  junctionRelatedField?: string;
  /** For o2m: the column on the child collection holding the FK. */
  childField?: string;
}

/** Constraints distilled from `meta.validation`, `meta.options` and the DB schema. */
export interface FieldConstraints {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  regex?: string;
  oneOf?: unknown[];
  notOneOf?: unknown[];
  contains?: string;
  startsWith?: string;
  endsWith?: string;
  notNull?: boolean;
  notEmpty?: boolean;
}

/** A single Directus conditional-field rule (`meta.conditions[]`). */
export interface FieldCondition {
  name?: string;
  rule: any;
  hidden?: boolean;
  readonly?: boolean;
  required?: boolean;
  options?: any;
}

export interface FieldDescriptor {
  field: string;
  type: string;
  interface: string | null;
  required: boolean;
  nullable: boolean;
  readonly: boolean;
  isPrimaryKey: boolean;
  isSystemField: boolean;
  /** Alias / presentation / group field with no database column to write. */
  isAlias: boolean;
  relation: RelationDescriptor | null;
  options: any;
  special: string[];
  validation: any;
  conditions?: FieldCondition[];
  defaultValue: unknown;
  suggestedStrategy: GenerationStrategy;
  maxLength?: number | null;
  isUnique?: boolean;
  constraints?: FieldConstraints;
  /** Why the suggested strategy was chosen — surfaced in the UI. */
  reason?: string;
  numericPrecision?: number | null;
  numericScale?: number | null;
}

export interface CollectionDescriptor {
  collection: string;
  displayName: string;
  primaryKeyField: string;
  primaryKeyType: string;
  /** True when the primary key must be supplied by us (uuid/string, no auto-increment). */
  primaryKeyGenerated: boolean;
  singleton: boolean;
  rowCount: number;
  /** `meta.sort_field`, `meta.archive_field` etc. from directus_collections. */
  sortField?: string | null;
  archiveField?: string | null;
  archiveValue?: string | null;
  unarchiveValue?: string | null;
  accountability?: string | null;
  versioning?: boolean;
  fields: FieldDescriptor[];
}

export type StrategyMap = Record<string, GenerationStrategy>;

/** Knobs that shape a whole run rather than a single field. */
export interface RunOptions {
  /** Base seed — same seed + same strategies + same schema ⇒ identical rows. */
  seed?: number | null;
  /** Faker locale code, e.g. `de`, `ja`, `pt_BR`. Requires the API engine. */
  locale?: string | null;
  /** Derive related fields (name/email/city/...) from one entity per row. */
  coherentRows?: boolean;
  /** Apply cross-field invariants (date ordering, price relationships, ...). */
  invariants?: boolean;
  /** Honour `meta.conditions` so rows are internally consistent. */
  respectConditions?: boolean;
  /** Leave optional fields empty at a realistic rate instead of always filling. */
  realisticNulls?: boolean;
  /**
   * `fast` skips hooks/flows, revisions and activity (API engine only).
   * `safe` writes exactly like the admin app does.
   */
  writeMode?: 'safe' | 'fast';
}

export interface GenerationRequest {
  collection: string;
  strategies: StrategyMap;
  count: number;
  batchSize?: number;
  wipeFirst?: boolean;
  /** Must equal the collection name when `wipeFirst` is set. */
  confirm?: string;
  savePreset?: boolean;
  presetName?: string;
  options?: RunOptions;
}

export interface PreviewRequest {
  collection: string;
  strategies: StrategyMap;
  count?: number;
  options?: RunOptions;
}

export interface RowIssue {
  rowIndex: number;
  field: string;
  message: string;
}

export interface PreviewResult {
  rows: Record<string, unknown>[];
  /** Rows that Directus would reject, found without writing anything. */
  issues: RowIssue[];
  seed: number;
}

export interface ProgressEvent {
  runId: string;
  type: 'start' | 'batch' | 'phase' | 'complete' | 'error' | 'cancelled';
  rowsWritten?: number;
  totalRows?: number;
  currentBatch?: number;
  totalBatches?: number;
  elapsedMs?: number;
  message?: string;
  phase?: string;
}

export interface AuditRunRow {
  id?: string;
  collection: string;
  row_count_requested: number;
  row_count_written: number;
  dry_run: boolean;
  wipe_first: boolean;
  strategies: StrategyMap;
  status: 'running' | 'success' | 'failed' | 'cancelled' | 'undone';
  error_message: string | null;
  duration_ms: number;
  started_at: string;
  completed_at: string | null;
  seed?: number | null;
  options?: RunOptions | null;
  created_ids?: PrimaryKey[] | null;
  undoable?: boolean;
}

export interface PresetRow {
  id?: string;
  name: string;
  collection: string;
  strategies: StrategyMap;
  options?: RunOptions | null;
}

export interface FakerMethodEntry {
  label: string;
  path: string;
}

/** What the active engine can do — the app feature-detects on this. */
export interface EngineCapabilities {
  engine: 'api' | 'app';
  /** `emitEvents: false` + `skipTracking` — suppresses flows, revisions, activity. */
  fastWrite: boolean;
  /** Runs survive a closed browser tab. */
  backgroundRuns: boolean;
  /** All 72 faker locales (app-only mode ships English). */
  allLocales: boolean;
  /** Server-side batching is not capped by MAX_PAYLOAD_SIZE. */
  largeBatches: boolean;
  /** Reads directus_flows to warn about trigger storms. */
  flowInsights: boolean;
  /** Run history + undo are persisted. */
  auditTrail: boolean;
}

export interface FlowInfo {
  id: string;
  name: string;
  status: string;
  trigger: string;
  collections: string[];
  actions: string[];
}

export interface CollectionInsights {
  collection: string;
  rowCount: number;
  /** Active flows that would fire once per generated row. */
  flows: FlowInfo[];
  /** Collections whose rows reference this one (FK children). */
  dependents: Array<{ collection: string; field: string; required: boolean }>;
  /** Collections this one needs rows in before it can be seeded. */
  dependencies: Array<{ collection: string; field: string; required: boolean; rowCount: number }>;
  /** `directus_collections.accountability` — 'all' means a revision per row. */
  accountability: string | null;
  writesRevisions: boolean;
  isProduction: boolean;
  publicUrl?: string | null;
}
