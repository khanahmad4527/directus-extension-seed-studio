/**
 * The admin app and the API extension share one type surface: `src/core/types`.
 *
 * These are type-only re-exports, so nothing from the engine is pulled into the
 * app bundle unless a component actually imports engine code.
 */
export type {
  AuditRunRow,
  Bbox,
  CoherentTrait,
  CollectionDescriptor,
  CollectionInsights,
  EngineCapabilities,
  FakerMethodEntry,
  FieldConstraints,
  FieldCondition,
  FieldDescriptor,
  FlowInfo,
  GenerationRequest,
  GenerationStrategy,
  PresetRow,
  PreviewRequest,
  PreviewResult,
  PrimaryKey,
  ProgressEvent,
  RelationDescriptor,
  RowIssue,
  RunOptions,
  StrategyKind,
  StrategyMap,
  WeightedChoice,
} from '../core/types.js';

export type { FieldProfile, ProfileResult } from '../core/inference.js';
export type { InvariantChange } from '../core/invariants.js';
export type { ProjectPlan } from '../core/project.js';
export type { Prerequisite, PreflightResult } from '../core/preflight.js';
export type { BlockCategory, SeedTargetVerdict } from '../core/seed-targets.js';

export interface CollectionSummary {
  collection: string;
  displayName: string;
  fieldCount: number;
  rowCount: number;
  isSystem: boolean;
  singleton?: boolean;
  /** False for system tables Seed Studio refuses to write to. */
  seedable: boolean;
  blockedReason?: string | null;
  blockedCategory?: import('../core/seed-targets.js').BlockCategory | null;
  /** A caveat worth reading before seeding an otherwise-allowed collection. */
  warning?: string | null;
}

/** Which engine the UI is currently driving. */
export interface EngineStatus {
  engine: 'api' | 'app';
  capabilities: import('../core/types.js').EngineCapabilities;
  locales: string[];
  /** Set when the API extension is unavailable and we fell back to the browser. */
  fallbackReason?: string;
  environment?: { publicUrl: string | null; isProduction: boolean };
}

export interface PreviewResponse {
  rows: Record<string, unknown>[];
  issues: import('../core/types.js').RowIssue[];
  changes: import('../core/invariants.js').InvariantChange[];
  seed: number;
}
