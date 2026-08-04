<template>
  <section class="screen">
    <header class="screen-header">
      <h1 class="screen-title">Generation settings</h1>
      <p class="screen-subtitle">How many rows, where, and how — final review before generating.</p>
    </header>

    <div class="settings-grid">
      <article class="setting">
        <header>
          <h2>Row count</h2>
          <p>How many rows to generate.</p>
        </header>
        <div class="chip-row">
          <button
            v-for="q in quickPicks"
            :key="q"
            type="button"
            class="chip"
            :class="{ active: count === q }"
            @click="count = q"
          >{{ q.toLocaleString() }}</button>
        </div>
        <v-input v-model="countText" type="number" :min="1" :max="1000000" />
      </article>

      <article class="setting">
        <header>
          <h2>Batch size</h2>
          <p>Rows per database insert. 500 is a good default.</p>
        </header>
        <v-input v-model="batchText" type="number" :min="1" :max="5000" />
      </article>

      <article class="setting">
        <header>
          <h2>Existing data</h2>
          <p>Append to existing rows or wipe first.</p>
        </header>
        <div class="segmented" role="radiogroup" aria-label="Existing data mode">
          <button
            type="button"
            class="segment"
            :class="{ active: mode === 'append' }"
            role="radio"
            :aria-checked="mode === 'append'"
            @click="mode = 'append'"
          >
            <v-icon name="add" small />
            <span>Append</span>
          </button>
          <button
            type="button"
            class="segment segment-danger"
            :class="{ active: mode === 'wipe' }"
            role="radio"
            :aria-checked="mode === 'wipe'"
            @click="mode = 'wipe'"
          >
            <v-icon name="delete" small />
            <span>Wipe first</span>
          </button>
        </div>
        <p v-if="mode === 'wipe'" class="danger-hint">
          <v-icon name="warning" small />
          <span>All existing rows in <code>{{ collection }}</code> will be permanently deleted.</span>
        </p>
      </article>

      <article class="setting">
        <header>
          <h2>Realism</h2>
          <p>How much the rows should behave like real content.</p>
        </header>
        <v-checkbox v-model="coherentRows" label="Coherent rows" />
        <p class="setting-note">
          One imaginary person or company per row, so name, email, username and city agree with each other.
        </p>
        <v-checkbox v-model="invariants" label="Cross-field invariants" />
        <p class="setting-note">
          Keeps <code>created ≤ updated</code>, <code>start ≤ end</code>, <code>cost ≤ price</code>, and drafts unpublished.
        </p>
        <v-checkbox v-model="realisticNulls" label="Realistic empty values" />
        <p class="setting-note">
          Leaves optional fields empty part of the time instead of filling every column.
        </p>
        <v-checkbox v-model="respectConditions" label="Respect conditional fields" />
        <p class="setting-note">
          Replays <code>meta.conditions</code> so rows match what the item form would allow.
        </p>
      </article>

      <article class="setting">
        <header>
          <h2>Reproducibility</h2>
          <p>The same seed and settings always produce the same rows.</p>
        </header>
        <div class="seed-row">
          <v-input v-model="seedText" type="number" placeholder="random" />
          <v-button secondary small @click="randomiseSeed">
            <v-icon name="casino" small />
          </v-button>
        </div>
        <p class="setting-note">Leave empty for a fresh seed. Every run records the seed it used.</p>

        <v-select
          v-model="locale"
          :items="localeItems"
          :disabled="!capabilities?.allLocales"
          placeholder="en"
        />
        <p class="setting-note">
          <template v-if="capabilities?.allLocales">
            Locale for names, addresses and phone numbers.
          </template>
          <template v-else>
            Locale switching needs the API extension — the in-browser engine ships English only.
          </template>
        </p>
      </article>

      <article class="setting">
        <header>
          <h2>Write mode</h2>
          <p>How the rows reach the database.</p>
        </header>
        <div class="segmented" role="radiogroup" aria-label="Write mode">
          <button
            type="button"
            class="segment"
            :class="{ active: writeMode === 'safe' }"
            role="radio"
            :aria-checked="writeMode === 'safe'"
            @click="writeMode = 'safe'"
          >
            <v-icon name="shield" small />
            <span>Safe</span>
          </button>
          <button
            type="button"
            class="segment"
            :class="{ active: writeMode === 'fast' }"
            role="radio"
            :aria-checked="writeMode === 'fast'"
            :disabled="!capabilities?.fastWrite"
            @click="capabilities?.fastWrite && (writeMode = 'fast')"
          >
            <v-icon name="bolt" small />
            <span>Fast</span>
          </button>
        </div>
        <p class="setting-note">
          <template v-if="writeMode === 'safe'">
            Writes exactly like the admin app: flows fire, and activity plus revisions are recorded per row.
          </template>
          <template v-else>
            Skips hooks, flows, activity and revisions. Much faster on large runs, but
            <code>user_created</code> stays empty because the write runs without accountability.
          </template>
        </p>
        <p v-if="!capabilities?.fastWrite" class="setting-note">
          Fast write needs the API extension: the REST API cannot suppress hooks or revisions.
        </p>
      </article>
    </div>

    <div v-if="insightWarnings.length" class="banner banner-warning" role="status">
      <v-icon name="warning" />
      <div>
        <strong>Before you generate</strong>
        <ul class="warning-list">
          <li v-for="(warning, i) in insightWarnings" :key="i">{{ warning }}</li>
        </ul>
      </div>
    </div>

    <div v-if="error" class="banner banner-error" role="alert">
      <v-icon name="error" />
      <div>
        <strong>Could not start generation.</strong>
        <p>{{ error }}</p>
      </div>
    </div>

    <footer class="action-bar">
      <v-button secondary @click="$emit('back')">
        <v-icon name="arrow_back" left small />
        Back
      </v-button>
      <span class="action-stat">{{ count.toLocaleString() }} rows · batch {{ batchSize }} · {{ mode }}</span>
      <v-button secondary :loading="previewing" @click="onPreview">
        <v-icon name="visibility" left small />
        Dry-run
      </v-button>
      <v-button :loading="generating" @click="onGenerate">
        <v-icon name="bolt" left small />
        Generate
      </v-button>
    </footer>

    <v-dialog :model-value="wipeConfirmOpen" @update:model-value="(v) => (wipeConfirmOpen = v)">
      <v-card class="confirm-card">
        <v-card-title>
          <v-icon name="warning" />
          Confirm destructive action
        </v-card-title>
        <v-card-text>
          <p>
            This will permanently delete <strong>every existing row</strong> in
            <code>{{ collection }}</code> before generating new data.
            This cannot be undone.
          </p>
          <p class="confirm-prompt">Type the collection name below to confirm:</p>
          <v-input v-model="wipeConfirmText" :placeholder="collection" autofocus />
        </v-card-text>
        <v-card-actions>
          <v-button secondary @click="wipeConfirmOpen = false">Cancel</v-button>
          <v-button
            :disabled="wipeConfirmText !== collection"
            kind="danger"
            @click="confirmWipeAndGenerate"
          >
            <v-icon name="delete" left />
            Wipe and generate
          </v-button>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useSeedApi } from '../composables/useSeedApi';
import type { EngineCapabilities, PreviewResponse, RunOptions, StrategyMap } from '../types';

interface Props {
  collection: string;
  strategies: StrategyMap;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: 'back'): void;
  (e: 'started', runId: string): void;
  (e: 'preview-result', result: PreviewResponse): void;
}>();

const api = useSeedApi();

const quickPicks = [100, 500, 1000, 5000, 10000];
const count = ref(100);
const countText = ref('100');
const batchText = ref('500');
const mode = ref<'append' | 'wipe'>('append');
const previewing = ref(false);
const generating = ref(false);
const error = ref<string | null>(null);

const coherentRows = ref(true);
const invariants = ref(true);
const realisticNulls = ref(false);
const respectConditions = ref(true);
const seedText = ref('');
const locale = ref<string | null>(null);
const writeMode = ref<'safe' | 'fast'>('safe');

const capabilities = ref<EngineCapabilities | null>(null);
const localeItems = ref<Array<{ text: string; value: string }>>([{ text: 'en', value: 'en' }]);
const insightWarnings = ref<string[]>([]);

const wipeConfirmOpen = ref(false);
const wipeConfirmText = ref('');

watch(count, (v) => (countText.value = String(v)));
watch(countText, (v) => {
  const n = parseInt(v, 10);
  if (!Number.isNaN(n) && n > 0) count.value = n;
});

const batchSize = computed(() => Math.max(1, parseInt(batchText.value, 10) || 500));

const runOptions = computed<RunOptions>(() => {
  const seed = parseInt(seedText.value, 10);
  return {
    seed: Number.isFinite(seed) && seed >= 0 ? seed : null,
    locale: locale.value,
    coherentRows: coherentRows.value,
    invariants: invariants.value,
    realisticNulls: realisticNulls.value,
    respectConditions: respectConditions.value,
    writeMode: writeMode.value,
  };
});

function randomiseSeed() {
  seedText.value = String(Math.floor(Math.random() * 2_147_483_647));
}

onMounted(async () => {
  const status = await api.status();
  capabilities.value = status.capabilities;
  localeItems.value = status.locales.map((code) => ({ text: code, value: code }));
  // Fast write is the better default when the engine can actually do it, but the
  // safe default stays for small runs where flows firing is the point.
  if (!status.capabilities.fastWrite) writeMode.value = 'safe';
  await loadInsights();
});

/**
 * Pre-flight warnings: flows that would fire per row, revision volume, missing
 * parent rows, and whether this instance looks like production.
 */
async function loadInsights() {
  try {
    const insights = await api.insights(props.collection, count.value);
    insightWarnings.value = insights.warnings ?? [];
  } catch {
    insightWarnings.value = [];
  }
}

let insightTimer: ReturnType<typeof setTimeout> | null = null;
watch(count, () => {
  if (insightTimer) clearTimeout(insightTimer);
  insightTimer = setTimeout(loadInsights, 400);
});

async function onPreview() {
  error.value = null;
  previewing.value = true;
  try {
    const result = await api.preview({
      collection: props.collection,
      strategies: props.strategies,
      count: 10,
      options: runOptions.value,
    });
    emit('preview-result', result);
  } catch (err: any) {
    error.value = err?.response?.data?.error ?? err?.message ?? 'Preview failed';
  } finally {
    previewing.value = false;
  }
}

async function onGenerate() {
  error.value = null;
  if (mode.value === 'wipe') {
    wipeConfirmText.value = '';
    wipeConfirmOpen.value = true;
    return;
  }
  await runGeneration(false);
}

async function confirmWipeAndGenerate() {
  if (wipeConfirmText.value !== props.collection) return;
  wipeConfirmOpen.value = false;
  await runGeneration(true);
}

async function runGeneration(wipeFirst: boolean) {
  generating.value = true;
  try {
    const result = await api.generate({
      collection: props.collection,
      strategies: props.strategies,
      count: count.value,
      batchSize: batchSize.value,
      wipeFirst,
      // The engine refuses a wipe without this, on every code path.
      confirm: wipeFirst ? props.collection : undefined,
      options: runOptions.value,
    });
    emit('started', result.runId);
  } catch (err: any) {
    error.value = err?.response?.data?.error ?? err?.message ?? 'Generation failed';
  } finally {
    generating.value = false;
  }
}
</script>

<style scoped>
.screen {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding-bottom: 80px;
}

.screen-title {
  font-size: 32px;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0;
}

.screen-subtitle {
  margin: 8px 0 0;
  font-size: 15px;
  color: var(--theme--foreground-subdued);
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 16px;
}

.setting {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px 22px;
  background: var(--theme--background-subdued);
  border: 1px solid var(--theme--border-color);
  border-radius: var(--theme--border-radius);
}

.setting header h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--theme--foreground);
}
.setting header p {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--theme--foreground-subdued);
}

.chip-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.chip {
  font: inherit;
  padding: 6px 14px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  border-radius: 999px;
  border: 1px solid var(--theme--border-color);
  background: var(--theme--background);
  color: var(--theme--foreground);
  cursor: pointer;
  transition: border-color 100ms ease, color 100ms ease, background-color 100ms ease;
}
.chip:hover {
  border-color: color-mix(in srgb, var(--theme--primary) 40%, var(--theme--border-color));
}
.chip.active {
  background: var(--theme--primary-background);
  border-color: var(--theme--primary);
  color: var(--theme--primary);
  font-weight: 600;
}

.segmented {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 4px;
  background: var(--theme--background);
  border: 1px solid var(--theme--border-color);
  border-radius: var(--theme--border-radius);
}

.segment {
  font: inherit;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 12px;
  border: none;
  border-radius: calc(var(--theme--border-radius) - 4px);
  background: transparent;
  color: var(--theme--foreground);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}
.segment:hover:not(.active) {
  background: var(--theme--background-subdued);
}
.segment.active {
  background: var(--theme--primary-background);
  color: var(--theme--primary);
  font-weight: 600;
}
.segment-danger.active {
  background: color-mix(in srgb, var(--theme--danger) 14%, transparent);
  color: var(--theme--danger);
}
.segment :deep(.v-icon) {
  --v-icon-color: currentColor;
}

.danger-hint {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--theme--danger);
  background: color-mix(in srgb, var(--theme--danger) 10%, transparent);
  border-radius: var(--theme--border-radius);
}
.danger-hint :deep(.v-icon) {
  --v-icon-color: var(--theme--danger);
  --v-icon-size: 16px;
  flex-shrink: 0;
  margin-top: 2px;
}
.danger-hint code {
  font-family: var(--theme--fonts--monospace--font-family);
  background: color-mix(in srgb, var(--theme--danger) 12%, transparent);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 12px;
}

.banner {
  display: flex;
  gap: 12px;
  padding: 14px 18px;
  border-radius: var(--theme--border-radius);
  background: var(--theme--background-subdued);
  border: 1px solid var(--theme--border-color);
}
.banner-error {
  border-left: 3px solid var(--theme--danger);
  color: var(--theme--danger);
}
.banner-error strong { display: block; font-size: 14px; margin-bottom: 2px; }
.banner-error p { margin: 0; font-size: 13px; opacity: 0.85; }

.banner-warning {
  border-left: 3px solid var(--theme--warning);
  color: var(--theme--warning);
}
.banner-warning strong { display: block; font-size: 14px; margin-bottom: 2px; }
.warning-list {
  margin: 4px 0 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.6;
}

.setting-note {
  margin: -4px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--theme--foreground-subdued);
}
.setting-note code {
  font-family: var(--theme--fonts--monospace--font-family);
  font-size: 11px;
}

.seed-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.seed-row > :first-child {
  flex: 1;
}

.segment:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* Action bar */
.action-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 0 0;
  margin-top: 8px;
  border-top: 1px solid var(--theme--border-color);
}
.action-stat {
  flex: 1;
  text-align: center;
  font-size: 13px;
  color: var(--theme--foreground-subdued);
  font-variant-numeric: tabular-nums;
}

.confirm-card {
  max-width: 520px;
}
.confirm-card :deep(.v-card-title) {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--theme--danger);
}
.confirm-card :deep(.v-card-title .v-icon) {
  --v-icon-color: var(--theme--danger);
}
.confirm-card code {
  font-family: var(--theme--fonts--monospace--font-family);
}
.confirm-prompt {
  margin-top: 12px;
  margin-bottom: 6px;
}

@media (prefers-reduced-motion: reduce) {
  .chip, .segment { transition: none; }
}
</style>
