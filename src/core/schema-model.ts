import type { RawCollection, RawField, RawRelation, SeedDataSource } from './data-source.js';
import { resolveRelation } from './relation-graph.js';
import {
  detectField,
  hasAutoManagedSpecial,
  isAliasField,
  type DetectOptions,
} from './strategy-detector.js';
import { lookupSystemFieldRule } from './system-field-rules.js';
import type {
  CollectionDescriptor,
  FieldCondition,
  FieldDescriptor,
  GenerationStrategy,
} from './types.js';
import { buildConstraints, extractIsUnique, extractMaxLength } from './validation.js';

export interface BuildDescriptorOptions {
  detect?: DetectOptions;
  /** Skip the row count query when the caller already knows it. */
  rowCount?: number;
  relations?: RawRelation[];
  collection?: RawCollection | null;
  fields?: RawField[];
}

/**
 * Turn Directus metadata into the descriptor the generator works from.
 *
 * Everything the UI shows about a field — its strategy, why that strategy was
 * chosen, its constraints, whether it is writable at all — is decided here.
 */
export async function buildCollectionDescriptor(
  ds: SeedDataSource,
  collectionName: string,
  options: BuildDescriptorOptions = {}
): Promise<CollectionDescriptor> {
  const collection = options.collection ?? (await ds.getCollection(collectionName));
  if (!collection) {
    throw new Error(`Collection not found: ${collectionName}`);
  }

  const [rawFields, relations] = await Promise.all([
    options.fields ? Promise.resolve(options.fields) : ds.getFields(collectionName),
    options.relations ? Promise.resolve(options.relations) : ds.getRelations(),
  ]);

  const primaryKeyField =
    collection.primary ?? rawFields.find((f) => f?.schema?.is_primary_key)?.field ?? 'id';
  const primaryKeyRaw = rawFields.find((f) => f.field === primaryKeyField);
  const primaryKeyType = primaryKeyRaw?.type ?? 'integer';
  const primaryKeyGenerated =
    primaryKeyRaw?.schema?.has_auto_increment !== true &&
    (primaryKeyType === 'uuid' || primaryKeyType === 'string');

  const fields: FieldDescriptor[] = [];

  for (const raw of rawFields) {
    const name = raw?.field;
    if (!name) continue;

    const relation = resolveRelation(collectionName, name, relations);
    const interfaceName = raw?.meta?.interface ?? null;
    const specials: string[] = Array.isArray(raw?.meta?.special)
      ? raw.meta.special
      : Array.isArray((raw as any)?.special)
      ? (raw as any).special
      : [];

    const alias = isAliasField(specials, raw.type, interfaceName);
    const metaRequired = Boolean(raw?.meta?.required);
    const dbNullable = raw?.schema?.is_nullable !== false;
    const required = !alias && (metaRequired || !dbNullable);
    const nullable = !required && dbNullable;
    const readonly = Boolean(raw?.meta?.readonly);
    const isPK = raw?.schema?.is_primary_key === true || name === primaryKeyField;
    const isSystem = isPK || hasAutoManagedSpecial(specials);
    const constraints = buildConstraints(raw);
    const maxLength = extractMaxLength(raw);
    const conditions: FieldCondition[] | undefined = Array.isArray(raw?.meta?.conditions)
      ? raw.meta.conditions
      : undefined;

    const detected = detectField({
      fieldName: name,
      type: raw?.type ?? 'string',
      interfaceName,
      options: raw?.meta?.options ?? null,
      specials,
      relation,
      nullable,
      required,
      isPrimaryKey: isPK,
      isAlias: alias,
      collectionName,
      constraints,
      maxLength,
      detectOptions: options.detect,
    });

    // Curated system-collection rules beat heuristics, but never override
    // "Directus fills this itself".
    const systemRule = lookupSystemFieldRule(collectionName, name);
    let suggested: GenerationStrategy = detected.strategy;
    let reason = detected.reason;
    if (systemRule && detected.strategy.kind !== 'system' && detected.strategy.kind !== 'skip') {
      suggested = systemRule;
      reason = 'Known Directus system field';
    }

    fields.push({
      field: name,
      type: raw?.type ?? 'string',
      interface: interfaceName,
      required,
      nullable,
      readonly,
      isPrimaryKey: isPK,
      isSystemField: isSystem,
      isAlias: alias,
      relation,
      options: raw?.meta?.options ?? null,
      special: specials,
      validation: raw?.meta?.validation ?? null,
      conditions,
      defaultValue: raw?.schema?.default_value ?? null,
      suggestedStrategy: suggested,
      maxLength,
      isUnique: extractIsUnique(raw),
      constraints,
      reason,
      numericPrecision: raw?.schema?.numeric_precision ?? null,
      numericScale: raw?.schema?.numeric_scale ?? null,
    });
  }

  applyCollectionMetaStrategies(collection, fields);

  let rowCount = options.rowCount;
  if (rowCount === undefined) {
    try {
      rowCount = await ds.count(collectionName);
    } catch {
      rowCount = 0;
    }
  }

  return {
    collection: collectionName,
    displayName: resolveDisplayName(collectionName, collection),
    primaryKeyField,
    primaryKeyType,
    primaryKeyGenerated,
    singleton: collection.singleton === true || collection.meta?.singleton === true,
    rowCount: rowCount ?? 0,
    sortField: collection.meta?.sort_field ?? null,
    archiveField: collection.meta?.archive_field ?? null,
    archiveValue: collection.meta?.archive_value ?? null,
    unarchiveValue: collection.meta?.unarchive_value ?? null,
    // A stored null means "track nothing"; only a missing key means "default".
    accountability:
      collection.meta?.accountability === undefined ? 'all' : collection.meta.accountability,
    versioning: Boolean(collection.meta?.versioning),
    fields,
  };
}

/**
 * `directus_collections.meta` carries two facts the field metadata does not:
 * which column orders the collection, and which column archives it. Both need
 * specific values to make the admin UI behave — an incrementing sort, and a
 * mostly-unarchived split.
 */
function applyCollectionMetaStrategies(collection: RawCollection, fields: FieldDescriptor[]): void {
  const sortField = collection.meta?.sort_field;
  if (sortField) {
    const field = fields.find((f) => f.field === sortField);
    if (field && !field.isSystemField) {
      field.suggestedStrategy = { kind: 'sequence', pattern: '{0}', startFrom: 1 };
      field.reason = 'Sort column for this collection — incrementing so drag-and-drop works';
    }
  }

  const archiveField = collection.meta?.archive_field;
  const archiveValue = collection.meta?.archive_value;
  const unarchiveValue = collection.meta?.unarchive_value;
  if (archiveField && (archiveValue !== undefined || unarchiveValue !== undefined)) {
    const field = fields.find((f) => f.field === archiveField);
    if (field && !field.isSystemField) {
      const existing =
        field.suggestedStrategy.kind === 'weighted_choice'
          ? field.suggestedStrategy.choices.filter(
              (c) => String(c.value) !== String(archiveValue)
            )
          : [];
      const choices = [
        ...(existing.length > 0
          ? existing
          : [{ value: unarchiveValue ?? null, weight: 90 }]),
        { value: archiveValue ?? null, weight: 8 },
      ];
      field.suggestedStrategy = { kind: 'weighted_choice', choices };
      field.reason = 'Archive column — most rows stay visible, a few are archived';
    }
  }
}

export function resolveDisplayName(collectionName: string, collection: RawCollection | null): string {
  const metaName = collection?.meta?.name;
  if (metaName && typeof metaName === 'string') return metaName;

  const translations = collection?.meta?.translations;
  if (Array.isArray(translations) && translations.length) {
    const en = translations.find((t: any) => t?.language?.startsWith('en'));
    const pick = en ?? translations[0];
    const t = pick?.translation ?? pick?.plural ?? pick?.singular;
    if (t && typeof t === 'string') return t;
  }

  const slug = collectionName.startsWith('directus_')
    ? collectionName.slice('directus_'.length)
    : collectionName;
  return slug
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
