/**
 * Seed Studio engine.
 *
 * Environment-agnostic by design: no Node built-ins, no express, no faker
 * import, no `@directus/*` runtime code. The API extension and the admin-app
 * module both drive it through `SeedDataSource`, which is what lets the module
 * work on Directus Cloud, where unsandboxed API extensions cannot be installed.
 */

export * from './types.js';
export * from './data-source.js';
export { createRng, hashSeed, randomSeed, type FakerLike, type Rng } from './rng.js';
export {
  FAKER_METHODS,
  FAKER_METHOD_PATHS,
  FAKER_MODULES,
  invokeFaker,
  isValidFakerPath,
  resolveFakerCallable,
} from './faker-methods.js';
export { compileConstraints, fieldsInFilter, matchesFilter } from './filter-ast.js';
export {
  createRowEntity,
  detectFlavor,
  readTrait,
  skewedPastDate,
  slugify,
  titleCase,
  type RowEntity,
} from './entity.js';
export { renderTemplate, templateDependencies, type TemplateContext } from './template.js';
export {
  detectField,
  detectStrategy,
  hasAutoManagedSpecial,
  isAliasField,
  FAKER_TO_TRAIT,
  type DetectContext,
  type DetectOptions,
  type DetectResult,
} from './strategy-detector.js';
export { SYSTEM_FIELD_RULES, lookupSystemFieldRule } from './system-field-rules.js';
export { buildCollectionDescriptor, resolveDisplayName } from './schema-model.js';
export {
  buildConstraints,
  clampNumber,
  extractIsUnique,
  extractMaxLength,
  formatSequence,
  mutateForUniqueness,
  postProcessValue,
  truncateString,
  UniqueRegistry,
  validateRow,
} from './validation.js';
export { applyInvariants, type InvariantChange } from './invariants.js';
export { applyConditions, conditionDependencies, type ConditionOutcome } from './conditions.js';
export { StrategyExecutor, formatDateForType, type RowContext } from './strategy-executor.js';
export {
  buildRelationGraph,
  resolveRelation,
  suggestCounts,
  topoSortCollections,
  type RelationEdge,
  type RelationGraph,
  type TopoResult,
} from './relation-graph.js';
export {
  orderFieldsByDependency,
  runGeneration,
  runPreview,
  undoRun,
  type CancellationToken,
  type GenerationContext,
  type GenerationResult,
  type PreviewOutcome,
} from './generator.js';
export {
  planProject,
  runProject,
  type ProjectPlan,
  type ProjectPlanRequest,
  type ProjectRunRequest,
  type ProjectRunResult,
} from './project.js';
export { profileCollection, inferPattern, type FieldProfile, type ProfileResult } from './inference.js';
export { collectionInsights, insightWarnings } from './insights.js';
