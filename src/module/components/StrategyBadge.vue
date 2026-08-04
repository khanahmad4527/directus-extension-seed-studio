<template>
  <span class="badge" :class="`family-${family}`" :title="title">
    <v-icon :name="icon" small class="badge-icon" />
    <span class="badge-label">{{ label }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { GenerationStrategy } from '../types';

const props = defineProps<{ strategy: GenerationStrategy }>();

type Family = 'faker' | 'relation' | 'random' | 'system' | 'constructive' | 'static' | 'coherent';

const family = computed<Family>(() => kindFamily(props.strategy.kind));
const label = computed(() => describeStrategy(props.strategy));
const title = computed(() => longTitle(props.strategy));
const icon = computed(() => iconFor(family.value));

function kindFamily(kind: GenerationStrategy['kind']): Family {
  if (kind === 'faker') return 'faker';
  if (kind === 'coherent' || kind === 'template') return 'coherent';
  if (
    kind === 'm2o_random' ||
    kind === 'file_reuse' ||
    kind === 'random_user_collection' ||
    kind === 'random_item_of_field' ||
    kind === 'm2m_random'
  ) {
    return 'relation';
  }
  if (kind.startsWith('random_') || kind === 'weighted_choice') return 'random';
  if (kind === 'system' || kind === 'skip' || kind === 'null') return 'system';
  if (
    kind === 'uuid' ||
    kind === 'sequence' ||
    kind === 'lorem_paragraphs' ||
    kind === 'markdown' ||
    kind === 'html' ||
    kind === 'regex' ||
    kind === 'geometry'
  ) {
    return 'constructive';
  }
  return 'static';
}

function iconFor(f: Family): string {
  switch (f) {
    case 'faker': return 'face';
    case 'coherent': return 'hub';
    case 'relation': return 'link';
    case 'random': return 'casino';
    case 'system': return 'lock';
    case 'constructive': return 'auto_awesome';
    case 'static': return 'edit_note';
  }
}

function describeStrategy(s: GenerationStrategy): string {
  switch (s.kind) {
    case 'system': return 'auto (Directus)';
    case 'skip': return 'skip';
    case 'null': return 'null';
    case 'fixed': return `fixed: ${formatValue(s.value)}`;
    case 'faker': return s.method;
    case 'random_choice': return `${s.choices.length} choices`;
    case 'random_int': return `int ${s.min}–${s.max}`;
    case 'random_float': return `float ${s.min}–${s.max}`;
    case 'random_date': return `date ±${s.daysBack}/${s.daysForward}d`;
    case 'random_boolean': return `bool ${Math.round(s.trueProbability * 100)}%`;
    case 'uuid': return 'uuid';
    case 'sequence': return s.pattern;
    case 'm2o_random': return `pick from ${s.relatedCollection}`;
    case 'file_reuse': return `reuse file${s.mimeFilter ? ' · ' + s.mimeFilter : ''}`;
    case 'lorem_paragraphs': return `${s.count}× paragraph`;
    case 'random_user_collection': return 'random user collection';
    case 'random_item_of_field': return `item of ${s.collectionField}`;
    case 'coherent': return s.trait;
    case 'template': return s.template.length > 28 ? `${s.template.slice(0, 28)}…` : s.template;
    case 'weighted_choice': return `${s.choices.length} weighted`;
    case 'regex': return s.pattern.length > 24 ? `${s.pattern.slice(0, 24)}…` : s.pattern;
    case 'geometry': return `geo ${s.geometryType ?? 'Point'}`;
    case 'markdown': return `markdown ×${s.paragraphs ?? 3}`;
    case 'html': return `html ×${s.paragraphs ?? 3}`;
    case 'm2m_random': return `link ${s.min}–${s.max}`;
  }
}

function longTitle(s: GenerationStrategy): string {
  const nulls = typeof s.nullRate === 'number' && s.nullRate > 0
    ? ` · ${Math.round(s.nullRate * 100)}% empty`
    : '';
  return `${s.kind} — ${describeStrategy(s)}${nulls}`;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '∅';
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 30);
  const s = String(v);
  return s.length > 24 ? s.slice(0, 24) + '…' : s;
}
</script>

<style scoped>
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px 4px 8px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 1.2;
  font-family: var(--theme--fonts--monospace--font-family);
  border: 1px solid var(--theme--border-color);
  background-color: var(--theme--background-subdued);
  color: var(--theme--foreground);
  white-space: nowrap;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}

.badge-icon {
  --v-icon-size: 14px;
  --v-icon-color: currentColor;
}

.badge-label {
  font-weight: 500;
}

/* faker — primary blue */
.family-faker {
  color: var(--theme--primary);
  border-color: color-mix(in srgb, var(--theme--primary) 35%, transparent);
  background-color: var(--theme--primary-background);
}

/* coherent — derived from the row's shared entity */
.family-coherent {
  color: var(--theme--secondary, #6644ff);
  border-color: color-mix(in srgb, var(--theme--secondary, #6644ff) 35%, transparent);
  background-color: color-mix(in srgb, var(--theme--secondary, #6644ff) 10%, transparent);
}

/* relation — secondary (purple in default theme) */
.family-relation {
  color: var(--theme--secondary, var(--theme--primary));
  border-color: color-mix(in srgb, var(--theme--secondary, var(--theme--primary)) 35%, transparent);
  background-color: color-mix(in srgb, var(--theme--secondary, var(--theme--primary)) 12%, transparent);
}

/* random — neutral chip */
.family-random {
  color: var(--theme--foreground);
  border-color: var(--theme--border-color);
  background-color: var(--theme--background-subdued);
}

/* system — subdued / locked */
.family-system {
  color: var(--theme--foreground-subdued);
  border-color: var(--theme--border-color);
  background-color: transparent;
  font-style: italic;
}

/* constructive — success-tinted, for generators that build values */
.family-constructive {
  color: var(--theme--success);
  border-color: color-mix(in srgb, var(--theme--success) 35%, transparent);
  background-color: color-mix(in srgb, var(--theme--success) 12%, transparent);
}

/* static — fixed/literal */
.family-static {
  color: var(--theme--warning);
  border-color: color-mix(in srgb, var(--theme--warning) 35%, transparent);
  background-color: color-mix(in srgb, var(--theme--warning) 12%, transparent);
}
</style>
