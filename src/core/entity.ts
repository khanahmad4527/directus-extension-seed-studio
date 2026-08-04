import type { Rng } from './rng.js';

/**
 * Row coherence.
 *
 * Generating each field independently produces rows like
 * `first_name: "Ana", last_name: "Smith", full_name: "Bob Jones",
 * email: "karl99@x.com", city: "Paris", country: "Japan"` — obviously fake at a
 * glance. A `RowEntity` is one imaginary person/company/product/article per row;
 * coherent fields read from it, so the row hangs together.
 *
 * Every value is a lazy memoised getter: a row that only uses `content.title`
 * pays for a title, not for a whole persona.
 */

export type EntityFlavor = 'person' | 'company' | 'product' | 'content' | 'generic';

export interface RowEntityContext {
  collectionName?: string;
  rowIndex: number;
  /** Anchor for `time.*` so a run's dates cluster believably. */
  now?: Date;
}

export interface PersonEntity {
  firstName: string;
  lastName: string;
  middleName: string;
  fullName: string;
  prefix: string;
  suffix: string;
  sex: string;
  jobTitle: string;
  bio: string;
  birthdate: Date;
  avatar: string;
  initials: string;
}

export interface ContactEntity {
  email: string;
  workEmail: string;
  username: string;
  phone: string;
  website: string;
  domain: string;
}

export interface CompanyEntity {
  name: string;
  domain: string;
  catchPhrase: string;
  department: string;
  industry: string;
}

export interface LocationEntity {
  street: string;
  secondary: string;
  city: string;
  state: string;
  stateAbbr: string;
  country: string;
  countryCode: string;
  zip: string;
  latitude: number;
  longitude: number;
  timezone: string;
  address: string;
}

export interface ContentEntity {
  title: string;
  slug: string;
  excerpt: string;
  summary: string;
  body: string;
  bodyHtml: string;
  tags: string[];
  keywords: string;
}

export interface CommerceEntity {
  productName: string;
  sku: string;
  price: number;
  cost: number;
  salePrice: number;
  currency: string;
  material: string;
  department: string;
}

export interface TimeEntity {
  created: Date;
  updated: Date;
  published: Date;
}

export interface RowEntity {
  flavor: EntityFlavor;
  person: PersonEntity;
  contact: ContactEntity;
  company: CompanyEntity;
  location: LocationEntity;
  content: ContentEntity;
  commerce: CommerceEntity;
  time: TimeEntity;
}

export const ENTITY_NAMESPACES = ['person', 'contact', 'company', 'location', 'content', 'commerce', 'time'];

const FREE_MAIL = ['gmail.com', 'outlook.com', 'yahoo.com', 'proton.me', 'icloud.com'];

const PERSONISH = /(user|author|member|customer|person|people|employee|client|student|profile|account|contact|admin|staff|guest|subscriber|patient|driver|tenant|owner|lead|candidate)/;
const COMPANYISH = /(compan|organi[sz]ation|business|partner|vendor|supplier|brand|firm|agency|merchant|store|shop|restaurant|hotel|school|team|department|branch)/;
const PRODUCTISH = /(product|item|sku|catalog|inventory|merchandise|variant|listing|offer|package|plan|service|dish|menu|room|vehicle|property)/;
const CONTENTISH = /(book|article|post|blog|story|chapter|page|movie|song|album|track|episode|video|lesson|course|news|review|comment|note|doc|guide|recipe|event|ticket|task|issue)/;

/**
 * Faker generates locale-flavoured cities, states and postcodes but a random
 * global country, which produces rows like `city: "Johnson City", country:
 * "Suriname"`. The address is only coherent if the country matches the locale
 * the rest of it came from.
 */
const LOCALE_COUNTRY: Record<string, [string, string]> = {
  en: ['United States', 'US'],
  en_US: ['United States', 'US'],
  en_GB: ['United Kingdom', 'GB'],
  en_AU: ['Australia', 'AU'],
  en_CA: ['Canada', 'CA'],
  en_IE: ['Ireland', 'IE'],
  en_IN: ['India', 'IN'],
  en_NG: ['Nigeria', 'NG'],
  en_ZA: ['South Africa', 'ZA'],
  de: ['Germany', 'DE'],
  de_AT: ['Austria', 'AT'],
  de_CH: ['Switzerland', 'CH'],
  fr: ['France', 'FR'],
  fr_BE: ['Belgium', 'BE'],
  fr_CA: ['Canada', 'CA'],
  fr_CH: ['Switzerland', 'CH'],
  es: ['Spain', 'ES'],
  es_MX: ['Mexico', 'MX'],
  pt_BR: ['Brazil', 'BR'],
  pt_PT: ['Portugal', 'PT'],
  it: ['Italy', 'IT'],
  nl: ['Netherlands', 'NL'],
  nl_BE: ['Belgium', 'BE'],
  ja: ['Japan', 'JP'],
  ko: ['South Korea', 'KR'],
  zh_CN: ['China', 'CN'],
  zh_TW: ['Taiwan', 'TW'],
  pl: ['Poland', 'PL'],
  ru: ['Russia', 'RU'],
  uk: ['Ukraine', 'UA'],
  tr: ['Turkey', 'TR'],
  sv: ['Sweden', 'SE'],
  nb_NO: ['Norway', 'NO'],
  fi: ['Finland', 'FI'],
  cs_CZ: ['Czechia', 'CZ'],
  sk: ['Slovakia', 'SK'],
  hu: ['Hungary', 'HU'],
  ro: ['Romania', 'RO'],
  el: ['Greece', 'GR'],
  he: ['Israel', 'IL'],
  hr: ['Croatia', 'HR'],
  lv: ['Latvia', 'LV'],
  id_ID: ['Indonesia', 'ID'],
  th: ['Thailand', 'TH'],
  vi: ['Vietnam', 'VN'],
  fa: ['Iran', 'IR'],
  ur: ['Pakistan', 'PK'],
  hi: ['India', 'IN'],
  ne: ['Nepal', 'NP'],
  ka_GE: ['Georgia', 'GE'],
  az: ['Azerbaijan', 'AZ'],
  mk: ['North Macedonia', 'MK'],
  af_ZA: ['South Africa', 'ZA'],
  zu_ZA: ['South Africa', 'ZA'],
  yo_NG: ['Nigeria', 'NG'],
};

export function localeGeography(faker: any): { country: string; countryCode: string } | null {
  const code = faker?.definitions?.metadata?.code;
  if (typeof code !== 'string') return null;
  const exact = LOCALE_COUNTRY[code];
  if (exact) return { country: exact[0], countryCode: exact[1] };
  const language = code.split('_')[0] ?? '';
  const byLanguage = LOCALE_COUNTRY[language];
  return byLanguage ? { country: byLanguage[0], countryCode: byLanguage[1] } : null;
}

export function detectFlavor(collectionName?: string): EntityFlavor {
  if (!collectionName) return 'generic';
  const c = collectionName.toLowerCase();
  if (PERSONISH.test(c)) return 'person';
  if (COMPANYISH.test(c)) return 'company';
  if (PRODUCTISH.test(c)) return 'product';
  if (CONTENTISH.test(c)) return 'content';
  return 'generic';
}

/** Small memoisation helper — one closure per trait, computed at most once. */
function memo<T>(factory: () => T): () => T {
  let cached: T;
  let filled = false;
  return () => {
    if (!filled) {
      cached = factory();
      filled = true;
    }
    return cached;
  };
}

export function createRowEntity(rng: Rng, ctx: RowEntityContext): RowEntity {
  const f = rng.faker;
  const flavor = detectFlavor(ctx.collectionName);
  const now = ctx.now ?? new Date();

  const firstName = memo(() => String(f.person.firstName()));
  const lastName = memo(() => String(f.person.lastName()));
  const middleName = memo(() => String(f.person.middleName()));
  const companyName = memo(() => String(f.company.name()));

  const companyDomain = memo(() => {
    const base = slugify(companyName()).replace(/-/g, '').slice(0, 20) || 'example';
    return `${base}.${rng.pick(['com', 'com', 'io', 'co', 'net'])}`;
  });

  const contactDomain = memo(() => (rng.chance(0.55) ? companyDomain() : rng.pick(FREE_MAIL)));

  const title = memo(() => {
    switch (flavor) {
      case 'person':
        return `${firstName()} ${lastName()}`;
      case 'company':
        return companyName();
      case 'product':
        return String(f.commerce.productName());
      case 'content':
        return titleCase(String(f.lorem.words({ min: 3, max: 7 })));
      default:
        return titleCase(String(f.lorem.words({ min: 2, max: 5 })));
    }
  });

  const bodyParagraphs = memo(() => {
    const count = rng.int(3, 6);
    const paras: string[] = [];
    for (let i = 0; i < count; i++) paras.push(String(f.lorem.paragraph({ min: 3, max: 6 })));
    return paras;
  });

  const price = memo(() => rng.float(4, 900, 2));
  const created = memo(() => skewedPastDate(rng, now, 540));
  const updated = memo(() => {
    const from = created().getTime();
    const span = now.getTime() - from;
    return new Date(from + Math.floor(span * rng.float(0, 1, 4)));
  });

  const latitude = memo(() => rng.float(-60, 70, 6));
  const longitude = memo(() => rng.float(-170, 170, 6));
  const geography = memo(() => localeGeography(f));

  const person: PersonEntity = {
    get firstName() {
      return firstName();
    },
    get lastName() {
      return lastName();
    },
    get middleName() {
      return middleName();
    },
    get fullName() {
      return `${firstName()} ${lastName()}`;
    },
    get prefix() {
      return String(f.person.prefix());
    },
    get suffix() {
      return String(f.person.suffix());
    },
    get sex() {
      return String(f.person.sex());
    },
    get jobTitle() {
      return String(f.person.jobTitle());
    },
    get bio() {
      return String(f.person.bio());
    },
    get birthdate() {
      return f.date.birthdate({ min: 18, max: 78, mode: 'age' }) as Date;
    },
    get avatar() {
      return String(f.image.avatar());
    },
    get initials() {
      return `${firstName().charAt(0)}${lastName().charAt(0)}`.toUpperCase();
    },
  };

  const contact: ContactEntity = {
    get email() {
      return `${slugify(firstName())}.${slugify(lastName())}@${contactDomain()}`;
    },
    get workEmail() {
      return `${slugify(firstName())}.${slugify(lastName())}@${companyDomain()}`;
    },
    get username() {
      const tail = rng.chance(0.4) ? String(rng.int(2, 99)) : '';
      return `${slugify(firstName())}${slugify(lastName()).charAt(0)}${tail}`;
    },
    get phone() {
      return String(f.phone.number());
    },
    get website() {
      return `https://${companyDomain()}`;
    },
    get domain() {
      return contactDomain();
    },
  };

  const company: CompanyEntity = {
    get name() {
      return companyName();
    },
    get domain() {
      return companyDomain();
    },
    get catchPhrase() {
      return String(f.company.catchPhrase());
    },
    get department() {
      return String(f.commerce.department());
    },
    get industry() {
      return String(f.company.buzzNoun());
    },
  };

  const location: LocationEntity = {
    get street() {
      return String(f.location.streetAddress());
    },
    get secondary() {
      return String(f.location.secondaryAddress());
    },
    get city() {
      return String(f.location.city());
    },
    get state() {
      return String(f.location.state());
    },
    get stateAbbr() {
      return String(f.location.state({ abbreviated: true }));
    },
    get country() {
      // Match the locale the street/city/postcode came from.
      return geography()?.country ?? String(f.location.country());
    },
    get countryCode() {
      return geography()?.countryCode ?? String(f.location.countryCode());
    },
    get zip() {
      return String(f.location.zipCode());
    },
    get latitude() {
      return latitude();
    },
    get longitude() {
      return longitude();
    },
    get timezone() {
      return String(f.location.timeZone());
    },
    get address() {
      return `${f.location.streetAddress()}, ${f.location.city()} ${f.location.zipCode()}`;
    },
  };

  const content: ContentEntity = {
    get title() {
      return title();
    },
    get slug() {
      return `${slugify(title())}-${ctx.rowIndex + 1}`;
    },
    get excerpt() {
      return firstSentence(bodyParagraphs()[0] ?? '');
    },
    get summary() {
      return bodyParagraphs()[0] ?? '';
    },
    get body() {
      return bodyParagraphs().join('\n\n');
    },
    get bodyHtml() {
      return bodyParagraphs()
        .map((p) => `<p>${p}</p>`)
        .join('\n');
    },
    get tags() {
      return rng.pickSome(
        ['news', 'guide', 'release', 'tutorial', 'opinion', 'update', 'howto', 'case-study', 'interview', 'roundup'],
        rng.int(1, 4)
      );
    },
    get keywords() {
      return String(f.lorem.words({ min: 3, max: 6 })).split(' ').join(', ');
    },
  };

  const commerce: CommerceEntity = {
    get productName() {
      return String(f.commerce.productName());
    },
    get sku() {
      return `${String(f.string.alpha({ length: 3, casing: 'upper' }))}-${String(rng.int(10000, 99999))}`;
    },
    get price() {
      return price();
    },
    get cost() {
      return round2(price() * rng.float(0.35, 0.7, 4));
    },
    get salePrice() {
      return round2(price() * rng.float(0.6, 0.92, 4));
    },
    get currency() {
      return String(f.finance.currencyCode());
    },
    get material() {
      return String(f.commerce.productMaterial());
    },
    get department() {
      return String(f.commerce.department());
    },
  };

  const time: TimeEntity = {
    get created() {
      return created();
    },
    get updated() {
      return updated();
    },
    get published() {
      return updated();
    },
  };

  return { flavor, person, contact, company, location, content, commerce, time };
}

/** Read a dotted trait path (`person.firstName`) out of an entity. */
export function readTrait(entity: RowEntity, trait: string): unknown {
  const parts = trait.split('.');
  let cursor: any = entity;
  for (const part of parts) {
    if (cursor === null || cursor === undefined) return null;
    if (!Object.prototype.hasOwnProperty.call(cursor, part) && !(part in cursor)) return null;
    cursor = cursor[part];
  }
  return cursor ?? null;
}

export function isEntityPath(path: string): boolean {
  const head = path.split('.')[0] ?? '';
  return ENTITY_NAMESPACES.includes(head);
}

/**
 * Dates cluster toward the present in real systems: most rows are recent, a long
 * tail is old. An exponential skew reproduces that far better than a uniform pick.
 */
export function skewedPastDate(rng: Rng, now: Date, maxDaysBack: number): Date {
  const u = rng.float(0.0001, 1, 6);
  const daysAgo = Math.min(maxDaysBack, -Math.log(u) * (maxDaysBack / 4));
  const d = new Date(now.getTime() - daysAgo * 86_400_000);
  // Cluster into working hours so calendar/kanban layouts look plausible.
  d.setHours(rng.int(8, 19), rng.int(0, 59), rng.int(0, 59), 0);
  return d;
}

export function slugify(input: string): string {
  return String(input)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function titleCase(input: string): string {
  return String(input).replace(/\b\w/g, (c) => c.toUpperCase());
}

function firstSentence(text: string): string {
  const match = /^(.*?[.!?])(\s|$)/.exec(text);
  return (match?.[1] ?? text).trim();
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
