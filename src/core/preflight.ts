import type { RawField, SeedDataSource } from './data-source.js';
import { buildRelationGraph, topoSortCollections, type RelationEdge, type RelationGraph } from './relation-graph.js';
import { classifySeedTarget } from './seed-targets.js';

/**
 * Dependency preflight.
 *
 * `m2o_random` returns null when the collection it points at is empty, so
 * seeding `comments` before `posts` either dies on a NOT NULL violation with a
 * raw SQL message, or — worse, because it looks like success — quietly writes a
 * column of nulls. Both happen after the run has started.
 *
 * This module answers the question up front: for a given target and row count,
 * which parents are missing, which of those are fatal, and what would have to
 * be generated first. The answer is a collection list the existing project
 * runner can execute directly, so the fix reuses the relation-ordered path
 * rather than introducing a second one.
 */

/** How many child rows we aim to have per parent row when suggesting counts. */
const CHILDREN_PER_PARENT = 5;
const MIN_SUGGESTED = 3;
const MAX_SUGGESTED = 500;

/** Depth limit for the transitive walk, so a pathological schema cannot hang. */
const MAX_DEPTH = 6;

/** One foreign key that points at a missing collection. */
export interface PrerequisiteReason {
  collection: string;
  field: string;
  required: boolean;
}

export interface Prerequisite {
  /** The empty collection that has to be filled. */
  collection: string;
  /** The collection that needs it — the first reason, for a one-line summary. */
  neededBy: string;
  /** The foreign-key field creating the need. */
  field: string;
  /**
   * Every field pointing at this collection. Two fields can demand the same
   * parent (`posts.cover` and `authors.avatar` both need `directus_files`), and
   * the decision — seed it, and how many rows — belongs to the collection, not
   * to each field, so they are merged into one entry.
   */
  requiredBy: PrerequisiteReason[];
  /**
   * True when at least one of `requiredBy` is NOT NULL. A collection demanded
   * by both a required and an optional field is treated as required.
   */
  required: boolean;
  rowCount: number;
  /** A sensible starting count; the user is expected to override it. */
  suggestedCount: number;
  /** 0 for a direct parent of the target, 1 for its parent, and so on. */
  depth: number;
  /** False when the parent is a collection Seed Studio refuses to write to. */
  seedable: boolean;
  blockedReason?: string;
}

export interface PreflightResult {
  collection: string;
  count: number;
  /** True when the run can proceed with no further action. */
  satisfied: boolean;
  /** Required parents that are empty. These block the run. */
  blocking: Prerequisite[];
  /** Optional parents that are empty. The run works but writes nulls. */
  warnings: Prerequisite[];
  /**
   * Blocking prerequisites that Seed Studio will not seed (a system table it
   * refuses, for instance). Nothing the UI offers can resolve these.
   */
  unresolvable: Prerequisite[];
  /**
   * Every collection to generate, dependencies first, ending with the target.
   * Feed straight to the project planner.
   */
  suggestedOrder: string[];
  /** Suggested count per collection in `suggestedOrder`. */
  suggestedCounts: Record<string, number>;
}

function suggestFor(childCount: number): number {
  const raw = Math.ceil(childCount / CHILDREN_PER_PARENT);
  return Math.min(MAX_SUGGESTED, Math.max(MIN_SUGGESTED, raw));
}

/**
 * Walk the target's ancestry and report what is missing.
 *
 * Only descends into a parent that is itself empty and required: if `posts`
 * already has rows there is no reason to look at what `posts` depends on, and
 * an optional empty parent is reported but not expanded, because the default
 * answer for it is "leave the column null".
 */
export async function preflightDependencies(
  ds: SeedDataSource,
  target: string,
  count: number
): Promise<PreflightResult> {
  const fieldsByCollection = new Map<string, RawField[]>();
  const relations = await ds.getRelations();

  const loadFields = async (collection: string): Promise<void> => {
    if (fieldsByCollection.has(collection)) return;
    try {
      fieldsByCollection.set(collection, await ds.getFields(collection));
    } catch {
      fieldsByCollection.set(collection, []);
    }
  };

  const countCache = new Map<string, number>();
  const rowsIn = async (collection: string): Promise<number> => {
    const cached = countCache.get(collection);
    if (cached !== undefined) return cached;
    let value = 0;
    try {
      value = await ds.count(collection);
    } catch {
      value = 0;
    }
    countCache.set(collection, value);
    return value;
  };

  /** One entry per missing collection, however many fields demand it. */
  const found = new Map<string, Prerequisite>();

  // Counts to generate, keyed by collection. Presence here also marks a
  // collection as already expanded, which is what stops a cycle looping.
  const plannedCounts: Record<string, number> = { [target]: count };

  type Frontier = { collection: string; count: number; depth: number };
  let frontier: Frontier[] = [{ collection: target, count, depth: 0 }];

  while (frontier.length) {
    const next: Frontier[] = [];

    for (const node of frontier) {
      if (node.depth > MAX_DEPTH) continue;
      await loadFields(node.collection);
      const graph: RelationGraph = buildRelationGraph(relations, fieldsByCollection);

      for (const edge of graph.dependenciesOf(node.collection)) {
        // A self-reference is filled in a later pass, never a prerequisite.
        if (edge.to === node.collection) continue;

        // Parent already has rows: nothing missing, and no reason to look at
        // what it in turn depends on.
        if ((await rowsIn(edge.to)) > 0) continue;

        const reason: PrerequisiteReason = {
          collection: node.collection,
          field: edge.field,
          required: edge.required,
        };

        let entry = found.get(edge.to);
        if (!entry) {
          const verdict = classifySeedTarget(edge.to);
          entry = {
            collection: edge.to,
            neededBy: node.collection,
            field: edge.field,
            requiredBy: [],
            required: false,
            rowCount: 0,
            suggestedCount: suggestFor(node.count),
            depth: node.depth,
            seedable: verdict.seedable,
            blockedReason: verdict.reason,
          };
          found.set(edge.to, entry);
        }
        entry.requiredBy.push(reason);
        entry.required = entry.required || edge.required;
        // The shallowest demand is the one the panel nests under.
        entry.depth = Math.min(entry.depth, node.depth);

        // Only a required edge pulls a collection into the run — the default
        // answer for an optional one is to leave the column null. A collection
        // already planned is not expanded twice, which is what breaks cycles.
        if (edge.required && entry.seedable && plannedCounts[edge.to] === undefined) {
          plannedCounts[edge.to] = entry.suggestedCount;
          next.push({ collection: edge.to, count: entry.suggestedCount, depth: node.depth + 1 });
        }
      }
    }

    frontier = next;
  }

  const all = [...found.values()];
  const blocking = all.filter((p) => p.required && p.seedable);
  const unresolvable = all.filter((p) => p.required && !p.seedable);
  const warnings = all.filter((p) => !p.required);

  // Order everything the run would touch, dependencies first.
  const involved = Object.keys(plannedCounts);
  await Promise.all(involved.map(loadFields));
  const graph = buildRelationGraph(relations, fieldsByCollection);
  const { order } = topoSortCollections(involved, graph);

  return {
    collection: target,
    count,
    satisfied: blocking.length === 0 && unresolvable.length === 0,
    blocking: sortForDisplay(blocking),
    warnings: sortForDisplay(warnings),
    unresolvable: sortForDisplay(unresolvable),
    suggestedOrder: order,
    suggestedCounts: plannedCounts,
  };
}

/** Shallowest first, then alphabetical — matches how the panel nests them. */
function sortForDisplay(items: Prerequisite[]): Prerequisite[] {
  return [...items].sort(
    (a, b) => a.depth - b.depth || a.collection.localeCompare(b.collection)
  );
}

/** Exposed for tests: the edge shape the walk treats as a hard requirement. */
export function isBlockingEdge(edge: RelationEdge, parentRowCount: number): boolean {
  return edge.required && edge.from !== edge.to && parentRowCount === 0;
}
