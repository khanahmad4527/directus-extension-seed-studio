import type { FakerMethodEntry } from './types.js';
import type { FakerLike } from './rng.js';

/** Curated list shown in the strategy dropdown. Any valid faker path is accepted. */
export const FAKER_METHODS: FakerMethodEntry[] = [
  { label: 'First name', path: 'person.firstName' },
  { label: 'Last name', path: 'person.lastName' },
  { label: 'Full name', path: 'person.fullName' },
  { label: 'Job title', path: 'person.jobTitle' },
  { label: 'Bio', path: 'person.bio' },
  { label: 'Sex', path: 'person.sex' },
  { label: 'Prefix', path: 'person.prefix' },

  { label: 'Email', path: 'internet.email' },
  { label: 'Username', path: 'internet.userName' },
  { label: 'Password', path: 'internet.password' },
  { label: 'URL', path: 'internet.url' },
  { label: 'Domain name', path: 'internet.domainName' },
  { label: 'IP address', path: 'internet.ip' },
  { label: 'IPv6', path: 'internet.ipv6' },
  { label: 'MAC address', path: 'internet.mac' },
  { label: 'User agent', path: 'internet.userAgent' },
  { label: 'HTTP method', path: 'internet.httpMethod' },
  { label: 'Color (hex)', path: 'internet.color' },
  { label: 'Emoji', path: 'internet.emoji' },

  { label: 'Phone number', path: 'phone.number' },
  { label: 'IMEI', path: 'phone.imei' },

  { label: 'Street address', path: 'location.streetAddress' },
  { label: 'Secondary address', path: 'location.secondaryAddress' },
  { label: 'City', path: 'location.city' },
  { label: 'State', path: 'location.state' },
  { label: 'Country', path: 'location.country' },
  { label: 'Country code', path: 'location.countryCode' },
  { label: 'ZIP code', path: 'location.zipCode' },
  { label: 'Latitude', path: 'location.latitude' },
  { label: 'Longitude', path: 'location.longitude' },
  { label: 'Time zone', path: 'location.timeZone' },

  { label: 'Company name', path: 'company.name' },
  { label: 'Company catchphrase', path: 'company.catchPhrase' },
  { label: 'Industry', path: 'company.buzzVerb' },

  { label: 'Product name', path: 'commerce.productName' },
  { label: 'Price', path: 'commerce.price' },
  { label: 'Product description', path: 'commerce.productDescription' },
  { label: 'Product material', path: 'commerce.productMaterial' },
  { label: 'Department', path: 'commerce.department' },

  { label: 'Account number', path: 'finance.accountNumber' },
  { label: 'Amount', path: 'finance.amount' },
  { label: 'Currency code', path: 'finance.currencyCode' },
  { label: 'IBAN', path: 'finance.iban' },
  { label: 'Credit card number', path: 'finance.creditCardNumber' },
  { label: 'Bitcoin address', path: 'finance.bitcoinAddress' },
  { label: 'Transaction type', path: 'finance.transactionType' },

  { label: 'Word', path: 'lorem.word' },
  { label: 'Words (3-5)', path: 'lorem.words' },
  { label: 'Sentence', path: 'lorem.sentence' },
  { label: 'Sentences (3)', path: 'lorem.sentences' },
  { label: 'Paragraph', path: 'lorem.paragraph' },
  { label: 'Paragraphs (3)', path: 'lorem.paragraphs' },
  { label: 'Slug', path: 'lorem.slug' },
  { label: 'Text', path: 'lorem.text' },
  { label: 'Lines', path: 'lorem.lines' },

  { label: 'Recent date', path: 'date.recent' },
  { label: 'Past date', path: 'date.past' },
  { label: 'Future date', path: 'date.future' },
  { label: 'Anytime', path: 'date.anytime' },
  { label: 'Birthdate', path: 'date.birthdate' },

  { label: 'Image URL', path: 'image.url' },
  { label: 'Avatar URL', path: 'image.avatar' },

  { label: 'Integer', path: 'number.int' },
  { label: 'Float', path: 'number.float' },
  { label: 'Boolean', path: 'datatype.boolean' },

  { label: 'File name', path: 'system.fileName' },
  { label: 'File path', path: 'system.filePath' },
  { label: 'Mime type', path: 'system.mimeType' },
  { label: 'Semver version', path: 'system.semver' },
];

export const FAKER_METHOD_PATHS = new Set(FAKER_METHODS.map((m) => m.path));

/**
 * Faker modules that may be addressed by a `<module>.<method>` path.
 *
 * An allowlist rather than a blocklist: it keeps arbitrary property traversal
 * (`constructor.constructor`, `__proto__`, ...) off the table, which matters
 * because strategy paths arrive from HTTP request bodies.
 */
export const FAKER_MODULES = new Set([
  'airline',
  'animal',
  'book',
  'color',
  'commerce',
  'company',
  'database',
  'datatype',
  'date',
  'finance',
  'food',
  'git',
  'hacker',
  'helpers',
  'image',
  'internet',
  'location',
  'lorem',
  'music',
  'number',
  'person',
  'phone',
  'science',
  'string',
  'system',
  'vehicle',
  'word',
]);

const SAFE_SEGMENT = /^[a-z][A-Za-z0-9]*$/;

export function isValidFakerPath(path: string): boolean {
  if (typeof path !== 'string') return false;
  const parts = path.split('.');
  if (parts.length !== 2) return false;
  const [moduleName, method] = parts as [string, string];
  if (!FAKER_MODULES.has(moduleName)) return false;
  return SAFE_SEGMENT.test(method);
}

/** Resolve a `<module>.<method>` path to a bound callable, or throw. */
export function resolveFakerCallable(
  faker: FakerLike,
  path: string
): (...args: unknown[]) => unknown {
  if (!isValidFakerPath(path)) {
    throw new Error(`Invalid faker method: "${path}". Expected <module>.<method>.`);
  }
  const [moduleName, method] = path.split('.') as [string, string];
  const mod = (faker as any)[moduleName];
  if (!mod || typeof mod !== 'object') {
    throw new Error(`Faker module unavailable: ${moduleName}`);
  }
  const fn = mod[method];
  if (typeof fn !== 'function') {
    throw new Error(`Faker method not callable: ${path}`);
  }
  return fn.bind(mod);
}

export function invokeFaker(faker: FakerLike, path: string, args?: unknown[]): unknown {
  return resolveFakerCallable(faker, path)(...(args ?? []));
}
