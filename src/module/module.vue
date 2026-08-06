<template>
  <private-view title="Seed Studio">
    <template #title-outer:prepend>
      <v-button class="header-icon" rounded disabled icon secondary>
        <v-icon name="auto_awesome" />
      </v-button>
    </template>

    <template #navigation>
      <div class="sidebar">
        <p class="sidebar-eyebrow">Current run</p>
        <p v-if="!selectedCollection" class="sidebar-copy muted">
          Pick a collection to begin.
        </p>
        <div v-else class="run-summary">
          <v-icon name="dataset" small />
          <code>{{ selectedCollection }}</code>
        </div>

        <p class="sidebar-eyebrow" style="margin-top: 16px">Recent runs</p>
        <p v-if="recentRunsLoading" class="sidebar-copy muted">Loading…</p>
        <p v-else-if="!recentRuns.length" class="sidebar-copy muted">No runs yet.</p>
        <ul v-else class="recent-list">
          <li
            v-for="r in recentRuns"
            :key="r.id"
            class="recent-item"
            :class="`status-${r.status}`"
            @click="resumeRun(r)"
            :title="`${r.collection} · ${r.row_count_written}/${r.row_count_requested} rows`"
          >
            <span class="recent-status" :class="`status-${r.status}`" />
            <span class="recent-meta">
              <code>{{ r.collection }}</code>
              <span class="recent-counts">{{ r.row_count_written }}/{{ r.row_count_requested }}</span>
            </span>
            <v-icon
              v-if="r.status === 'running'"
              name="sync"
              small
              class="recent-spin"
            />
          </li>
        </ul>
        <a class="sidebar-link" href="/admin/content/seed_studio_runs" target="_blank">
          See all runs →
        </a>
      </div>
    </template>

    <div class="seed-content">
      <div v-if="engineNotice" class="engine-banner" :class="`engine-${engineNotice.tone}`" role="status">
        <v-icon :name="engineNotice.icon" small />
        <div>
          <strong>{{ engineNotice.title }}</strong>
          <p>{{ engineNotice.body }}</p>
        </div>
      </div>

      <header class="stepper" role="tablist" aria-label="Wizard steps">
        <button
          v-for="s in steps"
          :key="s.n"
          type="button"
          class="pill"
          :class="pillClass(s.n)"
          :disabled="!canGoTo(s.n)"
          role="tab"
          :aria-selected="step === s.n"
          @click="canGoTo(s.n) && goTo(s.n)"
        >
          <span class="pill-num">{{ s.n }}</span>
          <span class="pill-text">
            <span class="pill-label">{{ s.label }}</span>
            <span class="pill-hint">{{ s.hint }}</span>
          </span>
          <v-icon v-if="step > s.n" name="check" small class="pill-check" />
        </button>
      </header>

      <main class="screen-host">
        <!--
          Field choices and run settings survive stepping away and back: a dry
          run must not silently reset the seed, write mode or row count you just
          chose. Keyed by collection so picking a different one starts clean, and
          ScreenProgress is deliberately excluded so its progress subscription
          still tears down when you leave it.
        -->
        <keep-alive :include="['ScreenFields', 'ScreenSettings']" :max="4">
          <screen-collections
            v-if="step === 1"
            @selected="onCollectionSelected"
          />
          <screen-fields
            v-else-if="step === 2 && schema"
            :key="`fields-${schema.collection}`"
            :schema="schema"
            :strategies="strategies"
            @update:strategies="strategies = $event"
            @back="goTo(1)"
            @next="goTo(3)"
          />
          <screen-settings
            v-else-if="step === 3 && schema"
            :key="`settings-${schema.collection}`"
            :collection="schema.collection"
            :strategies="strategies"
            @back="goTo(2)"
            @started="onGenerationStarted"
            @preview-result="onPreviewResult"
          />
          <screen-progress
            v-else-if="step === 4"
            :collection="schema?.collection ?? ''"
            :run-id="runId"
            :preview-rows="previewRows"
            :preview-issues="previewIssues"
            :preview-changes="previewChanges"
            :preview-seed="previewSeed"
            :is-dry-run="isDryRun"
            @restart="resetWizard"
            @back="goTo(3)"
          />
        </keep-alive>
      </main>
    </div>
  </private-view>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import ScreenCollections from './screens/ScreenCollections.vue';
import ScreenFields from './screens/ScreenFields.vue';
import ScreenSettings from './screens/ScreenSettings.vue';
import ScreenProgress from './screens/ScreenProgress.vue';
import type {
  CollectionDescriptor,
  EngineStatus,
  InvariantChange,
  PreviewResponse,
  RowIssue,
  StrategyMap,
} from './types';

interface RunSummary {
  id: string;
  collection: string;
  row_count_requested: number;
  row_count_written: number;
  status: 'running' | 'success' | 'failed' | 'cancelled' | 'undone';
  started_at: string;
}

const ACTIVE_KEY = 'seed-studio.activeRun';

const steps = [
  { n: 1, label: 'Pick collection', hint: 'Where to write' },
  { n: 2, label: 'Review fields', hint: 'Strategies' },
  { n: 3, label: 'Settings', hint: 'Row count & mode' },
  { n: 4, label: 'Generate', hint: 'Live progress' },
] as const;

const step = ref<1 | 2 | 3 | 4>(1);
const selectedCollection = ref<string | null>(null);
const schema = ref<CollectionDescriptor | null>(null);
const strategies = ref<StrategyMap>({});
const runId = ref<string | null>(null);
const previewRows = ref<Record<string, unknown>[] | null>(null);
const previewIssues = ref<RowIssue[]>([]);
const previewChanges = ref<InvariantChange[]>([]);
const previewSeed = ref<number | null>(null);
const isDryRun = ref(false);
const engineStatus = ref<EngineStatus | null>(null);

/**
 * Say out loud which engine is running and what it cannot do. Silently degrading
 * would leave someone wondering why their flows fired on a "fast" run.
 */
const engineNotice = computed(() => {
  const status = engineStatus.value;
  if (!status) return null;

  if (status.engine === 'app') {
    return {
      tone: 'info' as const,
      icon: 'cloud',
      title: 'Running in this browser tab',
      body: `${status.fallbackReason ?? ''} Flows and revisions cannot be suppressed, batches stay small, and closing the tab stops the run.`.trim(),
    };
  }

  if (status.environment?.isProduction) {
    return {
      tone: 'warning' as const,
      icon: 'warning',
      title: 'This instance looks like production',
      body: `Generated rows are indistinguishable from real content once written${
        status.environment.publicUrl ? ` (${status.environment.publicUrl})` : ''
      }. Every run can be undone from the progress screen.`,
    };
  }

  return null;
});

const recentRuns = ref<RunSummary[]>([]);
const recentRunsLoading = ref(false);
let recentRunsTimer: ReturnType<typeof setInterval> | null = null;

function pillClass(n: number) {
  if (step.value === n) return 'pill-active';
  if (step.value > n) return 'pill-done';
  return 'pill-todo';
}

function canGoTo(n: number): boolean {
  if (n === 1) return true;
  if (n === 2) return !!schema.value;
  if (n === 3) return !!schema.value;
  if (n === 4) return !!runId.value || !!previewRows.value;
  return false;
}

function goTo(s: number) {
  if (s < 1 || s > 4) return;
  step.value = s as 1 | 2 | 3 | 4;
}

import { useSeedApi } from './composables/useSeedApi';
const api = useSeedApi();

async function onCollectionSelected(name: string) {
  selectedCollection.value = name;
  const descriptor = await api.getSchema(name);
  schema.value = descriptor;
  const map: StrategyMap = {};
  for (const f of descriptor.fields) {
    map[f.field] = f.suggestedStrategy;
  }
  strategies.value = map;
  runId.value = null;
  previewRows.value = null;
  isDryRun.value = false;
  step.value = 2;
}

function onGenerationStarted(id: string) {
  runId.value = id;
  previewRows.value = null;
  isDryRun.value = false;
  step.value = 4;
  persistActive(id, selectedCollection.value);
  loadRecentRuns();
}

function persistActive(id: string, col: string | null) {
  try {
    localStorage.setItem(ACTIVE_KEY, JSON.stringify({ runId: id, collection: col, ts: Date.now() }));
  } catch {
    // ignore quota / private mode
  }
}

function clearActive() {
  try { localStorage.removeItem(ACTIVE_KEY); } catch { /* ignore */ }
}

async function loadRecentRuns() {
  recentRunsLoading.value = true;
  try {
    const rows = (await api.listRuns(5, 0)) as RunSummary[];
    recentRuns.value = rows;
  } catch {
    recentRuns.value = [];
  } finally {
    recentRunsLoading.value = false;
  }
}

async function resumeRun(r: RunSummary) {
  selectedCollection.value = r.collection;
  try {
    schema.value = await api.getSchema(r.collection);
    const map: StrategyMap = {};
    for (const f of schema.value.fields) map[f.field] = f.suggestedStrategy;
    strategies.value = map;
  } catch {
    // schema fetch failed (collection may not exist anymore) — fall back to bare progress view
    schema.value = null;
  }
  runId.value = r.id;
  previewRows.value = null;
  isDryRun.value = false;
  step.value = 4;
  if (r.status === 'running') persistActive(r.id, r.collection);
}

async function tryAutoResume() {
  let stored: { runId: string; collection: string | null; ts: number } | null = null;
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (raw) stored = JSON.parse(raw);
  } catch {
    stored = null;
  }
  if (!stored?.runId) return;

  // Fetch the audit row. If it's terminal (success/failed), still surface step 4 so user sees result.
  try {
    const rows = (await api.listRuns(20, 0)) as RunSummary[];
    const match = rows.find((r) => r.id === stored!.runId);
    if (match) {
      await resumeRun(match);
      // If terminal, clear persisted so refresh next time doesn't auto-jump
      if (match.status !== 'running') clearActive();
    } else {
      clearActive();
    }
  } catch {
    clearActive();
  }
}

function onPreviewResult(result: PreviewResponse) {
  previewRows.value = result.rows;
  previewIssues.value = result.issues ?? [];
  previewChanges.value = result.changes ?? [];
  previewSeed.value = result.seed ?? null;
  isDryRun.value = true;
  runId.value = null;
  step.value = 4;
}

function resetWizard() {
  step.value = 1;
  selectedCollection.value = null;
  schema.value = null;
  strategies.value = {};
  runId.value = null;
  previewRows.value = null;
  previewIssues.value = [];
  previewChanges.value = [];
  previewSeed.value = null;
  isDryRun.value = false;
  clearActive();
  loadRecentRuns();
}

onMounted(async () => {
  engineStatus.value = await api.status().catch(() => null);
  await loadRecentRuns();
  // Poll recent runs every 4s so the sidebar reflects long-running work
  recentRunsTimer = setInterval(() => {
    loadRecentRuns();
  }, 4000);
  await tryAutoResume();
});

onBeforeUnmount(() => {
  if (recentRunsTimer) clearInterval(recentRunsTimer);
});
</script>

<style scoped>
.seed-content {
  max-width: 1280px;
  margin: 0 auto;
  padding: 32px 40px 96px;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

/* ─── Engine banner ──────────────────────────────────── */
.engine-banner {
  display: flex;
  gap: 12px;
  padding: 12px 16px;
  border-radius: var(--theme--border-radius);
  background: var(--theme--background-subdued);
  border: 1px solid var(--theme--border-color);
}
.engine-banner strong {
  display: block;
  font-size: 13px;
}
.engine-banner p {
  margin: 2px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--theme--foreground-subdued);
}
.engine-info {
  border-left: 3px solid var(--theme--primary);
}
.engine-info :deep(.v-icon) {
  --v-icon-color: var(--theme--primary);
}
.engine-warning {
  border-left: 3px solid var(--theme--warning);
}
.engine-warning :deep(.v-icon) {
  --v-icon-color: var(--theme--warning);
}

/* ─── Sidebar ────────────────────────────────────────── */
.sidebar {
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sidebar-eyebrow {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--theme--foreground-subdued);
  margin: 0;
}
.sidebar-copy {
  font-size: 13px;
  color: var(--theme--foreground);
  margin: 0;
}
.sidebar-copy.muted {
  color: var(--theme--foreground-subdued);
}
.run-summary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--theme--background-subdued);
  border-radius: var(--theme--border-radius);
  font-family: var(--theme--fonts--monospace--font-family);
  font-size: 12px;
  width: fit-content;
}

.recent-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.recent-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: var(--theme--border-radius);
  cursor: pointer;
  transition: background-color 100ms ease;
}
.recent-item:hover {
  background: var(--theme--background-subdued);
}
.recent-status {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  flex-shrink: 0;
}
.recent-status.status-running {
  background: var(--theme--warning);
  animation: pulse 1.2s ease-in-out infinite;
}
.recent-status.status-success { background: var(--theme--success); }
.recent-status.status-failed { background: var(--theme--danger); }
.recent-meta {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}
.recent-meta code {
  font-family: var(--theme--fonts--monospace--font-family);
  font-size: 12px;
  color: var(--theme--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.recent-counts {
  font-size: 11px;
  color: var(--theme--foreground-subdued);
  font-variant-numeric: tabular-nums;
}
.recent-spin {
  --v-icon-color: var(--theme--warning);
  animation: spin 1.5s linear infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

.sidebar-link {
  margin-top: 8px;
  font-size: 12px;
  color: var(--theme--primary);
  text-decoration: none;
}
.sidebar-link:hover {
  text-decoration: underline;
}

.header-icon {
  --v-button-color-disabled: var(--theme--foreground);
}

/* ─── Pill stepper ───────────────────────────────────── */
.stepper {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding: 4px;
  background: var(--theme--background-subdued);
  border-radius: 999px;
  border: 1px solid var(--theme--border-color);
}

.pill {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border: none;
  background: transparent;
  border-radius: 999px;
  color: var(--theme--foreground);
  cursor: pointer;
  font: inherit;
  text-align: left;
  transition: background-color 150ms ease, color 150ms ease, transform 100ms ease;
}

.pill:hover:not(:disabled):not(.pill-active) {
  background: var(--theme--background);
}

.pill:active:not(:disabled) {
  transform: scale(0.98);
}

.pill:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.pill-num {
  flex-shrink: 0;
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  background: var(--theme--background);
  color: var(--theme--foreground-subdued);
  border: 1px solid var(--theme--border-color);
  transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease;
}

.pill-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.pill-label {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pill-hint {
  font-size: 11px;
  color: var(--theme--foreground-subdued);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pill-check {
  margin-left: auto;
  --v-icon-color: var(--theme--success);
}

.pill-active {
  background: var(--theme--background);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--theme--foreground) 8%, transparent);
}
.pill-active .pill-num {
  background: var(--theme--primary);
  color: var(--theme--primary-foreground, white);
  border-color: var(--theme--primary);
}
.pill-active .pill-label {
  color: var(--theme--primary);
}

.pill-done .pill-num {
  background: color-mix(in srgb, var(--theme--success) 18%, transparent);
  border-color: color-mix(in srgb, var(--theme--success) 40%, transparent);
  color: var(--theme--success);
}

.pill-todo .pill-label {
  color: var(--theme--foreground-subdued);
}

@media (max-width: 900px) {
  .seed-content {
    padding: 20px 16px 80px;
    gap: 24px;
  }
  .pill-hint {
    display: none;
  }
  .pill {
    padding: 8px 10px;
  }
}

/* respect reduced motion */
@media (prefers-reduced-motion: reduce) {
  .pill,
  .pill-num {
    transition: none !important;
  }
}

</style>
