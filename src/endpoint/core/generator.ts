import type {
  CollectionDescriptor,
  FieldDescriptor,
  GenerationRequest,
  GenerationStrategy,
  PreviewRequest,
  StrategyMap,
} from '../types.js';
import { buildCollectionDescriptor } from './schema-reader.js';
import { StrategyExecutor } from './strategy-executor.js';
import { SseBus } from '../progress/sse-bus.js';
import { updateAuditEnd } from './audit.js';

interface GenerationContext {
  services: any;
  schema: any;
  accountability: any;
  progressBus: SseBus;
  logger: { info: (...a: any[]) => void; error: (...a: any[]) => void };
}

export async function runGeneration(
  request: GenerationRequest,
  runId: string,
  auditId: string,
  ctx: GenerationContext
): Promise<{ rowsWritten: number; durationMs: number }> {
  const startedAt = Date.now();
  const batchSize = Math.max(1, request.batchSize ?? 500);
  const totalBatches = Math.ceil(request.count / batchSize);

  try {
    assertNotSingleton(request.collection, ctx.schema);

    const descriptor = await buildCollectionDescriptor(
      request.collection,
      ctx.services,
      ctx.schema,
      ctx.accountability
    );

    validateStrategies(descriptor, request.strategies);

    const executor = new StrategyExecutor(ctx.services, ctx.schema, ctx.accountability);
    await executor.prepare(request.strategies);

    await assertM2oFilesReady(descriptor, request.strategies, executor, ctx);

    const { ItemsService } = ctx.services;
    const itemsService = new ItemsService(request.collection, {
      schema: ctx.schema,
      accountability: ctx.accountability,
    });

    if (request.wipeFirst) {
      try {
        await itemsService.deleteByQuery({ limit: -1 });
      } catch (err: any) {
        throw new Error(`Wipe failed: ${err?.message ?? err}`);
      }
    }

    ctx.progressBus.emit(runId, {
      runId,
      type: 'start',
      totalRows: request.count,
      totalBatches,
      elapsedMs: 0,
    });

    let written = 0;
    let batchIdx = 0;
    let rowIndex = 0;

    while (written < request.count) {
      const remaining = request.count - written;
      const n = Math.min(batchSize, remaining);
      const rows = await buildRows(descriptor, request.strategies, executor, rowIndex, n);
      rowIndex += n;

      try {
        await itemsService.createMany(rows);
      } catch (err: any) {
        throw new Error(`Batch write failed at batch ${batchIdx + 1}: ${err?.message ?? err}`);
      }

      written += rows.length;
      batchIdx += 1;

      ctx.progressBus.emit(runId, {
        runId,
        type: 'batch',
        rowsWritten: written,
        totalRows: request.count,
        currentBatch: batchIdx,
        totalBatches,
        elapsedMs: Date.now() - startedAt,
      });
    }

    const durationMs = Date.now() - startedAt;
    ctx.progressBus.emit(runId, {
      runId,
      type: 'complete',
      rowsWritten: written,
      totalRows: request.count,
      elapsedMs: durationMs,
    });

    await updateAuditEnd(ctx.services, ctx.schema, ctx.accountability, auditId, {
      row_count_written: written,
      status: 'success',
      duration_ms: durationMs,
      completed_at: new Date().toISOString(),
    });

    return { rowsWritten: written, durationMs };
  } catch (err: any) {
    const message = err?.message ?? String(err);
    const durationMs = Date.now() - startedAt;

    ctx.progressBus.emit(runId, {
      runId,
      type: 'error',
      message,
      elapsedMs: durationMs,
    });

    try {
      await updateAuditEnd(ctx.services, ctx.schema, ctx.accountability, auditId, {
        status: 'failed',
        error_message: message,
        duration_ms: durationMs,
        completed_at: new Date().toISOString(),
      });
    } catch {
      // ignore audit write failure
    }

    ctx.logger.error({ runId, message }, 'Seed Studio generation failed');
    throw err;
  }
}

export async function runPreview(
  request: PreviewRequest,
  ctx: GenerationContext
): Promise<{ rows: Record<string, unknown>[] }> {
  assertNotSingleton(request.collection, ctx.schema);
  const count = Math.min(Math.max(1, request.count ?? 10), 50);
  const descriptor = await buildCollectionDescriptor(
    request.collection,
    ctx.services,
    ctx.schema,
    ctx.accountability
  );

  const executor = new StrategyExecutor(ctx.services, ctx.schema, ctx.accountability);
  await executor.prepare(request.strategies);
  const rows = await buildRows(descriptor, request.strategies, executor, 0, count);
  return { rows };
}

function assertNotSingleton(collection: string, schema: any): void {
  const c = schema?.collections?.[collection];
  if (c?.singleton === true) {
    throw new Error(
      `Refusing to generate into "${collection}". This is a singleton collection (1 row max). Edit the single row in the Directus admin directly.`
    );
  }
}

function validateStrategies(descriptor: CollectionDescriptor, strategies: StrategyMap): void {
  for (const f of descriptor.fields) {
    if (f.isSystemField || f.readonly) continue;
    const s = strategies[f.field] ?? f.suggestedStrategy;
    if (!s) continue;
    if (f.required && (s.kind === 'null' || s.kind === 'skip')) {
      throw new Error(
        `Cannot generate: field "${f.field}" is required but strategy is "${s.kind}". Pick a strategy that produces a value.`
      );
    }
  }
}

async function assertM2oFilesReady(
  descriptor: CollectionDescriptor,
  strategies: StrategyMap,
  executor: StrategyExecutor,
  ctx: GenerationContext
): Promise<void> {
  for (const f of descriptor.fields) {
    const s = strategies[f.field] ?? f.suggestedStrategy;
    if (!s) continue;

    if (s.kind === 'm2o_random' && f.required) {
      const probe = await executor.execute(s, f, 0);
      if (probe === null || probe === undefined) {
        throw new Error(
          `Cannot generate: field "${f.field}" is required but related collection "${s.relatedCollection}" has no rows. Add data to "${s.relatedCollection}" first.`
        );
      }
    }

    if (s.kind === 'file_reuse' && f.required) {
      const probe = await executor.execute(s, f, 0);
      if (probe === null || probe === undefined) {
        throw new Error(
          `Cannot generate: field "${f.field}" is required but no matching files exist in directus_files. Upload at least one file or change the strategy.`
        );
      }
    }
  }
}

async function buildRows(
  descriptor: CollectionDescriptor,
  strategies: StrategyMap,
  executor: StrategyExecutor,
  startRowIndex: number,
  count: number
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const orderedFields = orderFieldsByDependency(descriptor.fields, strategies);
  for (let i = 0; i < count; i++) {
    const rowIndex = startRowIndex + i;
    const row: Record<string, unknown> = {};
    for (const f of orderedFields) {
      if (f.isSystemField || f.readonly) continue;
      const strategy: GenerationStrategy = strategies[f.field] ?? f.suggestedStrategy;
      if (!strategy || strategy.kind === 'system' || strategy.kind === 'skip') continue;
      const value = await executor.execute(strategy, f, rowIndex, row);
      if (value === undefined) continue;
      row[f.field] = value;
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Order fields so `random_item_of_field` runs AFTER the field it peeks at.
 * Simple two-pass: independent fields first, dependents after.
 */
function orderFieldsByDependency(
  fields: FieldDescriptor[],
  strategies: StrategyMap
): FieldDescriptor[] {
  const independents: FieldDescriptor[] = [];
  const dependents: FieldDescriptor[] = [];
  for (const f of fields) {
    const s = strategies[f.field] ?? f.suggestedStrategy;
    if (s?.kind === 'random_item_of_field') {
      dependents.push(f);
    } else {
      independents.push(f);
    }
  }
  return [...independents, ...dependents];
}

export type { FieldDescriptor };
