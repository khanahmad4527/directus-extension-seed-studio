import type { RawCollection, RawField, RawRelation } from './data-source.js';
import type { RelationDescriptor } from './types.js';

/**
 * Relation awareness.
 *
 * Seeding one collection at a time fails the moment a required many-to-one has
 * nothing to point at. The graph below turns `directus_relations` into a
 * dependency DAG so a whole project can be seeded in an order that always has
 * parents in place, and so cycles are reported instead of exploding mid-run.
 */

export interface RelationEdge {
  /** The collection holding the foreign key. */
  from: string;
  /** The collection being pointed at. */
  to: string;
  field: string;
  required: boolean;
  /** Self-references and nullable FKs can be filled in a later pass. */
  breakable: boolean;
}

export interface RelationGraph {
  edges: RelationEdge[];
  dependenciesOf(collection: string): RelationEdge[];
  dependentsOf(collection: string): RelationEdge[];
}

export function buildRelationGraph(
  relations: RawRelation[],
  fieldsByCollection: Map<string, RawField[]>
): RelationGraph {
  const edges: RelationEdge[] = [];

  for (const relation of relations) {
    if (!relation.related_collection) continue;
    const from = relation.collection;
    const to = relation.related_collection;
    const raw = fieldsByCollection.get(from)?.find((f) => f.field === relation.field);
    const required = Boolean(raw?.meta?.required) || raw?.schema?.is_nullable === false;
    edges.push({
      from,
      to,
      field: relation.field,
      required,
      breakable: !required || from === to,
    });
  }

  return {
    edges,
    dependenciesOf(collection: string) {
      return edges.filter((e) => e.from === collection && e.to !== collection);
    },
    dependentsOf(collection: string) {
      return edges.filter((e) => e.to === collection && e.from !== collection);
    },
  };
}

export interface TopoResult {
  /** Seed in this order: dependencies first. */
  order: string[];
  /** Cycles that had to be broken, with the nullable edge we deferred. */
  cycles: Array<{ collections: string[]; brokenAt: RelationEdge | null }>;
}

/**
 * Kahn's algorithm with cycle breaking.
 *
 * Real Directus schemas contain cycles (`users.manager → users`,
 * `posts.featured_comment ⇄ comments.post`). Rather than refusing, we drop the
 * weakest edge — a nullable or self-referencing FK — and report it: the field
 * can be filled in a second pass once both sides exist.
 */
export function topoSortCollections(collections: string[], graph: RelationGraph): TopoResult {
  const inScope = new Set(collections);
  const cycles: TopoResult['cycles'] = [];

  const deps = new Map<string, Set<string>>();
  for (const name of collections) deps.set(name, new Set());
  for (const edge of graph.edges) {
    if (!inScope.has(edge.from) || !inScope.has(edge.to)) continue;
    if (edge.from === edge.to) continue;
    deps.get(edge.from)!.add(edge.to);
  }

  const order: string[] = [];
  const remaining = new Set(collections);

  while (remaining.size > 0) {
    const ready = [...remaining].filter((name) =>
      [...deps.get(name)!].every((dep) => !remaining.has(dep))
    );

    if (ready.length > 0) {
      ready.sort();
      for (const name of ready) {
        order.push(name);
        remaining.delete(name);
      }
      continue;
    }

    // Everything left is in a cycle: break the weakest edge inside it.
    const stuck = [...remaining].sort();
    const breakable = graph.edges.find(
      (e) => remaining.has(e.from) && remaining.has(e.to) && e.breakable && e.from !== e.to
    );
    if (breakable) {
      deps.get(breakable.from)!.delete(breakable.to);
      cycles.push({ collections: stuck, brokenAt: breakable });
      continue;
    }

    // No nullable edge to cut — emit deterministically and report it.
    cycles.push({ collections: stuck, brokenAt: null });
    for (const name of stuck) {
      order.push(name);
      remaining.delete(name);
    }
  }

  return { order, cycles };
}

/**
 * Suggest row counts from the shape of the graph rather than asking the user to
 * guess: a collection that others point at gets fewer rows than its children.
 */
export function suggestCounts(
  collections: string[],
  graph: RelationGraph,
  base = 200
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of collections) {
    const parents = graph.dependenciesOf(name).filter((e) => collections.includes(e.to)).length;
    const children = graph.dependentsOf(name).filter((e) => collections.includes(e.from)).length;
    // Referenced-by-many ⇒ a lookup table; references-many ⇒ a leaf/fact table.
    const factor = Math.pow(2.5, parents) / Math.pow(3, children);
    const value = Math.round((base * factor) / 5) * 5;
    out[name] = Math.min(5000, Math.max(5, value));
  }
  return out;
}

/**
 * Resolve one field to a relation descriptor.
 *
 * Directus expresses m2m as two rows in `directus_relations` joined through a
 * junction collection; we capture both junction column names so junction rows
 * can actually be written.
 */
export function resolveRelation(
  collectionName: string,
  fieldName: string,
  relations: RawRelation[]
): RelationDescriptor | null {
  const owned = relations.find((r) => r.collection === collectionName && r.field === fieldName);
  if (owned) {
    const related = owned.related_collection ?? null;
    const allowed: string[] | undefined = owned.meta?.one_allowed_collections;
    if (Array.isArray(allowed) && allowed.length > 0) {
      return { type: 'm2a', relatedCollection: null, relatedCollections: allowed };
    }
    if (related === collectionName) {
      return { type: 'self', relatedCollection: related };
    }
    return { type: 'm2o', relatedCollection: related };
  }

  const alias = relations.find(
    (r) => r.related_collection === collectionName && r.meta?.one_field === fieldName
  );
  if (alias) {
    const junctionField: string | undefined = alias.meta?.junction_field;
    const junctionRel = junctionField
      ? relations.find((r) => r.collection === alias.collection && r.field === junctionField)
      : null;

    if (junctionRel) {
      const allowed: string[] | undefined = junctionRel.meta?.one_allowed_collections;
      if (Array.isArray(allowed) && allowed.length > 0) {
        return {
          type: 'm2a',
          relatedCollection: null,
          relatedCollections: allowed,
          junction: alias.collection,
          junctionParentField: alias.field,
          junctionRelatedField: junctionField,
        };
      }
      return {
        type: 'm2m',
        relatedCollection: junctionRel.related_collection ?? null,
        junction: alias.collection,
        junctionParentField: alias.field,
        junctionRelatedField: junctionField,
      };
    }

    return { type: 'o2m', relatedCollection: alias.collection, childField: alias.field };
  }

  return null;
}
