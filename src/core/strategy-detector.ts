import { assertSafePattern } from './rng.js';
import type {
  Bbox,
  FieldConstraints,
  GenerationStrategy,
  RelationDescriptor,
  WeightedChoice,
} from './types.js';

/**
 * A stored validation rule can be anything an admin typed. If we cannot safely
 * generate from it, fall through to the normal heuristics rather than suggest a
 * strategy that throws on every row.
 */
function isUsablePattern(pattern: string): boolean {
  try {
    assertSafePattern(pattern);
    return true;
  } catch {
    return false;
  }
}

const AUTO_MANAGED_SPECIALS = new Set([
  'uuid',
  'date-created',
  'date-updated',
  'user-created',
  'user-updated',
  'role-created',
  'role-updated',
]);

/** Specials that mean "no database column here" — presentation, groups, aliases. */
const NO_DATA_SPECIALS = new Set(['alias', 'no-data', 'group']);

const PRESENTATION_INTERFACES = new Set([
  'presentation-divider',
  'presentation-notice',
  'presentation-links',
  'group-raw',
  'group-detail',
  'group-accordion',
  'tab-group',
]);

export interface DetectOptions {
  /** Emit `coherent` strategies so related fields agree within a row. */
  coherentRows?: boolean;
  /** Give optional fields a realistic chance of being empty. */
  realisticNulls?: boolean;
}

export interface DetectContext {
  fieldName: string;
  type: string;
  interfaceName: string | null;
  options: any;
  specials: string[];
  relation: RelationDescriptor | null;
  nullable: boolean;
  required?: boolean;
  isPrimaryKey: boolean;
  isAlias?: boolean;
  collectionName?: string;
  constraints?: FieldConstraints;
  maxLength?: number | null;
  detectOptions?: DetectOptions;
}

export interface DetectResult {
  strategy: GenerationStrategy;
  reason: string;
}

export function hasAutoManagedSpecial(specials: string[]): boolean {
  return specials.some((s) => AUTO_MANAGED_SPECIALS.has(s));
}

/** True for fields that exist only in the admin UI and have no column to write. */
export function isAliasField(specials: string[], type: string, interfaceName: string | null): boolean {
  if (type === 'alias') return true;
  if (specials.some((s) => NO_DATA_SPECIALS.has(s))) return true;
  if (interfaceName && PRESENTATION_INTERFACES.has(interfaceName)) return true;
  return false;
}

/** Mapping used when row coherence is on: faker method → entity trait. */
export const FAKER_TO_TRAIT: Record<string, string> = {
  'person.firstName': 'person.firstName',
  'person.lastName': 'person.lastName',
  'person.fullName': 'person.fullName',
  'person.jobTitle': 'person.jobTitle',
  'person.bio': 'person.bio',
  'person.prefix': 'person.prefix',
  'person.sex': 'person.sex',
  'internet.email': 'contact.email',
  'internet.userName': 'contact.username',
  'internet.url': 'contact.website',
  'internet.domainName': 'contact.domain',
  'phone.number': 'contact.phone',
  'company.name': 'company.name',
  'company.catchPhrase': 'company.catchPhrase',
  'location.streetAddress': 'location.street',
  'location.city': 'location.city',
  'location.state': 'location.state',
  'location.country': 'location.country',
  'location.zipCode': 'location.zip',
  'location.latitude': 'location.latitude',
  'location.longitude': 'location.longitude',
  'location.timeZone': 'location.timezone',
  'commerce.productName': 'commerce.productName',
  'commerce.department': 'commerce.department',
  'commerce.productMaterial': 'commerce.material',
  'finance.currencyCode': 'commerce.currency',
  'image.avatar': 'person.avatar',
};

/** Status-ish values ranked by how often they occur in a real table. */
const STATUS_WEIGHTS: Array<[RegExp, number]> = [
  [/^(published|active|approved|completed|complete|paid|done|open|success|enabled|live|confirmed)$/i, 60],
  [/^(draft|pending|new|inbox|processing|in_progress|review|queued|todo|unverified|invited)$/i, 25],
  [/^(archived|inactive|closed|cancelled|canceled|rejected|failed|suspended|deleted|disabled|refunded|expired)$/i, 8],
];

function weightForChoice(value: unknown): number {
  const s = String(value ?? '');
  for (const [pattern, weight] of STATUS_WEIGHTS) {
    if (pattern.test(s)) return weight;
  }
  return 20;
}

function isStatusish(fieldName: string): boolean {
  return /(^|_)(status|state|stage|phase|visibility)(_|$)/.test(fieldName);
}

export function detectStrategy(ctx: DetectContext): GenerationStrategy {
  return detectField(ctx).strategy;
}

export function detectField(ctx: DetectContext): DetectResult {
  const {
    type,
    interfaceName,
    options,
    specials,
    relation,
    nullable,
    isPrimaryKey,
    fieldName,
    collectionName,
    constraints,
  } = ctx;
  const opts = ctx.detectOptions ?? {};

  if (isPrimaryKey || hasAutoManagedSpecial(specials)) {
    return { strategy: { kind: 'system' }, reason: 'Directus fills this automatically' };
  }

  // Relations are resolved before the alias check on purpose: Directus models
  // m2m, o2m and m2a fields as `type: 'alias'`, so an alias-first check would
  // skip every relational field and junction rows would never be written.
  // A relational alias still writes no column of its own — the generator skips
  // it during row building and handles it in the junction pass.

  if (relation && relation.relatedCollection === 'directus_files') {
    return withNulls(
      { kind: 'file_reuse', mimeFilter: 'image/' },
      ctx,
      'Points at directus_files — reuses an existing image',
      0.25
    );
  }

  if (relation && relation.type === 'm2m' && relation.junction) {
    return {
      strategy: { kind: 'm2m_random', min: 0, max: 4 },
      reason: `Many-to-many through ${relation.junction} — junction rows are written after the parent`,
    };
  }

  if (relation && (relation.type === 'o2m' || relation.type === 'm2a')) {
    return {
      strategy: { kind: 'skip', reason: relation.type },
      reason:
        relation.type === 'o2m'
          ? `One-to-many — seed ${relation.relatedCollection ?? 'the child collection'} instead and it fills in`
          : 'Many-to-any junctions are not generated automatically',
    };
  }

  if (relation && relation.type === 'self') {
    return withNulls(
      { kind: 'm2o_random', relatedCollection: relation.relatedCollection ?? collectionName ?? '' },
      ctx,
      'Self-referencing — links to a row that already exists',
      0.6
    );
  }

  if (relation && relation.type === 'm2o' && relation.relatedCollection) {
    return withNulls(
      { kind: 'm2o_random', relatedCollection: relation.relatedCollection },
      ctx,
      `Many-to-one — picks an existing ${relation.relatedCollection} row`,
      0.15
    );
  }

  // Presentation-only fields: dividers, notices, groups — nothing to write, and
  // no relation to resolve either.
  if (ctx.isAlias ?? isAliasField(specials, type, interfaceName)) {
    return {
      strategy: { kind: 'skip', reason: 'alias' },
      reason: 'Presentation/alias field — no database column to write',
    };
  }

  if (type === 'uuid') {
    return { strategy: { kind: 'uuid' }, reason: 'UUID column' };
  }

  if (type === 'hash' || specials.includes('hash')) {
    return {
      strategy: { kind: 'fixed', value: 'hashed-placeholder' },
      reason: 'Hashed on save by Directus',
    };
  }

  // Validation rules are hard limits, so they outrank name heuristics.
  if (constraints?.oneOf && constraints.oneOf.length > 0) {
    return {
      strategy: { kind: 'random_choice', choices: constraints.oneOf },
      reason: 'Restricted by a validation rule on this field',
    };
  }
  if (constraints?.regex && isUsablePattern(constraints.regex)) {
    return {
      strategy: { kind: 'regex', pattern: constraints.regex },
      reason: 'Matches the field validation pattern',
    };
  }

  const choiceValues = extractChoices(options);
  if (choiceValues.length > 0) {
    if (isStatusish(fieldName) || choiceValues.some((c) => weightForChoice(c) !== 20)) {
      const weighted: WeightedChoice[] = choiceValues.map((value) => ({
        value,
        weight: weightForChoice(value),
      }));
      return withNulls(
        { kind: 'weighted_choice', choices: weighted },
        ctx,
        'Dropdown choices, weighted so common states dominate',
        0
      );
    }
    return withNulls({ kind: 'random_choice', choices: choiceValues }, ctx, 'Picks from the configured choices', 0);
  }

  if (type.startsWith('geometry') || interfaceName === 'map') {
    const geometryType = options?.geometryType ?? type.replace(/^geometry\.?/, '') ?? 'Point';
    return withNulls(
      { kind: 'geometry', geometryType: geometryType || 'Point', bbox: bboxFromOptions(options) },
      ctx,
      `GeoJSON ${geometryType || 'Point'} inside a plausible bounding box`,
      0.1
    );
  }

  const lower = fieldName.toLowerCase();
  const byName = detectByName(lower, interfaceName, collectionName, ctx);
  if (byName) return finalize(byName, ctx, opts);

  const byInterface = detectByInterface(interfaceName, options, ctx);
  if (byInterface) return finalize(byInterface, ctx, opts);

  const byType = detectByType(type, ctx);
  if (byType) return finalize(byType, ctx, opts);

  if (nullable) return { strategy: { kind: 'null' }, reason: 'Nothing to infer — left empty' };
  return { strategy: { kind: 'fixed', value: 'placeholder' }, reason: 'Required with no detectable meaning' };
}

function finalize(result: DetectResult, ctx: DetectContext, opts: DetectOptions): DetectResult {
  let strategy = result.strategy;
  if (opts.coherentRows && strategy.kind === 'faker') {
    const trait = FAKER_TO_TRAIT[strategy.method];
    if (trait) {
      strategy = { kind: 'coherent', trait, nullRate: strategy.nullRate };
    }
  }
  return withNulls(strategy, ctx, result.reason);
}

/** Attach a realistic null rate to optional fields when the run asks for it. */
function withNulls(
  strategy: GenerationStrategy,
  ctx: DetectContext,
  reason: string,
  rate = 0.15
): DetectResult {
  const required = ctx.required ?? !ctx.nullable;
  if (!ctx.detectOptions?.realisticNulls || required || !ctx.nullable || rate <= 0) {
    return { strategy, reason };
  }
  return { strategy: { ...strategy, nullRate: rate }, reason: `${reason} · ~${Math.round(rate * 100)}% left empty` };
}

function extractChoices(options: any): unknown[] {
  if (!Array.isArray(options?.choices)) return [];
  return options.choices
    .map((c: any) => (c && typeof c === 'object' ? c.value : c))
    .filter((v: any) => v !== undefined && v !== null);
}

function bboxFromOptions(options: any): Bbox | undefined {
  const center = options?.defaultView?.center;
  if (center && typeof center.lng === 'number' && typeof center.lat === 'number') {
    const pad = 1.5;
    return [center.lng - pad, center.lat - pad, center.lng + pad, center.lat + pad];
  }
  return undefined;
}

/** Resolve ambiguous `name`/`title` fields by what the parent collection looks like. */
function resolveByCollection(collectionName: string | undefined, fallback: GenerationStrategy): GenerationStrategy {
  if (!collectionName) return fallback;
  const c = collectionName.toLowerCase();
  if (/(user|author|member|customer|person|employee|client|student|profile|account|contact|admin|staff|guest|subscriber)/.test(c)) {
    return { kind: 'faker', method: 'person.fullName' };
  }
  if (/(compan|organi[sz]ation|business|partner|vendor|supplier|brand|firm|agency|merchant)/.test(c)) {
    return { kind: 'faker', method: 'company.name' };
  }
  if (/(product|item|sku|catalog|inventory|merchandise)/.test(c)) {
    return { kind: 'faker', method: 'commerce.productName' };
  }
  if (/(book|article|post|story|chapter|page|movie|song|album|track|episode|video|lesson|course)/.test(c)) {
    return { kind: 'faker', method: 'lorem.sentence' };
  }
  return fallback;
}

function sliderRange(options: any): { min: number; max: number } | null {
  if (!options) return null;
  const min = options.minValue ?? options.min;
  const max = options.maxValue ?? options.max;
  if (typeof min !== 'number' || typeof max !== 'number') return null;
  return { min, max };
}

function numericRange(ctx: DetectContext, min: number, max: number): { min: number; max: number } {
  return {
    min: ctx.constraints?.min ?? min,
    max: ctx.constraints?.max ?? max,
  };
}

function detectByName(
  name: string,
  interfaceName: string | null,
  collectionName: string | undefined,
  ctx: DetectContext
): DetectResult | null {
  const has = (...keys: string[]) => keys.some((k) => name.includes(k));
  const eq = (...keys: string[]) => keys.some((k) => name === k);
  const r = (strategy: GenerationStrategy, reason: string): DetectResult => ({ strategy, reason });

  if (has('email')) return r({ kind: 'faker', method: 'internet.email' }, 'Field name looks like an email address');
  if (has('phone', 'mobile') || name === 'tel')
    return r({ kind: 'faker', method: 'phone.number' }, 'Field name looks like a phone number');
  if (has('first_name', 'firstname', 'given_name')) return r({ kind: 'faker', method: 'person.firstName' }, 'Given name');
  if (has('last_name', 'lastname', 'surname', 'family_name'))
    return r({ kind: 'faker', method: 'person.lastName' }, 'Family name');
  if (eq('full_name', 'fullname', 'display_name'))
    return r({ kind: 'faker', method: 'person.fullName' }, 'Full name');
  if (eq('name')) {
    return r(resolveByCollection(collectionName, { kind: 'faker', method: 'lorem.words' }), `Ambiguous "name" resolved from the collection "${collectionName ?? '?'}"`);
  }
  if (has('username', 'handle')) return r({ kind: 'faker', method: 'internet.userName' }, 'Account handle');
  if (has('password')) return r({ kind: 'faker', method: 'internet.password' }, 'Password field');
  if (has('avatar', 'photo', 'picture', 'thumbnail'))
    return r({ kind: 'faker', method: 'image.avatar' }, 'Image URL');
  if (has('url', 'website', 'homepage', 'link'))
    return r({ kind: 'faker', method: 'internet.url' }, 'Field name looks like a URL');
  if (has('domain')) return r({ kind: 'faker', method: 'internet.domainName' }, 'Domain name');
  if (has('slug')) return r({ kind: 'template', template: '{{content.title | slug}}-{{seq}}' }, 'Slug derived from the row title');
  if (has('headline')) return r({ kind: 'faker', method: 'lorem.sentence' }, 'Headline');
  if (has('description', 'summary', 'excerpt'))
    return r({ kind: 'faker', method: 'lorem.paragraph' }, 'Short prose field');
  if (has('body', 'content', 'article', 'text')) {
    if (interfaceName === 'input-rich-text-md') return r({ kind: 'markdown', paragraphs: 4 }, 'Markdown editor');
    if (interfaceName === 'input-rich-text-html') return r({ kind: 'html', paragraphs: 4 }, 'WYSIWYG editor');
    return r({ kind: 'lorem_paragraphs', count: 5 }, 'Long-form text field');
  }
  if (has('address', 'street')) return r({ kind: 'faker', method: 'location.streetAddress' }, 'Street address');
  if (has('city')) return r({ kind: 'faker', method: 'location.city' }, 'City');
  if (has('country')) return r({ kind: 'faker', method: 'location.country' }, 'Country');
  if (has('state', 'region', 'province')) return r({ kind: 'faker', method: 'location.state' }, 'Region');
  if (has('zip', 'postcode', 'postal_code')) return r({ kind: 'faker', method: 'location.zipCode' }, 'Postal code');
  if (has('timezone', 'time_zone')) return r({ kind: 'faker', method: 'location.timeZone' }, 'Time zone');
  if (has('latitude') || eq('lat')) return r({ kind: 'faker', method: 'location.latitude' }, 'Latitude');
  if (has('longitude') || eq('lng', 'lon')) return r({ kind: 'faker', method: 'location.longitude' }, 'Longitude');
  if (has('company', 'organization') || eq('org')) return r({ kind: 'faker', method: 'company.name' }, 'Company name');
  if (has('currency')) return r({ kind: 'faker', method: 'finance.currencyCode' }, 'Currency code');
  if (has('sku')) return r({ kind: 'template', template: '{{commerce.sku}}' }, 'Stock keeping unit');
  if (has('iban')) return r({ kind: 'faker', method: 'finance.iban' }, 'Bank account');
  if (has('price', 'amount', 'cost', 'total', 'subtotal', 'fee', 'salary')) {
    const { min, max } = numericRange(ctx, 1, 1000);
    return r({ kind: 'random_float', min, max, fractionDigits: 2 }, 'Monetary amount');
  }
  if (has('percent', 'discount', 'rate', 'ratio')) {
    const { min, max } = numericRange(ctx, 0, 100);
    return r({ kind: 'random_int', min, max }, 'Percentage');
  }
  if (has('quantity', 'qty', 'count', 'stock', 'views', 'likes')) {
    const { min, max } = numericRange(ctx, 0, 1000);
    return r({ kind: 'random_int', min, max }, 'Counter');
  }
  if (has('age')) {
    const { min, max } = numericRange(ctx, 18, 80);
    return r({ kind: 'random_int', min, max }, 'Age in years');
  }
  if (has('birthday', 'birthdate', 'date_of_birth', 'dob'))
    return r({ kind: 'coherent', trait: 'person.birthdate' }, 'Date of birth');
  if (has('bio', 'about', 'profile')) return r({ kind: 'faker', method: 'person.bio' }, 'Short biography');
  if (has('job', 'role', 'position')) return r({ kind: 'faker', method: 'person.jobTitle' }, 'Job title');
  if (has('title')) {
    return r(
      { kind: 'coherent', trait: 'content.title' },
      `Title resolved from the collection "${collectionName ?? '?'}"`
    );
  }
  if (has('color')) return r({ kind: 'faker', method: 'internet.color' }, 'Colour value');
  if (has('ip_address') || eq('ip')) return r({ kind: 'faker', method: 'internet.ip' }, 'IP address');
  if (has('user_agent')) return r({ kind: 'faker', method: 'internet.userAgent' }, 'User agent string');

  return null;
}

function detectByInterface(
  interfaceName: string | null,
  options: any,
  ctx: DetectContext
): DetectResult | null {
  if (!interfaceName) return null;
  const r = (strategy: GenerationStrategy, reason: string): DetectResult => ({ strategy, reason });

  if (interfaceName === 'input-rich-text-md') return r({ kind: 'markdown', paragraphs: 3 }, 'Markdown editor');
  if (interfaceName === 'input-rich-text-html') return r({ kind: 'html', paragraphs: 3 }, 'WYSIWYG editor');
  if (interfaceName === 'input-multiline') return r({ kind: 'faker', method: 'lorem.paragraph' }, 'Multiline input');
  if (interfaceName === 'tags') return r({ kind: 'coherent', trait: 'content.tags' }, 'Tag list');
  if (interfaceName === 'select-color') return r({ kind: 'faker', method: 'internet.color' }, 'Colour picker');
  if (interfaceName === 'datetime') return r({ kind: 'random_date', daysBack: 365, daysForward: 0, skew: 'recent' }, 'Datetime picker');
  if (interfaceName === 'date') return r({ kind: 'random_date', daysBack: 365, daysForward: 0, skew: 'recent' }, 'Date picker');
  if (interfaceName === 'time') return r({ kind: 'random_date', daysBack: 1, daysForward: 0 }, 'Time picker');
  if (interfaceName === 'boolean') return r({ kind: 'random_boolean', trueProbability: 0.5 }, 'Toggle');
  if (interfaceName === 'slider') {
    const range = sliderRange(options);
    const { min, max } = range ? numericRange(ctx, range.min, range.max) : numericRange(ctx, 0, 100);
    return r({ kind: 'random_int', min, max }, 'Slider range');
  }
  if (interfaceName === 'input-code') {
    return r({ kind: 'faker', method: 'lorem.lines' }, 'Code editor');
  }
  if (interfaceName === 'input-hash') return r({ kind: 'fixed', value: 'hashed-placeholder' }, 'Hashed input');
  return null;
}

function detectByType(type: string, ctx: DetectContext): DetectResult | null {
  const r = (strategy: GenerationStrategy, reason: string): DetectResult => ({ strategy, reason });
  const maxLen = ctx.maxLength ?? null;

  switch (type) {
    case 'string':
      return r({ kind: 'faker', method: 'lorem.words' }, maxLen ? `Text up to ${maxLen} characters` : 'Text field');
    case 'text':
      return r({ kind: 'faker', method: 'lorem.paragraph' }, 'Long text field');
    case 'integer': {
      const { min, max } = numericRange(ctx, 1, 10000);
      return r({ kind: 'random_int', min, max }, 'Integer column');
    }
    case 'bigInteger': {
      const { min, max } = numericRange(ctx, 1, 1_000_000);
      return r({ kind: 'random_int', min, max }, 'Big integer column');
    }
    case 'float':
    case 'decimal': {
      const { min, max } = numericRange(ctx, 0, 1000);
      const digits = typeof ctx.constraints?.max === 'number' ? 2 : 2;
      return r({ kind: 'random_float', min, max, fractionDigits: digits }, 'Decimal column');
    }
    case 'boolean':
      return r({ kind: 'random_boolean', trueProbability: 0.5 }, 'Boolean column');
    case 'dateTime':
    case 'timestamp':
      return r({ kind: 'random_date', daysBack: 365, daysForward: 0, skew: 'recent' }, 'Timestamp column');
    case 'date':
      return r({ kind: 'random_date', daysBack: 365, daysForward: 0, skew: 'recent' }, 'Date column');
    case 'time':
      return r({ kind: 'random_date', daysBack: 1, daysForward: 0 }, 'Time column');
    case 'json':
      return r({ kind: 'fixed', value: { key: 'value' } }, 'JSON column');
    case 'csv':
      return r({ kind: 'coherent', trait: 'content.tags' }, 'CSV column');
    default:
      if (type && type.startsWith('geometry')) {
        return r({ kind: 'geometry', geometryType: type.replace(/^geometry\.?/, '') || 'Point' }, 'Geometry column');
      }
      return null;
  }
}
