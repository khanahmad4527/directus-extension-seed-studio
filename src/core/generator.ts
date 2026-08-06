import { applyConditions, conditionDependencies } from './conditions.js';
import { resolveInsertOptions, type SeedDataSource } from './data-source.js';
import { applyInvariants, type InvariantChange } from './invariants.js';
import {
  isUnsafeFieldName,
  LIMITS,
  validateRowCount,
  validateStrategyMap,
} from './request-validation.js';
import type { Rng } from './rng.js';
import { buildCollectionDescriptor } from './schema-model.js';
import { StrategyExecutor } from './strategy-executor.js';
import { templateDependencies } from './template.js';
import type {
  CollectionDescriptor,
  FieldDescriptor,
  GenerationRequest,
  GenerationStrategy,
  PreviewRequest,
  PreviewResult,
  PrimaryKey,
  ProgressEvent,
  RowIssue,
  RunOptions,
  StrategyMap,
} from './types.js';
import { validateRow } from './validation.js';

export interface CancellationToken {
  readonly aborted: boolean;
}

export interface EngineLogger {
  info?: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
}

export interface GenerationContext {
  ds: SeedDataSource;
  rng: Rng;
  onProgress?: (event: Omit<ProgressEvent, 'runId'>) => void;
  token?: CancellationToken;
  logger?: EngineLogger;
}

export interface GenerationResult {
  rowsWritten: number;
  junctionRowsWritten: number;
  durationMs: number;
  seed: number;
  /** The "now" this run generated against — pass it back with the seed to replay. */
  now: string;
  /** Primary keys we created, so the run can be undone. */
  createdIds: PrimaryKey[];
  /** True when the id list was capped and undo can only be partial. */
  createdIdsTruncated: boolean;
  warnings: string[];
  cancelled: boolean;
}

/** Hard cap on remembered ids — enough to undo a large run without unbounded memory. */
const UNDO_ID_LIMIT = 100_000;
const MAX_PREVIEW_ROWS = 50;
/** Junction rows are parents × links; cap the product so a batch cannot blow memory. */
const MAX_JUNCTION_ROWS_PER_BATCH = 100_000;

export async function runGeneration(
  request: GenerationRequest,
  ctx: GenerationContext
): Promise<GenerationResult> {
  const startedAt = Date.now();
  const options = request.options ?? {};
  const batchSize = clampBatch(request.batchSize, ctx.ds.capabilities.largeBatches);
  const total = Math.max(0, Math.floor(request.count));
  const totalBatches = Math.max(1, Math.ceil(total / batchSize));
  const warnings: string[] = [];

  validateStrategyMap(request.strategies);
  validateRowCount(request.count);

  const descriptor = await buildCollectionDescriptor(ctx.ds, request.collection, {
    detect: detectOptionsFrom(options),
  });

  assertNotSingleton(descriptor);
  assertWipeConfirmed(request, descriptor);
  validateStrategies(descriptor, request.strategies);

  const nowMs = resolveNow(options);
  const executor = new StrategyExecutor(ctx.ds, ctx.rng, { preloadUnique: true, now: nowMs });
  await executor.prepare(request.strategies, descriptor);
  await assertReferencesReady(descriptor, request.strategies, executor);

  if (request.wipeFirst) {
    emit(ctx, { type: 'phase', phase: 'wipe', message: `Deleting existing ${descriptor.collection} rows` });
    await ctx.ds.deleteAll(descriptor.collection);
  }

  emit(ctx, { type: 'start', totalRows: total, totalBatches, elapsedMs: 0 });

  const insertOptions = resolveInsertOptions(ctx.ds, options);
  if (options.writeMode === 'fast' && !ctx.ds.capabilities.fastWrite) {
    warnings.push(
      'Fast write was requested but this engine cannot suppress hooks, flows and revisions — wrote in safe mode instead.'
    );
  }

  const createdIds: PrimaryKey[] = [];
  let createdIdsTruncated = false;
  let rowsWritten = 0;
  let junctionRowsWritten = 0;
  let batchIndex = 0;
  let cancelled = false;

  while (rowsWritten < total) {
    if (ctx.token?.aborted) {
      cancelled = true;
      break;
    }

    const remaining = total - rowsWritten;
    const size = Math.min(batchSize, remaining);
    const built = await buildRows(descriptor, request.strategies, executor, rowsWritten, size, options);

    let keys: PrimaryKey[] = [];
    try {
      keys = await ctx.ds.insertMany(descriptor.collection, built.rows, insertOptions);
    } catch (err: any) {
      throw new Error(`Batch ${batchIndex + 1} failed: ${err?.message ?? err}`);
    }

    if (createdIds.length < UNDO_ID_LIMIT) {
      createdIds.push(...keys.slice(0, UNDO_ID_LIMIT - createdIds.length));
      if (createdIds.length >= UNDO_ID_LIMIT) createdIdsTruncated = true;
    }

    rowsWritten += built.rows.length;
    batchIndex += 1;

    const junctionWritten = await writeJunctionRows(descriptor, request.strategies, executor, ctx, keys, insertOptions);
    junctionRowsWritten += junctionWritten;

    emit(ctx, {
      type: 'batch',
      rowsWritten,
      totalRows: total,
      currentBatch: batchIndex,
      totalBatches,
      elapsedMs: Date.now() - startedAt,
    });
  }

  const durationMs = Date.now() - startedAt;
  emit(ctx, {
    type: cancelled ? 'cancelled' : 'complete',
    rowsWritten,
    totalRows: total,
    elapsedMs: durationMs,
  });

  const failures = executor.failureCount;
  if (failures > 0) {
    warnings.push(
      `${failures} field value${failures === 1 ? '' : 's'} could not be generated and were written as empty. Check the strategies for this collection.`
    );
  }

  return {
    rowsWritten,
    junctionRowsWritten,
    durationMs,
    seed: ctx.rng.baseSeed,
    now: new Date(nowMs).toISOString(),
    createdIds,
    createdIdsTruncated,
    warnings,
    cancelled,
  };
}

export interface PreviewOutcome extends PreviewResult {
  /** What the invariant pass changed, so the UI can explain itself. */
  changes: InvariantChange[];
  descriptor: CollectionDescriptor;
}

/**
 * Build rows without writing them, then run the checks Directus would run.
 *
 * This is the difference between a preview and a dry run: the caller learns
 * which rows would be rejected — and why — before a single insert.
 */
export async function runPreview(
  request: PreviewRequest,
  ctx: GenerationContext
): Promise<PreviewOutcome> {
  validateStrategyMap(request.strategies);
  const options = request.options ?? {};
  const count = Math.min(Math.max(1, request.count ?? 10), MAX_PREVIEW_ROWS);

  const descriptor = await buildCollectionDescriptor(ctx.ds, request.collection, {
    detect: detectOptionsFrom(options),
  });
  assertNotSingleton(descriptor);

  const nowMs = resolveNow(options);
  const executor = new StrategyExecutor(ctx.ds, ctx.rng, { preloadUnique: false, now: nowMs });
  await executor.prepare(request.strategies, descriptor);

  const built = await buildRows(descriptor, request.strategies, executor, 0, count, options);

  const issues: RowIssue[] = [];
  built.rows.forEach((row, index) => {
    issues.push(...validateRow(row, descriptor.fields, index));
  });

  return {
    rows: built.rows,
    issues,
    changes: built.changes,
    seed: ctx.rng.baseSeed,
    now: new Date(nowMs).toISOString(),
    descriptor,
  };
}

interface BuiltRows {
  rows: Record<string, unknown>[];
  changes: InvariantChange[];
}

async function buildRows(
  descriptor: CollectionDescriptor,
  strategies: StrategyMap,
  executor: StrategyExecutor,
  startRowIndex: number,
  count: number,
  options: RunOptions
): Promise<BuiltRows> {
  const ordered = orderFieldsByDependency(descriptor.fields, strategies);
  const rows: Record<string, unknown>[] = [];
  const changes: InvariantChange[] = [];

  for (let i = 0; i < count; i++) {
    const rowIndex = startRowIndex + i;
    // Re-seed per row: row N is identical regardless of batch size or resume point.
    executor.seedRow(rowIndex);

    const row: Record<string, unknown> = {};
    const entity = executor.newEntity(rowIndex, descriptor.collection);

    for (const field of ordered) {
      if (field.isAlias || field.isSystemField || field.readonly) continue;
      // A column literally named `__proto__` would mutate the row's prototype
      // instead of adding a value. Nothing good comes of writing it.
      if (isUnsafeFieldName(field.field)) continue;
      const strategy: GenerationStrategy | undefined = strategies[field.field] ?? field.suggestedStrategy;
      if (!strategy) continue;
      if (strategy.kind === 'system' || strategy.kind === 'skip' || strategy.kind === 'm2m_random') continue;

      const value = await executor.execute(strategy, field, { rowIndex, row, entity });
      if (value === undefined) continue;
      row[field.field] = value;
    }

    if (options.respectConditions !== false) {
      applyConditions(row, descriptor.fields);
    }
    if (options.invariants !== false) {
      changes.push(...applyInvariants(row, descriptor.fields));
    }

    rows.push(row);
  }

  return { rows, changes };
}

/**
 * Write the junction rows for `m2m_random` fields.
 *
 * Cardinality is drawn per parent rather than fixed: a few rows get many links,
 * most get one or two, which is how tagging actually looks.
 */
async function writeJunctionRows(
  descriptor: CollectionDescriptor,
  strategies: StrategyMap,
  executor: StrategyExecutor,
  ctx: GenerationContext,
  parentKeys: PrimaryKey[],
  insertOptions: { fast?: boolean }
): Promise<number> {
  if (parentKeys.length === 0) return 0;

  let written = 0;

  for (const field of descriptor.fields) {
    const strategy = strategies[field.field] ?? field.suggestedStrategy;
    if (!strategy || strategy.kind !== 'm2m_random') continue;

    const relation = field.relation;
    if (
      !relation?.junction ||
      !relation.junctionParentField ||
      !relation.junctionRelatedField ||
      !relation.relatedCollection
    ) {
      continue;
    }

    const pool = await executor.ensureFkPool(relation.relatedCollection);
    if (pool.length === 0) continue;

    const junctionRows: Record<string, unknown>[] = [];
    for (const parentKey of parentKeys) {
      // Zipf-ish: most parents get few links, some get many.
      const skew = ctx.rng.float(0, 1, 4);
      const span = Math.max(0, strategy.max - strategy.min);
      const links = Math.min(
        LIMITS.maxM2mLinks,
        strategy.min + Math.floor(span * Math.pow(skew, 2))
      );
      if (links <= 0) continue;
      if (junctionRows.length >= MAX_JUNCTION_ROWS_PER_BATCH) break;
      for (const relatedKey of ctx.rng.pickSome(pool, links)) {
        junctionRows.push({
          [relation.junctionParentField]: parentKey,
          [relation.junctionRelatedField]: relatedKey,
        });
      }
    }

    if (junctionRows.length === 0) continue;
    try {
      await ctx.ds.insertMany(relation.junction, junctionRows, insertOptions);
      written += junctionRows.length;
    } catch (err: any) {
      ctx.logger?.warn?.(
        { collection: relation.junction, err: err?.message ?? err },
        'Seed Studio: junction rows rejected'
      );
    }
  }

  return written;
}

/**
 * Order fields so a field that reads another field's value runs after it.
 *
 * Covers `random_item_of_field`, `{{row.x}}` templates and conditional fields;
 * cycles fall back to declaration order rather than hanging.
 */
export function orderFieldsByDependency(
  fields: FieldDescriptor[],
  strategies: StrategyMap
): FieldDescriptor[] {
  const byName = new Map(fields.map((f) => [f.field, f]));
  const deps = new Map<string, string[]>();

  for (const field of fields) {
    const strategy = strategies[field.field] ?? field.suggestedStrategy;
    const list = new Set<string>();

    if (strategy?.kind === 'random_item_of_field') list.add(strategy.collectionField);
    if (strategy?.kind === 'template') {
      for (const dep of templateDependencies(strategy.template)) list.add(dep);
    }
    for (const dep of conditionDependencies(field)) list.add(dep);

    deps.set(
      field.field,
      [...list].filter((name) => name !== field.field && byName.has(name))
    );
  }

  const out: FieldDescriptor[] = [];
  const state = new Map<string, 'visiting' | 'done'>();

  const visit = (name: string): void => {
    const current = state.get(name);
    if (current === 'done' || current === 'visiting') return;
    state.set(name, 'visiting');
    for (const dep of deps.get(name) ?? []) visit(dep);
    state.set(name, 'done');
    const field = byName.get(name);
    if (field) out.push(field);
  };

  for (const field of fields) visit(field.field);
  return out;
}

/**
 * A run's "now". Relative dates hang off it, so it is fixed once per run and
 * reported back: seed alone cannot reproduce a run whose dates move with the clock.
 */
function resolveNow(options: RunOptions): number {
  if (options.now) {
    const parsed = Date.parse(options.now);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function detectOptionsFrom(options: RunOptions) {
  return {
    coherentRows: options.coherentRows !== false,
    realisticNulls: options.realisticNulls === true,
  };
}

function clampBatch(requested: number | undefined, largeBatches: boolean): number {
  const fallback = largeBatches ? 500 : 100;
  const value = Math.floor(requested ?? fallback);
  if (!Number.isFinite(value) || value < 1) return fallback;
  // Over HTTP the payload has to fit inside MAX_PAYLOAD_SIZE (1mb by default).
  return largeBatches ? Math.min(value, 5000) : Math.min(value, 200);
}

function emit(ctx: GenerationContext, event: Omit<ProgressEvent, 'runId'>): void {
  try {
    ctx.onProgress?.(event);
  } catch {
    // Progress reporting must never break a run.
  }
}

function assertNotSingleton(descriptor: CollectionDescriptor): void {
  if (descriptor.singleton) {
    throw new Error(
      `Refusing to generate into "${descriptor.collection}". This is a singleton collection (1 row max). Edit the single row in the Directus admin directly.`
    );
  }
}

/**
 * A wipe is irreversible, so it needs the collection name typed back.
 * The check lives here rather than in the UI so every caller inherits it.
 */
function assertWipeConfirmed(request: GenerationRequest, descriptor: CollectionDescriptor): void {
  if (!request.wipeFirst) return;
  if (request.confirm === descriptor.collection) return;
  throw new Error(
    `Refusing to wipe "${descriptor.collection}" (${descriptor.rowCount} rows): confirmation missing. Send confirm:"${descriptor.collection}" to proceed.`
  );
}

function validateStrategies(descriptor: CollectionDescriptor, strategies: StrategyMap): void {
  for (const field of descriptor.fields) {
    if (field.isAlias || field.isSystemField || field.readonly) continue;
    const strategy = strategies[field.field] ?? field.suggestedStrategy;
    if (!strategy) continue;
    if (!field.required) continue;
    if (field.defaultValue !== null && field.defaultValue !== undefined) continue;

    if (strategy.kind === 'null' || strategy.kind === 'skip') {
      throw new Error(
        `Cannot generate: field "${field.field}" is required but strategy is "${strategy.kind}". Pick a strategy that produces a value.`
      );
    }
    if (typeof strategy.nullRate === 'number' && strategy.nullRate > 0) {
      throw new Error(
        `Cannot generate: field "${field.field}" is required but its strategy leaves ${Math.round(
          strategy.nullRate * 100
        )}% of rows empty.`
      );
    }
  }
}

/** Fail before writing when a required FK has nothing to point at. */
async function assertReferencesReady(
  descriptor: CollectionDescriptor,
  strategies: StrategyMap,
  executor: StrategyExecutor
): Promise<void> {
  for (const field of descriptor.fields) {
    if (!field.required) continue;
    const strategy = strategies[field.field] ?? field.suggestedStrategy;
    if (!strategy) continue;

    if (strategy.kind === 'm2o_random') {
      const pool = await executor.ensureFkPool(strategy.relatedCollection);
      if (pool.length === 0) {
        throw new Error(
          `Cannot generate: field "${field.field}" is required but related collection "${strategy.relatedCollection}" has no rows. Add data to "${strategy.relatedCollection}" first.`
        );
      }
    }

    if (strategy.kind === 'file_reuse') {
      if (executor.filePool(strategy.mimeFilter ?? '').length === 0) {
        throw new Error(
          `Cannot generate: field "${field.field}" is required but no matching files exist in directus_files. Upload at least one file or change the strategy.`
        );
      }
    }
  }
}

/** Delete rows a previous run created. Returns how many were removed. */
export async function undoRun(
  ds: SeedDataSource,
  collection: string,
  ids: PrimaryKey[],
  chunkSize = 200
): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    await ds.deleteByIds(collection, chunk);
    deleted += chunk.length;
  }
  return deleted;
}
