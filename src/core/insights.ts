import type { RawField, SeedDataSource } from './data-source.js';
import { buildRelationGraph } from './relation-graph.js';
import type { CollectionInsights, FlowInfo } from './types.js';

/**
 * Platform awareness — the checks a careful Directus admin would run by hand
 * before generating 50,000 rows:
 *
 * - Is a flow going to fire once per row? ("Send welcome email" × 50,000)
 * - Does this collection write a revision per row? (`accountability: all`)
 * - Which collections must have rows first, and which will end up with orphans?
 * - Does this instance look like production?
 */

const ITEM_CREATE_ACTIONS = ['items.create', 'create'];

export async function collectionInsights(
  ds: SeedDataSource,
  collection: string
): Promise<CollectionInsights> {
  const [meta, relations, rowCount] = await Promise.all([
    ds.getCollection(collection),
    ds.getRelations(),
    ds.count(collection).catch(() => 0),
  ]);

  const involved = new Set<string>([collection]);
  for (const relation of relations) {
    if (relation.collection === collection && relation.related_collection) {
      involved.add(relation.related_collection);
    }
    if (relation.related_collection === collection) involved.add(relation.collection);
  }

  const fieldsByCollection = new Map<string, RawField[]>();
  await Promise.all(
    [...involved].map(async (name) => {
      try {
        fieldsByCollection.set(name, await ds.getFields(name));
      } catch {
        fieldsByCollection.set(name, []);
      }
    })
  );

  const graph = buildRelationGraph(relations, fieldsByCollection);

  const dependencies = await Promise.all(
    graph.dependenciesOf(collection).map(async (edge) => ({
      collection: edge.to,
      field: edge.field,
      required: edge.required,
      rowCount: await ds.count(edge.to).catch(() => 0),
    }))
  );

  const dependents = graph.dependentsOf(collection).map((edge) => ({
    collection: edge.from,
    field: edge.field,
    required: edge.required,
  }));

  let flows: FlowInfo[] = [];
  if (ds.listFlows) {
    try {
      const all = await ds.listFlows();
      flows = all.filter((flow) => flowTargets(flow, collection));
    } catch {
      flows = [];
    }
  }

  let isProduction = false;
  let publicUrl: string | null = null;
  if (ds.environment) {
    try {
      const env = await ds.environment();
      isProduction = env.isProduction;
      publicUrl = env.publicUrl;
    } catch {
      isProduction = false;
    }
  }

  // `accountability: null` is meaningful in Directus — it means "track nothing".
  // Only a missing key falls back to the default.
  const rawAccountability = meta?.meta?.accountability;
  const accountability = rawAccountability === undefined ? 'all' : rawAccountability;

  return {
    collection,
    rowCount,
    flows,
    dependents,
    dependencies,
    accountability,
    // `all` records activity + a revision per row; `activity` records activity only.
    writesRevisions: accountability === 'all',
    isProduction,
    publicUrl,
  };
}

function flowTargets(flow: FlowInfo, collection: string): boolean {
  if (flow.status !== 'active') return false;
  if (flow.trigger !== 'event') return false;
  if (flow.collections.length > 0 && !flow.collections.includes(collection)) return false;
  if (flow.actions.length === 0) return true;
  return flow.actions.some((action) =>
    ITEM_CREATE_ACTIONS.some((wanted) => action === wanted || action.endsWith('.create'))
  );
}

/** Human-readable warnings for the UI, ordered by how much they matter. */
export function insightWarnings(insights: CollectionInsights, plannedRows: number): string[] {
  const warnings: string[] = [];

  if (insights.isProduction) {
    warnings.push(
      `This instance looks like production${insights.publicUrl ? ` (${insights.publicUrl})` : ''}. Generated rows are indistinguishable from real content once written.`
    );
  }

  for (const flow of insights.flows) {
    warnings.push(
      `Flow "${flow.name}" runs on item create in this collection — it would fire ${plannedRows.toLocaleString()} times. Use fast write to suppress it.`
    );
  }

  if (insights.writesRevisions && plannedRows >= 1000) {
    warnings.push(
      `Accountability is "all", so this run also writes ~${plannedRows.toLocaleString()} activity and ${plannedRows.toLocaleString()} revision rows. Fast write skips both.`
    );
  }

  if (insights.collection === 'directus_files') {
    warnings.push(
      'Generated directus_files rows describe files that do not exist in storage, so thumbnails and downloads will 404. Upload real files instead unless you only need the metadata.'
    );
  }

  if (insights.collection === 'directus_users') {
    warnings.push(
      'Generated users can sign in with the placeholder password and count toward user limits. Suspend or delete them when you are done.'
    );
  }

  for (const dependency of insights.dependencies) {
    if (dependency.required && dependency.rowCount === 0) {
      warnings.push(
        `${dependency.field} is required and points at ${dependency.collection}, which has no rows. Seed ${dependency.collection} first.`
      );
    }
  }

  return warnings;
}
