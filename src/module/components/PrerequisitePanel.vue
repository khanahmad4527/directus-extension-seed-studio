<template>
  <div class="prereq" :class="{ 'prereq-fatal': hasUnresolvable }" role="status">
    <header class="prereq-head">
      <v-icon :name="hasUnresolvable ? 'block' : 'warning'" />
      <div class="prereq-headings">
        <strong v-if="blocking.length">
          {{ nameOf(collection) }} needs
          {{ blocking.length === 1 ? 'another collection' : 'other collections' }} first
        </strong>
        <strong v-else-if="hasUnresolvable">{{ nameOf(collection) }} cannot be generated</strong>
        <strong v-else>Some optional relations will be left empty</strong>
        <p v-if="blocking.length">
          A required relation points at a collection with no rows. Generating now would fail on
          a NOT NULL constraint, so pick how much to seed first — everything runs in one pass,
          parents before children.
        </p>
        <p v-else-if="!hasUnresolvable">
          These relations are nullable, so the run will succeed — but the columns will be null.
          Tick any you would like filled as part of this run.
        </p>
      </div>
    </header>

    <ul v-if="rows.length" class="prereq-list">
      <li
        v-for="row in rows"
        :key="row.collection"
        class="prereq-row"
        :class="{ 'is-required': row.required, 'is-off': !selection[row.collection]?.include }"
        :style="{ '--depth': row.depth }"
      >
        <span class="prereq-lead">
          <span v-if="row.depth > 0" class="prereq-branch" aria-hidden="true">↳</span>
          <v-checkbox
            :model-value="selection[row.collection]?.include ?? false"
            :disabled="row.required"
            @update:model-value="(v: boolean) => toggle(row.collection, v)"
          />
        </span>

        <span class="prereq-names">
          <span class="prereq-title">
            <v-icon :name="iconOf(row.collection)" x-small />
            {{ nameOf(row.collection) }}
            <code class="prereq-key">{{ row.collection }}</code>
          </span>
          <span class="prereq-because">
            <span>needed by</span>
            <span
              v-for="(r, i) in row.requiredBy"
              :key="`${r.collection}.${r.field}`"
              class="prereq-ref"
            >
              <code>{{ r.field }}</code>
              <span>on {{ nameOf(r.collection) }}{{ i < row.requiredBy.length - 1 ? ',' : '' }}</span>
            </span>
            <span v-if="row.required" class="prereq-badge prereq-badge-required">required</span>
            <span v-else class="prereq-badge">optional</span>
          </span>
        </span>

        <span class="prereq-rows">{{ row.rowCount }} rows</span>

        <span class="prereq-count">
          <v-input
            :model-value="String(selection[row.collection]?.count ?? row.suggestedCount)"
            type="number"
            :min="1"
            :max="100000"
            :disabled="!selection[row.collection]?.include"
            small
            @update:model-value="(v: string) => setCount(row.collection, v)"
          />
        </span>
      </li>
    </ul>

    <div v-if="hasUnresolvable" class="prereq-unresolvable">
      <p v-for="item in preflight.unresolvable" :key="item.collection">
        <code>{{ item.field }}</code> on {{ nameOf(item.neededBy) }} requires
        {{ nameOf(item.collection) }}, which Seed Studio will not write to:
        {{ item.blockedReason }}
      </p>
      <p v-if="preflight.warnings.length" class="prereq-aside">
        {{ preflight.warnings.length }} optional
        {{ preflight.warnings.length === 1 ? 'relation' : 'relations' }} would also be left null.
      </p>
      <p class="prereq-advice">
        Add rows to {{ nameOf(preflight.unresolvable[0]?.collection ?? '') }} yourself, or make the
        field nullable, then try again.
      </p>
    </div>

    <footer v-else class="prereq-actions">
      <span class="prereq-summary">{{ summary }}</span>
      <v-button secondary small @click="$emit('dismiss')">
        {{ blocking.length ? 'Cancel' : 'Skip' }}
      </v-button>
      <v-button small :loading="running" @click="onRun">
        <v-icon name="bolt" left small />
        {{ runLabel }}
      </v-button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { useCollectionName } from '../composables/useCollectionName';
import type { PreflightResult, Prerequisite } from '../types';

interface Props {
  preflight: PreflightResult;
  collection: string;
  /** Rows requested for the target collection itself. */
  count: number;
  running?: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: 'run', payload: { collections: string[]; counts: Record<string, number> }): void;
  (e: 'dismiss'): void;
}>();

interface Choice {
  include: boolean;
  count: number;
}

const { nameOf, iconOf } = useCollectionName();

const selection = reactive<Record<string, Choice>>({});

const blocking = computed(() => props.preflight.blocking);
const hasUnresolvable = computed(() => props.preflight.unresolvable.length > 0);

/** Required prerequisites first, then the optional ones the user may opt into. */
const rows = computed<Prerequisite[]>(() => [...blocking.value, ...props.preflight.warnings]);

/**
 * Required rows are pre-ticked and cannot be unticked — leaving one out is the
 * same as not running at all. Optional ones start off, because the default
 * answer for a nullable relation is to leave it null.
 */
watch(
  () => props.preflight,
  () => {
    for (const key of Object.keys(selection)) delete selection[key];
    for (const row of rows.value) {
      selection[row.collection] = {
        include: row.required,
        count: row.suggestedCount,
      };
    }
  },
  { immediate: true, deep: false }
);

function toggle(collection: string, value: boolean) {
  const entry = selection[collection];
  if (entry) entry.include = value;
}

function setCount(collection: string, value: string) {
  const entry = selection[collection];
  if (!entry) return;
  const parsed = parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) entry.count = parsed;
}

const chosen = computed(() =>
  rows.value.filter((row) => selection[row.collection]?.include)
);

const totalRows = computed(
  () => chosen.value.reduce((sum, row) => sum + (selection[row.collection]?.count ?? 0), 0) + props.count
);

const summary = computed(() => {
  const collections = chosen.value.length + 1;
  return `${collections} collections · ${totalRows.value.toLocaleString()} rows total`;
});

const runLabel = computed(() => {
  if (!chosen.value.length) return `Generate ${nameOf(props.collection)}`;
  return `Generate all ${chosen.value.length + 1}`;
});

function onRun() {
  const counts: Record<string, number> = { [props.collection]: props.count };
  for (const row of chosen.value) {
    counts[row.collection] = selection[row.collection]?.count ?? row.suggestedCount;
  }
  // The server re-plans and topologically sorts these, so order here is only a
  // hint; what matters is that every collection to seed is present.
  emit('run', { collections: Object.keys(counts), counts });
}
</script>

<style scoped>
.prereq {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px 24px;
  background: var(--theme--background-subdued);
  border: 1px solid var(--theme--border-color);
  border-left: 3px solid var(--theme--warning);
  border-radius: var(--theme--border-radius);
}
.prereq-fatal {
  border-left-color: var(--theme--danger);
}

.prereq-head {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.prereq :deep(.v-icon) {
  --v-icon-color: var(--theme--warning);
}
.prereq-fatal :deep(.v-icon) {
  --v-icon-color: var(--theme--danger);
}

.prereq-headings {
  flex: 1;
}
.prereq-headings strong {
  display: block;
  font-size: 14px;
  margin-bottom: 4px;
}
.prereq-headings p {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  max-width: 78ch;
  color: var(--theme--foreground-subdued);
}

.prereq-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--theme--border-color);
  border-radius: var(--theme--border-radius);
  overflow: hidden;
}

.prereq-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto 110px;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  padding-left: calc(14px + var(--depth, 0) * 22px);
  background: var(--theme--background);
  transition: opacity 150ms ease;
}
.prereq-row + .prereq-row {
  border-top: 1px solid var(--theme--border-color);
}
.prereq-row.is-off {
  opacity: 0.6;
}

.prereq-lead {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.prereq-branch {
  color: var(--theme--foreground-subdued);
  font-size: 13px;
}

.prereq-names {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

/* Display name leads, with the collection key alongside it for precision —
   the same pairing the collection cards use. */
.prereq-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--theme--foreground);
  flex-wrap: wrap;
}
.prereq-title :deep(.v-icon) {
  --v-icon-color: var(--theme--foreground-subdued);
}

.prereq-key {
  font-family: var(--theme--fonts--monospace--font-family);
  font-size: 11px;
  font-weight: 400;
  color: var(--theme--foreground-subdued);
}

.prereq-because {
  font-size: 11px;
  color: var(--theme--foreground-subdued);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.prereq-because code {
  font-family: var(--theme--fonts--monospace--font-family);
  font-size: 11px;
}

/* "author on Ss Comments" — the field key stays monospace, the collection
   name does not, so the two read as different kinds of thing. */
.prereq-ref {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
}

.prereq-badge {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 1px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--theme--foreground) 12%, transparent);
}
.prereq-badge-required {
  background: color-mix(in srgb, var(--theme--warning) 22%, transparent);
  color: var(--theme--warning);
}

.prereq-rows {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--theme--foreground-subdued);
  white-space: nowrap;
}

.prereq-unresolvable {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
  line-height: 1.55;
  color: var(--theme--foreground-subdued);
}
.prereq-unresolvable p {
  margin: 0;
}
.prereq-unresolvable code {
  font-family: var(--theme--fonts--monospace--font-family);
  font-size: 12px;
}
.prereq-advice {
  color: var(--theme--foreground);
}

.prereq-aside {
  font-size: 12px;
  opacity: 0.85;
}

.prereq-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.prereq-summary {
  flex: 1;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--theme--foreground-subdued);
}

@media (prefers-reduced-motion: reduce) {
  .prereq-row {
    transition: none;
  }
}
</style>
