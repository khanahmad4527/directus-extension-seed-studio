export type GenerationStrategy =
  | { kind: 'system' }
  | { kind: 'skip' }
  | { kind: 'null' }
  | { kind: 'fixed'; value: unknown }
  | { kind: 'faker'; method: string; args?: unknown[] }
  | { kind: 'random_choice'; choices: unknown[] }
  | { kind: 'random_int'; min: number; max: number }
  | { kind: 'random_float'; min: number; max: number; fractionDigits: number }
  | { kind: 'random_date'; daysBack: number; daysForward: number }
  | { kind: 'random_boolean'; trueProbability: number }
  | { kind: 'uuid' }
  | { kind: 'sequence'; pattern: string; startFrom?: number }
  | { kind: 'm2o_random'; relatedCollection: string }
  | { kind: 'file_reuse'; mimeFilter?: string }
  | { kind: 'lorem_paragraphs'; count: number }
  /** Pick a random USER collection name (excludes directus_* and seed_studio_*). */
  | { kind: 'random_user_collection' }
  /** Pick a random PK from the collection chosen by another field in the same row. */
  | { kind: 'random_item_of_field'; collectionField: string };

export interface RelationDescriptor {
  type: 'm2o' | 'o2m' | 'm2m' | 'm2a' | 'self';
  relatedCollection: string | null;
  relatedCollections?: string[];
  junction?: string;
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
  relation: RelationDescriptor | null;
  options: any;
  special: string[];
  validation: any;
  defaultValue: unknown;
  suggestedStrategy: GenerationStrategy;
  maxLength?: number | null;
  isUnique?: boolean;
}

export interface CollectionDescriptor {
  collection: string;
  displayName: string;
  primaryKeyField: string;
  rowCount: number;
  fields: FieldDescriptor[];
}

export type StrategyMap = Record<string, GenerationStrategy>;

export interface GenerationRequest {
  collection: string;
  strategies: StrategyMap;
  count: number;
  batchSize?: number;
  wipeFirst?: boolean;
  savePreset?: boolean;
  presetName?: string;
}

export interface PreviewRequest {
  collection: string;
  strategies: StrategyMap;
  count?: number;
}

export interface ProgressEvent {
  runId: string;
  type: 'start' | 'batch' | 'complete' | 'error';
  rowsWritten?: number;
  totalRows?: number;
  currentBatch?: number;
  totalBatches?: number;
  elapsedMs?: number;
  message?: string;
}

export interface AuditRunRow {
  id?: string;
  collection: string;
  row_count_requested: number;
  row_count_written: number;
  dry_run: boolean;
  wipe_first: boolean;
  strategies: StrategyMap;
  status: 'running' | 'success' | 'failed';
  error_message: string | null;
  duration_ms: number;
  started_at: string;
  completed_at: string | null;
}

export interface PresetRow {
  id?: string;
  name: string;
  collection: string;
  strategies: StrategyMap;
}

export interface FakerMethodEntry {
  label: string;
  path: string;
}
