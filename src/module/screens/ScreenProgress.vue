<template>
  <section class="screen">
    <header class="screen-header">
      <h1 class="screen-title">
        <span v-if="isDryRun">Dry-run preview</span>
        <span v-else-if="done && !errorMessage">Generated</span>
        <span v-else-if="errorMessage">Failed</span>
        <span v-else>Generating</span>
      </h1>
      <p class="screen-subtitle">
        <code>{{ collection }}</code>
      </p>
    </header>

    <!-- Dry-run view -->
    <article v-if="isDryRun" class="card">
      <header class="card-header">
        <div>
          <h2>{{ previewRows?.length ?? 0 }} sample rows</h2>
          <p>
            No data was written.
            <template v-if="seed !== null"> Seed <code>{{ seed }}</code> reproduces these exact rows.</template>
          </p>
        </div>
        <v-icon name="visibility" />
      </header>

      <div v-if="previewIssues.length" class="banner banner-error" role="alert">
        <v-icon name="error" />
        <div>
          <strong>{{ previewIssues.length }} value{{ previewIssues.length === 1 ? '' : 's' }} would be rejected by Directus.</strong>
          <ul class="issue-list">
            <li v-for="(issue, i) in previewIssues.slice(0, 8)" :key="i">
              row {{ issue.rowIndex + 1 }} · <code>{{ issue.field }}</code> — {{ issue.message }}
            </li>
          </ul>
          <p v-if="previewIssues.length > 8">…and {{ previewIssues.length - 8 }} more.</p>
        </div>
      </div>
      <div v-else class="banner banner-success">
        <v-icon name="check_circle" />
        <div>
          <strong>Every sample row passes the checks Directus would run.</strong>
          <p>Required fields, lengths, ranges and field validation rules were all satisfied.</p>
        </div>
      </div>

      <details v-if="previewChanges.length" class="changes">
        <summary>{{ previewChanges.length }} cross-field fix{{ previewChanges.length === 1 ? '' : 'es' }} applied</summary>
        <ul class="issue-list">
          <li v-for="(change, i) in previewChanges.slice(0, 12)" :key="i">
            <code>{{ change.field }}</code> — {{ change.rule }}
          </li>
        </ul>
      </details>

      <pre class="preview-json">{{ JSON.stringify(previewRows, null, 2) }}</pre>
      <footer class="card-actions">
        <v-button secondary @click="$emit('back')">
          <v-icon name="arrow_back" left />
          Back to settings
        </v-button>
        <span class="spacer" />
        <v-button @click="$emit('restart')">
          <v-icon name="restart_alt" left />
          Start over
        </v-button>
      </footer>
    </article>

    <!-- Generation progress view -->
    <article v-else class="card">
      <header class="card-header">
        <div>
          <h2 class="progress-headline">
            {{ rowsWritten.toLocaleString() }} / {{ totalRows.toLocaleString() }} rows
          </h2>
          <p>Batch {{ currentBatch }} of {{ totalBatches }} · {{ elapsedLabel }} elapsed</p>
        </div>
        <span class="progress-percent" :class="{ 'is-done': done && !errorMessage, 'is-error': errorMessage }">
          {{ percent }}<span>%</span>
        </span>
      </header>

      <v-progress-linear
        :model-value="percent"
        rounded
        :color="errorMessage ? 'var(--theme--danger)' : (done ? 'var(--theme--success)' : 'var(--theme--primary)')"
      />

      <div class="stat-grid">
        <div class="stat">
          <span class="stat-label">Rows written</span>
          <span class="stat-value">{{ rowsWritten.toLocaleString() }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Current batch</span>
          <span class="stat-value">{{ currentBatch }} / {{ totalBatches }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Elapsed</span>
          <span class="stat-value">{{ elapsedLabel }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Remaining</span>
          <span class="stat-value">{{ remainingLabel }}</span>
        </div>
      </div>

      <div v-if="errorMessage" class="banner banner-error" role="alert">
        <v-icon name="error" />
        <div>
          <strong>Generation failed.</strong>
          <p>{{ errorMessage }}</p>
        </div>
      </div>
      <div v-else-if="wasCancelled" class="banner banner-warning">
        <v-icon name="cancel" />
        <div>
          <strong>Cancelled.</strong>
          <p>
            {{ rowsWritten.toLocaleString() }} rows were already written. Undo removes exactly those rows.
          </p>
        </div>
      </div>
      <div v-else-if="done" class="banner banner-success">
        <v-icon name="check_circle" />
        <div>
          <strong>All done.</strong>
          <p>
            Wrote {{ rowsWritten.toLocaleString() }} rows in {{ elapsedLabel }}.
            <template v-if="seed !== null">Seed <code>{{ seed }}</code> reproduces this run exactly.</template>
          </p>
        </div>
      </div>

      <div v-if="undoMessage" class="banner banner-success">
        <v-icon name="undo" />
        <div>
          <strong>Undone.</strong>
          <p>{{ undoMessage }}</p>
        </div>
      </div>

      <footer class="card-actions">
        <v-button v-if="done && !errorMessage" :to="collectionLink" secondary>
          <v-icon name="open_in_new" left />
          Open collection
        </v-button>
        <v-button v-if="!done && !errorMessage && runId" secondary :loading="cancelling" @click="onCancel">
          <v-icon name="stop_circle" left />
          Stop run
        </v-button>
        <v-button
          v-if="canUndo"
          secondary
          kind="danger"
          :loading="undoing"
          @click="onUndo"
        >
          <v-icon name="undo" left />
          Undo run
        </v-button>
        <span class="spacer" />
        <v-button v-if="done || errorMessage" @click="$emit('restart')">
          <v-icon name="restart_alt" left />
          Start over
        </v-button>
      </footer>
    </article>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useSeedApi } from '../composables/useSeedApi';
import { useSseProgress } from '../composables/useSseProgress';

import type { InvariantChange, RowIssue } from '../types';

interface Props {
  collection: string;
  runId: string | null;
  previewRows: Record<string, unknown>[] | null;
  isDryRun: boolean;
  previewIssues?: RowIssue[];
  previewChanges?: InvariantChange[];
  previewSeed?: number | null;
}

const props = withDefaults(defineProps<Props>(), {
  previewIssues: () => [],
  previewChanges: () => [],
  previewSeed: null,
});
defineEmits<{ (e: 'restart'): void; (e: 'back'): void }>();

const api = useSeedApi();
const progress = useSseProgress();

const rowsWritten = ref(0);
const totalRows = ref(0);
const currentBatch = ref(0);
const totalBatches = ref(0);
const elapsedMs = ref(0);
const errorMessage = ref<string | null>(null);
const done = ref(false);
const wasCancelled = ref(false);
const runSeed = ref<number | null>(null);
const undoable = ref(false);
const cancelling = ref(false);
const undoing = ref(false);
const undoMessage = ref<string | null>(null);

const previewIssues = computed<RowIssue[]>(() => props.previewIssues ?? []);
const previewChanges = computed<InvariantChange[]>(() => props.previewChanges ?? []);
const seed = computed<number | null>(() => (props.isDryRun ? props.previewSeed ?? null : runSeed.value));
const canUndo = computed(() => done.value && !undoMessage.value && undoable.value && rowsWritten.value > 0);

async function onCancel() {
  if (!props.runId) return;
  cancelling.value = true;
  try {
    await api.cancel(props.runId);
  } finally {
    cancelling.value = false;
  }
}

/** Removes exactly the primary keys this run created — not the whole collection. */
async function onUndo() {
  if (!props.runId) return;
  undoing.value = true;
  try {
    const result = await api.undo(props.runId);
    undoMessage.value = `Removed ${result.deleted.toLocaleString()} rows from ${result.collection}.`;
    undoable.value = false;
  } catch (err: any) {
    errorMessage.value = err?.response?.data?.error ?? err?.message ?? 'Undo failed';
  } finally {
    undoing.value = false;
  }
}

watch(
  () => props.runId,
  async (id) => {
    if (!id || props.isDryRun) return;
    rowsWritten.value = 0;
    totalRows.value = 0;
    currentBatch.value = 0;
    totalBatches.value = 0;
    elapsedMs.value = 0;
    errorMessage.value = null;
    done.value = false;
    wasCancelled.value = false;
    undoMessage.value = null;
    undoable.value = false;
    runSeed.value = null;

    // Always seed from the run record first — this populates known totals and
    // state even for terminal runs whose progress history has been purged.
    try {
      const rows = (await api.listRuns(50, 0)) as any[];
      const run = rows.find((r) => r.id === id);
      if (run) {
        if (run.row_count_requested) totalRows.value = run.row_count_requested;
        if (run.row_count_written !== undefined) rowsWritten.value = run.row_count_written;
        if (run.duration_ms !== undefined) elapsedMs.value = run.duration_ms;
        if (run.seed !== undefined && run.seed !== null) runSeed.value = Number(run.seed);
        undoable.value = Boolean(run.undoable);
        if (run.status === 'success' || run.status === 'failed' || run.status === 'cancelled') {
          done.value = true;
          if (run.status === 'failed') errorMessage.value = run.error_message || 'Generation failed';
          if (run.status === 'cancelled') wasCancelled.value = true;
        }
        if (run.status === 'undone') {
          done.value = true;
          undoMessage.value = 'This run was already undone.';
        }
      }
    } catch {
      // ignore; live progress may still bring fresh state
    }

    // Subscribe to progress: SSE with the API engine, the in-tab bus without it.
    await progress.start(id);
  },
  { immediate: true }
);

watch(progress.events, (events) => {
  for (const evt of events.slice(rowsWritten.value === 0 ? 0 : -1)) {
    if (evt.totalRows) totalRows.value = evt.totalRows;
    if (evt.totalBatches) totalBatches.value = evt.totalBatches;
    if (evt.rowsWritten !== undefined) rowsWritten.value = evt.rowsWritten;
    if (evt.currentBatch !== undefined) currentBatch.value = evt.currentBatch;
    if (evt.elapsedMs !== undefined) elapsedMs.value = evt.elapsedMs;
    if (evt.type === 'complete') {
      done.value = true;
      refreshRunRecord();
    }
    if (evt.type === 'cancelled') {
      done.value = true;
      wasCancelled.value = true;
      refreshRunRecord();
    }
    if (evt.type === 'error') {
      done.value = true;
      errorMessage.value = evt.message ?? 'Generation failed';
    }
  }
}, { deep: true });

/** Undo needs the recorded primary keys, which are only written when a run ends. */
async function refreshRunRecord() {
  if (!props.runId) return;
  try {
    const rows = (await api.listRuns(50, 0)) as any[];
    const run = rows.find((r) => r.id === props.runId);
    if (!run) return;
    undoable.value = Boolean(run.undoable);
    if (run.seed !== undefined && run.seed !== null) runSeed.value = Number(run.seed);
    if (run.row_count_written !== undefined) rowsWritten.value = run.row_count_written;
  } catch {
    // Undo simply stays unavailable if the record cannot be read.
  }
}

watch(progress.error, (msg) => {
  if (msg) errorMessage.value = msg;
});

const percent = computed(() => {
  if (!totalRows.value) return 0;
  return Math.min(100, Math.floor((rowsWritten.value / totalRows.value) * 100));
});

const elapsedLabel = computed(() => formatMs(elapsedMs.value));
const remainingLabel = computed(() => {
  if (!rowsWritten.value || done.value) return '—';
  const perRow = elapsedMs.value / rowsWritten.value;
  const remaining = (totalRows.value - rowsWritten.value) * perRow;
  return formatMs(remaining);
});

const collectionLink = computed(() => `/content/${encodeURIComponent(props.collection)}`);

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}
</script>

<style scoped>
.screen {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding-bottom: 60px;
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
.screen-subtitle code {
  font-family: var(--theme--fonts--monospace--font-family);
}

.card {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 24px;
  background: var(--theme--background-subdued);
  border: 1px solid var(--theme--border-color);
  border-radius: var(--theme--border-radius);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
}
.card-header h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--theme--foreground-subdued);
}
.card-header p {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--theme--foreground-subdued);
}
.progress-headline {
  font-size: 26px !important;
  font-weight: 700 !important;
  letter-spacing: -0.02em !important;
  text-transform: none !important;
  color: var(--theme--foreground) !important;
  font-variant-numeric: tabular-nums;
}

.progress-percent {
  font-size: 36px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--theme--primary);
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.progress-percent span {
  font-size: 18px;
  font-weight: 600;
  margin-left: 2px;
}
.progress-percent.is-done { color: var(--theme--success); }
.progress-percent.is-error { color: var(--theme--danger); }

.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
  background: var(--theme--background);
  border: 1px solid var(--theme--border-color);
  border-radius: var(--theme--border-radius);
}
.stat-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--theme--foreground-subdued);
}
.stat-value {
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--theme--foreground);
}

.banner {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 18px;
  border-radius: var(--theme--border-radius);
  background: var(--theme--background);
  border: 1px solid var(--theme--border-color);
}
.banner strong { display: block; font-size: 14px; }
.banner p { margin: 4px 0 0; font-size: 13px; }
.banner-success {
  border-left: 3px solid var(--theme--success);
  color: var(--theme--success);
  animation: slide-up 250ms ease-out;
}
.banner-success p {
  color: var(--theme--success);
  opacity: 0.85;
}
.banner-success :deep(.v-icon) {
  --v-icon-color: var(--theme--success);
}
.banner-error {
  border-left: 3px solid var(--theme--danger);
  color: var(--theme--danger);
}
.banner-error p {
  color: var(--theme--danger);
  opacity: 0.85;
}

.banner-warning {
  border-left: 3px solid var(--theme--warning);
  color: var(--theme--warning);
}
.banner-warning p {
  color: var(--theme--warning);
  opacity: 0.85;
}

.issue-list {
  margin: 6px 0 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.6;
}
.issue-list code {
  font-family: var(--theme--fonts--monospace--font-family);
}

.changes {
  padding: 12px 16px;
  background: var(--theme--background);
  border: 1px solid var(--theme--border-color);
  border-radius: var(--theme--border-radius);
  font-size: 13px;
}
.changes summary {
  cursor: pointer;
  font-weight: 600;
}

.preview-json {
  max-height: 500px;
  overflow: auto;
  background: var(--theme--background);
  padding: 16px;
  font-family: var(--theme--fonts--monospace--font-family);
  font-size: 12px;
  line-height: 1.6;
  border-radius: var(--theme--border-radius);
  border: 1px solid var(--theme--border-color);
  margin: 0;
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.spacer { flex: 1; }

@keyframes slide-up {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .banner-success {
    animation: none;
  }
}
</style>
