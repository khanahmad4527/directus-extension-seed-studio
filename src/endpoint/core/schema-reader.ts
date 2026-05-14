import type { CollectionDescriptor, FieldDescriptor, RelationDescriptor } from '../types.js';
import { detectStrategy, hasAutoManagedSpecial } from './strategy-detector.js';
import { lookupSystemFieldRule } from './system-field-rules.js';
import { extractIsUnique, extractMaxLength } from './validation.js';

export async function buildCollectionDescriptor(
  collectionName: string,
  services: any,
  schema: any,
  accountability: any
): Promise<CollectionDescriptor> {
  const collection = schema.collections?.[collectionName];
  if (!collection) {
    throw new Error(`Collection not found: ${collectionName}`);
  }

  const { ItemsService, FieldsService } = services;
  const relations: any[] = schema.relations ?? [];

  let rawFields: any[] = [];
  if (FieldsService) {
    const fieldsService = new FieldsService({ schema, accountability });
    rawFields = await fieldsService.readAll(collectionName);
  } else {
    // Fallback for tests / non-Directus contexts: synthesize from schema.fields shape used in v0
    const flat = (collection.fields ?? schema.fields?.[collectionName]) ?? {};
    rawFields = Object.values(flat);
  }

  const primaryKeyField =
    collection.primary ??
    rawFields.find((f) => f?.schema?.is_primary_key)?.field ??
    'id';

  const fieldDescriptors: FieldDescriptor[] = [];

  for (const raw of rawFields) {
    const name: string = raw?.field;
    if (!name) continue;

    const relation = resolveRelation(collectionName, name, relations);
    const interfaceName = raw?.meta?.interface ?? null;
    const specials: string[] = Array.isArray(raw?.meta?.special)
      ? raw.meta.special
      : Array.isArray(raw?.special)
      ? raw.special
      : [];
    const metaRequired = Boolean(raw?.meta?.required);
    const dbNullable = raw?.schema?.is_nullable !== false;
    const required = metaRequired || !dbNullable;
    const nullable = !required && dbNullable;
    const readonly = Boolean(raw?.meta?.readonly);
    const isPK = raw?.schema?.is_primary_key === true || name === primaryKeyField;
    const sysField = isPK || hasAutoManagedSpecial(specials);
    const type: string = raw?.type ?? 'string';
    const options = raw?.meta?.options ?? null;
    const validation = raw?.meta?.validation ?? null;
    const defaultValue = raw?.schema?.default_value ?? null;
    const maxLength = extractMaxLength(raw);
    const isUnique = extractIsUnique(raw);

    const systemRule = lookupSystemFieldRule(collectionName, name);
    const heuristic = detectStrategy({
      fieldName: name,
      type,
      interfaceName,
      options,
      specials,
      relation,
      nullable,
      isPrimaryKey: isPK,
      collectionName,
    });
    // System rules win — but PK/auto-managed always stays as 'system'
    const suggested =
      heuristic.kind === 'system' ? heuristic : (systemRule ?? heuristic);

    fieldDescriptors.push({
      field: name,
      type,
      interface: interfaceName,
      required,
      nullable,
      readonly,
      isPrimaryKey: isPK,
      isSystemField: sysField,
      relation,
      options,
      special: specials,
      validation,
      defaultValue,
      suggestedStrategy: suggested,
      maxLength,
      isUnique,
    });
  }

  let rowCount = 0;
  try {
    const itemsService = new ItemsService(collectionName, { schema, accountability });
    const result = await itemsService.readByQuery({ aggregate: { count: '*' } });
    const first = Array.isArray(result) ? result[0] : result;
    const c = first?.count;
    rowCount = typeof c === 'string' ? parseInt(c, 10) : Number(c ?? 0);
    if (Number.isNaN(rowCount)) rowCount = 0;
  } catch {
    rowCount = 0;
  }

  const displayName = resolveDisplayName(collectionName, collection);

  return {
    collection: collectionName,
    displayName,
    primaryKeyField,
    rowCount,
    fields: fieldDescriptors,
  };
}

function resolveDisplayName(collectionName: string, collection: any): string {
  // Prefer explicit meta.name when set
  const metaName = collection?.meta?.name;
  if (metaName && typeof metaName === 'string') return metaName;

  // Try translations array (Directus admin format)
  const translations = collection?.meta?.translations;
  if (Array.isArray(translations) && translations.length) {
    const en = translations.find((t: any) => t?.language?.startsWith('en'));
    const pick = en ?? translations[0];
    const t = pick?.translation ?? pick?.plural ?? pick?.singular;
    if (t && typeof t === 'string') return t;
  }

  // Humanize the raw key. `directus_activity` -> `Activity` ; `blog_posts` -> `Blog Posts`
  const slug = collectionName.startsWith('directus_')
    ? collectionName.slice('directus_'.length)
    : collectionName;
  return slug
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function resolveRelation(
  collectionName: string,
  fieldName: string,
  relations: any[]
): RelationDescriptor | null {
  const m2o = relations.find(
    (r) => r.collection === collectionName && r.field === fieldName
  );
  if (m2o) {
    const related: string | null = m2o.related_collection ?? null;
    const allowed: string[] | undefined = m2o.meta?.one_allowed_collections;
    if (Array.isArray(allowed) && allowed.length > 0) {
      return { type: 'm2a', relatedCollection: null, relatedCollections: allowed };
    }
    if (related === collectionName) {
      return { type: 'self', relatedCollection: related };
    }
    return { type: 'm2o', relatedCollection: related };
  }

  const o2m = relations.find(
    (r) => r.related_collection === collectionName && r.meta?.one_field === fieldName
  );
  if (o2m) {
    const junctionRel = o2m.meta?.junction_field
      ? relations.find(
          (r) => r.collection === o2m.collection && r.field === o2m.meta.junction_field
        )
      : null;
    if (junctionRel) {
      return {
        type: 'm2m',
        relatedCollection: junctionRel.related_collection ?? null,
        junction: o2m.collection,
      };
    }
    return { type: 'o2m', relatedCollection: o2m.collection };
  }

  return null;
}
