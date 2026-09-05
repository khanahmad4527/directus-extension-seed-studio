import { formatForColumnType } from './date-format.js';
import type { FieldDescriptor } from './types.js';

/**
 * Cross-field invariants.
 *
 * Field-by-field generation cannot know that `end_date` must follow
 * `start_date`, that `cost` should sit below `price`, or that a `draft` row has
 * no `published_at`. These rules run once per finished row and repair the
 * relationships a human would notice immediately.
 *
 * Rules are matched on field names, so they work on any schema without
 * configuration. Each rule reports what it changed, which the preview surfaces.
 */

export interface InvariantChange {
  field: string;
  from: unknown;
  to: unknown;
  rule: string;
}

interface DatePair {
  rule: string;
  earlier: RegExp;
  later: RegExp;
}

const DATE_PAIRS: DatePair[] = [
  {
    rule: 'created ≤ updated',
    earlier: /^(created|created_at|date_created|created_on|inserted_at)$/,
    later: /^(updated|updated_at|date_updated|modified|modified_at|last_modified)$/,
  },
  {
    rule: 'start ≤ end',
    earlier: /^(start|start_date|date_start|starts_at|start_at|from|from_date|valid_from|begins_at|begin_date|check_in)$/,
    later: /^(end|end_date|date_end|ends_at|end_at|to|to_date|valid_to|valid_until|expires_at|expiry_date|expiration_date|ends_on|check_out)$/,
  },
  {
    rule: 'published ≥ created',
    earlier: /^(created|created_at|date_created|created_on)$/,
    later: /^(published|published_at|date_published|published_on|release_date|releases_at)$/,
  },
  {
    rule: 'ordered ≤ shipped ≤ delivered',
    earlier: /^(ordered_at|order_date|placed_at)$/,
    later: /^(shipped_at|ship_date|delivered_at|delivery_date|completed_at)$/,
  },
];

interface NumericPair {
  rule: string;
  lower: RegExp;
  upper: RegExp;
}

const NUMERIC_PAIRS: NumericPair[] = [
  { rule: 'cost ≤ price', lower: /^(cost|cost_price|buy_price|purchase_price|wholesale_price)$/, upper: /^(price|unit_price|retail_price|list_price|sell_price)$/ },
  { rule: 'sale price ≤ price', lower: /^(sale_price|discount_price|discounted_price|special_price|promo_price)$/, upper: /^(price|unit_price|retail_price|list_price|regular_price)$/ },
  { rule: 'min ≤ max', lower: /^min(_|imum)?(_.*)?$/, upper: /^max(_|imum)?(_.*)?$/ },
  { rule: 'used ≤ total', lower: /^(times_used|used|used_count|consumed)$/, upper: /^(max_uses|total|quota|limit|capacity)$/ },
];

const DRAFT_STATES = /^(draft|pending|new|unverified|invited|queued|todo|review|scheduled)$/i;
const LIVE_STATES = /^(published|active|approved|completed|complete|live|open|paid|done|confirmed|success)$/i;

const PUBLISHED_DATE = /^(published|published_at|date_published|published_on|release_date)$/;
const STATUS_FIELD = /(^|_)(status|state)(_|$)/;

export function applyInvariants(
  row: Record<string, unknown>,
  fields: FieldDescriptor[]
): InvariantChange[] {
  const changes: InvariantChange[] = [];
  const byName = new Map(fields.map((f) => [f.field, f]));
  const keys = Object.keys(row);

  for (const pair of DATE_PAIRS) {
    const earlierKey = keys.find((k) => pair.earlier.test(k.toLowerCase()));
    const laterKey = keys.find((k) => pair.later.test(k.toLowerCase()));
    if (!earlierKey || !laterKey || earlierKey === laterKey) continue;

    const earlier = toDate(row[earlierKey]);
    const later = toDate(row[laterKey]);
    if (!earlier || !later) continue;
    if (later.getTime() >= earlier.getTime()) continue;

    // Push the later field forward instead of dragging the earlier one back:
    // "created" is usually the anchor a reader trusts.
    const field = byName.get(laterKey);
    const span = Math.max(3_600_000, Date.now() - earlier.getTime());
    const fixed = new Date(earlier.getTime() + Math.floor(span * 0.35));
    const next = formatLike(fixed, field);
    changes.push({ field: laterKey, from: row[laterKey], to: next, rule: pair.rule });
    row[laterKey] = next;
  }

  for (const pair of NUMERIC_PAIRS) {
    const lowerKey = keys.find((k) => pair.lower.test(k.toLowerCase()));
    const upperKey = keys.find((k) => pair.upper.test(k.toLowerCase()));
    if (!lowerKey || !upperKey || lowerKey === upperKey) continue;

    const lower = row[lowerKey];
    const upper = row[upperKey];
    if (typeof lower !== 'number' || typeof upper !== 'number') continue;
    if (lower <= upper) continue;

    const fixed = round(upper * 0.7, decimalsOf(lower));
    changes.push({ field: lowerKey, from: lower, to: fixed, rule: pair.rule });
    row[lowerKey] = fixed;
  }

  // total = quantity × unit price, when the row spells all three out.
  const qtyKey = keys.find((k) => /^(quantity|qty|units|item_count)$/.test(k.toLowerCase()));
  const unitKey = keys.find((k) => /^(unit_price|price|rate)$/.test(k.toLowerCase()));
  const totalKey = keys.find((k) => /^(total|total_price|line_total|amount_total|subtotal)$/.test(k.toLowerCase()));
  if (qtyKey && unitKey && totalKey) {
    const qty = row[qtyKey];
    const unit = row[unitKey];
    if (typeof qty === 'number' && typeof unit === 'number' && typeof row[totalKey] === 'number') {
      const expected = round(qty * unit, 2);
      if (Math.abs(expected - (row[totalKey] as number)) > 0.01) {
        changes.push({ field: totalKey, from: row[totalKey], to: expected, rule: 'total = quantity × price' });
        row[totalKey] = expected;
      }
    }
  }

  // Status ⇄ publication date consistency.
  const statusKey = keys.find((k) => STATUS_FIELD.test(k.toLowerCase()));
  const publishedKey = keys.find((k) => PUBLISHED_DATE.test(k.toLowerCase()));
  if (statusKey && publishedKey) {
    const status = String(row[statusKey] ?? '');
    const field = byName.get(publishedKey);
    const nullable = field ? !field.required : true;

    if (DRAFT_STATES.test(status) && row[publishedKey] !== null && nullable) {
      changes.push({ field: publishedKey, from: row[publishedKey], to: null, rule: 'drafts are not published' });
      row[publishedKey] = null;
    } else if (LIVE_STATES.test(status) && (row[publishedKey] === null || row[publishedKey] === undefined)) {
      const createdKey = keys.find((k) => /^(created|created_at|date_created)$/.test(k.toLowerCase()));
      const base = toDate(createdKey ? row[createdKey] : null) ?? new Date();
      const next = formatLike(base, field);
      changes.push({ field: publishedKey, from: row[publishedKey], to: next, rule: 'published rows have a date' });
      row[publishedKey] = next;
    }
  }

  // full_name should agree with first/last when all three exist.
  const firstKey = keys.find((k) => /^(first_name|firstname|given_name)$/.test(k.toLowerCase()));
  const lastKey = keys.find((k) => /^(last_name|lastname|surname|family_name)$/.test(k.toLowerCase()));
  const fullKey = keys.find((k) => /^(full_name|fullname|name|display_name)$/.test(k.toLowerCase()));
  if (firstKey && lastKey && fullKey && typeof row[firstKey] === 'string' && typeof row[lastKey] === 'string') {
    const expected = `${row[firstKey]} ${row[lastKey]}`.trim();
    if (row[fullKey] !== expected) {
      const field = byName.get(fullKey);
      const capped = field?.maxLength ? expected.slice(0, field.maxLength) : expected;
      changes.push({ field: fullKey, from: row[fullKey], to: capped, rule: 'full name matches first + last' });
      row[fullKey] = capped;
    }
  }

  return changes;
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;
  // Bare time values ("14:03:00") have no ordering across days — skip them.
  if (/^\d{2}:\d{2}/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Re-serialise a date to match how the field stores it. */
function formatLike(date: Date, field?: FieldDescriptor): string {
  return formatForColumnType(date, field?.type ?? 'dateTime', field?.interface);
}

function decimalsOf(value: number): number {
  const str = String(value);
  const dot = str.indexOf('.');
  return dot === -1 ? 0 : Math.min(4, str.length - dot - 1);
}

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
