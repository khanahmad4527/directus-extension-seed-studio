import type { RawField, SeedDataSource } from './data-source.js';
import { runGeneration, type GenerationContext } from './generator.js';
import {
  buildRelationGraph,
  suggestCounts,
  topoSortCollections,
  type TopoResult,
} from './relation-graph.js';
import { buildCollectionDescriptor } from './schema-model.js';
import type { CollectionDescriptor, RunOptions, StrategyMap } from './types.js';

/**
 * Whole-project seeding.
 *
 * One collection at a time is the wrong unit of work: `comments` needs `posts`,
 * which needs `authors`. This module reads the relation graph, orders the
 * selected collections so every parent exists before its children, sizes each
 * collection from its position in the graph, and runs them in sequence.
 */

export interface ProjectPlanRequest {
  collections: string[];
  /** Explicit row counts; anything missing is inferred from the graph. */
  counts?: Record<string, number>;
  baseCount?: number;
}

export interface ProjectPlan {
  order: string[];
  counts: Record<string, number>;
  cycles: TopoResult['cycles'];
  notes: string[];
}

export async function planProject(
  ds: SeedDataSource,
  request: ProjectPlanRequest
): Promise<ProjectPlan> {
  const selected = [...new Set(request.collections)].filter(Boolean);
  if (selected.length === 0) {
    return { order: [], counts: {}, cycles: [], notes: ['No collections selected.'] };
  }

  const relations = await ds.getRelations();
  const fieldsByCollection = new Map<string, RawField[]>();
  await Promise.all(
    selected.map(async (collection) => {
      try {
        fieldsByCollection.set(collection, await ds.getFields(collection));
      } catch {
        fieldsByCollection.set(collection, []);
      }
    })
  );

  const graph = buildRelationGraph(relations, fieldsByCollection);
  const { order, cycles } = topoSortCollections(selected, graph);
  const suggested = suggestCounts(order, graph, request.baseCount ?? 200);

  const counts: Record<string, number> = {};
  for (const collection of order) {
    counts[collection] = Math.max(1, Math.floor(request.counts?.[collection] ?? suggested[collection] ?? 100));
  }

  const notes: string[] = [];

  // Required FKs pointing outside the selection cannot be satisfied by this run.
  for (const collection of order) {
    for (const edge of graph.dependenciesOf(collection)) {
      if (order.includes(edge.to)) continue;
      if (!edge.required) continue;
      const rowCount = await safeCount(ds, edge.to);
      if (rowCount === 0) {
        notes.push(
          `${collection}.${edge.field} is required and points at ${edge.to}, which is not selected and has no rows — add ${edge.to} to the run.`
        );
      }
    }
  }

  for (const cycle of cycles) {
    notes.push(
      cycle.brokenAt
        ? `Cycle between ${cycle.collections.join(' ↔ ')} — deferred ${cycle.brokenAt.from}.${cycle.brokenAt.field} because it is optional.`
        : `Cycle between ${cycle.collections.join(' ↔ ')} with no optional link to defer; required references there may fail.`
    );
  }

  return { order, counts, cycles, notes };
}

export interface ProjectRunRequest {
  plan: ProjectPlan;
  options?: RunOptions;
  /** Per-collection strategy overrides; anything absent uses detection. */
  strategies?: Record<string, StrategyMap>;
  wipeFirst?: boolean;
  /** Must list every collection to be wiped, mirroring the single-collection guard. */
  confirmWipe?: string[];
}

export interface ProjectCollectionResult {
  collection: string;
  requested: number;
  rowsWritten: number;
  junctionRowsWritten: number;
  durationMs: number;
  error?: string;
}

export interface ProjectRunResult {
  results: ProjectCollectionResult[];
  totalRows: number;
  durationMs: number;
  seed: number;
  cancelled: boolean;
}

export async function runProject(
  request: ProjectRunRequest,
  ctx: GenerationContext
): Promise<ProjectRunResult> {
  const startedAt = Date.now();
  const results: ProjectCollectionResult[] = [];
  let totalRows = 0;
  let cancelled = false;

  for (const collection of request.plan.order) {
    if (ctx.token?.aborted) {
      cancelled = true;
      break;
    }

    const requested = request.plan.counts[collection] ?? 0;
    ctx.onProgress?.({
      type: 'phase',
      phase: collection,
      message: `Seeding ${collection} (${requested} rows)`,
    });

    let descriptor: CollectionDescriptor;
    try {
      descriptor = await buildCollectionDescriptor(ctx.ds, collection, {
        detect: {
          coherentRows: request.options?.coherentRows !== false,
          realisticNulls: request.options?.realisticNulls === true,
        },
      });
    } catch (err: any) {
      results.push({
        collection,
        requested,
        rowsWritten: 0,
        junctionRowsWritten: 0,
        durationMs: 0,
        error: err?.message ?? String(err),
      });
      continue;
    }

    const strategies: StrategyMap = {
      ...Object.fromEntries(descriptor.fields.map((f) => [f.field, f.suggestedStrategy])),
      ...(request.strategies?.[collection] ?? {}),
    };

    const wipe = Boolean(request.wipeFirst && request.confirmWipe?.includes(collection));

    // A child run emits its own `start`/`complete`. Forwarded as-is, the very
    // first collection's `complete` closes the progress stream and the rest of
    // the project appears to never run. Re-label them as phase updates so only
    // the project's own terminal event ends the stream.
    const childCtx: GenerationContext = {
      ...ctx,
      onProgress: (event) => {
        if (event.type === 'start' || event.type === 'complete' || event.type === 'cancelled') {
          ctx.onProgress?.({
            ...event,
            type: 'phase',
            phase: collection,
            message:
              event.type === 'complete'
                ? `${collection}: ${event.rowsWritten ?? 0} rows`
                : `${collection}: ${event.type}`,
          });
          return;
        }
        ctx.onProgress?.({ ...event, phase: collection });
      },
    };

    try {
      const result = await runGeneration(
        {
          collection,
          strategies,
          count: requested,
          wipeFirst: wipe,
          confirm: wipe ? collection : undefined,
          options: request.options,
        },
        childCtx
      );
      totalRows += result.rowsWritten;
      results.push({
        collection,
        requested,
        rowsWritten: result.rowsWritten,
        junctionRowsWritten: result.junctionRowsWritten,
        durationMs: result.durationMs,
      });
      if (result.cancelled) {
        cancelled = true;
        break;
      }
    } catch (err: any) {
      // Keep going: a failure in one collection should not discard the rest.
      results.push({
        collection,
        requested,
        rowsWritten: 0,
        junctionRowsWritten: 0,
        durationMs: 0,
        error: err?.message ?? String(err),
      });
    }
  }

  return {
    results,
    totalRows,
    durationMs: Date.now() - startedAt,
    seed: ctx.rng.baseSeed,
    cancelled,
  };
}

async function safeCount(ds: SeedDataSource, collection: string): Promise<number> {
  try {
    return await ds.count(collection);
  } catch {
    return 0;
  }
}
