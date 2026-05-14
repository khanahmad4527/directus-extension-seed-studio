import type { GenerationStrategy, RelationDescriptor } from '../types.js';

const AUTO_MANAGED_SPECIALS = new Set([
  'uuid',
  'date-created',
  'date-updated',
  'user-created',
  'user-updated',
  'role-created',
  'role-updated',
]);

interface DetectContext {
  relation: RelationDescriptor | null;
  specials: string[];
  options: any;
  nullable: boolean;
  type: string;
  interfaceName: string | null;
  fieldName: string;
  isPrimaryKey: boolean;
  collectionName?: string;
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

export function hasAutoManagedSpecial(specials: string[]): boolean {
  return specials.some((s) => AUTO_MANAGED_SPECIALS.has(s));
}

export function detectStrategy(ctx: DetectContext): GenerationStrategy {
  const { type, interfaceName, options, specials, relation, nullable, isPrimaryKey, fieldName, collectionName } = ctx;

  if (isPrimaryKey || hasAutoManagedSpecial(specials)) {
    return { kind: 'system' };
  }

  if (relation && relation.relatedCollection === 'directus_files') {
    return { kind: 'file_reuse', mimeFilter: 'image/' };
  }

  if (relation && relation.type === 'm2o' && relation.relatedCollection) {
    return { kind: 'm2o_random', relatedCollection: relation.relatedCollection };
  }

  if (type === 'uuid') {
    return { kind: 'uuid' };
  }

  if (type === 'hash' || specials.includes('hash')) {
    return { kind: 'fixed', value: 'hashed-placeholder' };
  }

  if (Array.isArray(options?.choices) && options.choices.length > 0) {
    const choices = options.choices
      .map((c: any) => (c && typeof c === 'object' ? c.value : c))
      .filter((v: any) => v !== undefined && v !== null);
    if (choices.length > 0) return { kind: 'random_choice', choices };
  }

  const lower = fieldName.toLowerCase();
  const nameStrategy = detectByName(lower, interfaceName, collectionName);
  if (nameStrategy) return nameStrategy;

  const interfaceStrategy = detectByInterface(interfaceName, options);
  if (interfaceStrategy) return interfaceStrategy;

  const typeStrategy = detectByType(type);
  if (typeStrategy) return typeStrategy;

  if (nullable) return { kind: 'null' };
  return { kind: 'fixed', value: 'placeholder' };
}

function detectByName(name: string, interfaceName: string | null, collectionName?: string): GenerationStrategy | null {
  const has = (...keys: string[]) => keys.some((k) => name.includes(k));
  const eq = (...keys: string[]) => keys.some((k) => name === k);

  if (has('email')) return { kind: 'faker', method: 'internet.email' };
  if (has('phone', 'mobile') || name === 'tel') return { kind: 'faker', method: 'phone.number' };
  if (has('first_name', 'firstname', 'given_name')) return { kind: 'faker', method: 'person.firstName' };
  if (has('last_name', 'lastname', 'surname', 'family_name')) return { kind: 'faker', method: 'person.lastName' };
  if (eq('full_name', 'fullname')) return { kind: 'faker', method: 'person.fullName' };
  if (eq('name')) {
    return resolveByCollection(collectionName, { kind: 'faker', method: 'lorem.words' });
  }
  if (has('username', 'handle')) return { kind: 'faker', method: 'internet.userName' };
  if (has('password')) return { kind: 'faker', method: 'internet.password' };
  if (has('url', 'website', 'homepage')) return { kind: 'faker', method: 'internet.url' };
  if (has('domain')) return { kind: 'faker', method: 'internet.domainName' };
  if (has('slug')) return { kind: 'faker', method: 'lorem.slug' };
  if (has('headline')) return { kind: 'faker', method: 'lorem.sentence' };
  if (has('description', 'summary', 'excerpt')) return { kind: 'faker', method: 'lorem.paragraph' };
  if (has('body', 'content', 'article')) {
    if (interfaceName === 'input-rich-text-md' || interfaceName === 'input-rich-text-html') {
      return { kind: 'lorem_paragraphs', count: 5 };
    }
    return { kind: 'lorem_paragraphs', count: 5 };
  }
  if (has('address', 'street')) return { kind: 'faker', method: 'location.streetAddress' };
  if (has('city')) return { kind: 'faker', method: 'location.city' };
  if (has('country')) return { kind: 'faker', method: 'location.country' };
  if (has('state', 'region', 'province')) return { kind: 'faker', method: 'location.state' };
  if (has('zip', 'postcode', 'postal_code')) return { kind: 'faker', method: 'location.zipCode' };
  if (has('latitude') || eq('lat')) return { kind: 'faker', method: 'location.latitude' };
  if (has('longitude') || eq('lng', 'lon')) return { kind: 'faker', method: 'location.longitude' };
  if (has('company', 'organization') || eq('org')) return { kind: 'faker', method: 'company.name' };
  if (has('price', 'amount', 'cost', 'total')) {
    return { kind: 'random_float', min: 1, max: 1000, fractionDigits: 2 };
  }
  if (has('quantity', 'qty', 'count', 'stock')) return { kind: 'random_int', min: 0, max: 1000 };
  if (has('age')) return { kind: 'random_int', min: 18, max: 80 };
  if (has('bio', 'about', 'profile')) return { kind: 'faker', method: 'person.bio' };
  if (has('job', 'role', 'position')) return { kind: 'faker', method: 'person.jobTitle' };
  if (has('title')) return { kind: 'faker', method: 'lorem.sentence' };

  return null;
}

function detectByInterface(interfaceName: string | null, options?: any): GenerationStrategy | null {
  if (!interfaceName) return null;
  if (interfaceName === 'input-rich-text-md' || interfaceName === 'input-rich-text-html') {
    return { kind: 'lorem_paragraphs', count: 3 };
  }
  if (interfaceName === 'input-multiline') return { kind: 'faker', method: 'lorem.paragraph' };
  if (interfaceName === 'tags') return { kind: 'faker', method: 'lorem.words' };
  if (interfaceName === 'select-color') return { kind: 'faker', method: 'internet.color' };
  if (interfaceName === 'datetime') return { kind: 'random_date', daysBack: 365, daysForward: 0 };
  if (interfaceName === 'date') return { kind: 'random_date', daysBack: 365, daysForward: 0 };
  if (interfaceName === 'time') return { kind: 'random_date', daysBack: 1, daysForward: 0 };
  if (interfaceName === 'boolean') return { kind: 'random_boolean', trueProbability: 0.5 };
  if (interfaceName === 'slider') {
    const r = sliderRange(options);
    return r ? { kind: 'random_int', min: r.min, max: r.max } : { kind: 'random_int', min: 0, max: 100 };
  }
  if (interfaceName === 'code') return { kind: 'faker', method: 'lorem.lines' };
  return null;
}

function detectByType(type: string): GenerationStrategy | null {
  switch (type) {
    case 'string':
      return { kind: 'faker', method: 'lorem.words' };
    case 'text':
      return { kind: 'faker', method: 'lorem.paragraph' };
    case 'integer':
      return { kind: 'random_int', min: 1, max: 10000 };
    case 'bigInteger':
      return { kind: 'random_int', min: 1, max: 1000000 };
    case 'float':
    case 'decimal':
      return { kind: 'random_float', min: 0, max: 1000, fractionDigits: 2 };
    case 'boolean':
      return { kind: 'random_boolean', trueProbability: 0.5 };
    case 'dateTime':
    case 'timestamp':
      return { kind: 'random_date', daysBack: 365, daysForward: 0 };
    case 'date':
      return { kind: 'random_date', daysBack: 365, daysForward: 0 };
    case 'time':
      return { kind: 'random_date', daysBack: 1, daysForward: 0 };
    case 'json':
      return { kind: 'fixed', value: { key: 'value' } };
    case 'csv':
      return { kind: 'faker', method: 'lorem.words' };
    default:
      if (type && type.startsWith('geometry')) {
        return { kind: 'fixed', value: { type: 'Point', coordinates: [0, 0] } };
      }
      return null;
  }
}
