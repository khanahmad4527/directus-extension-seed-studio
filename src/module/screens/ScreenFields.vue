<template>
  <section class="screen">
    <header class="screen-header">
      <h1 class="screen-title">{{ schema.displayName }}</h1>
      <p class="screen-subtitle">
        <code>{{ schema.collection }}</code>
        <span class="dot">·</span>
        {{ schema.fields.length }} fields
        <span class="dot">·</span>
        {{ schema.rowCount.toLocaleString() }} rows
      </p>
    </header>

    <section class="preset-bar" aria-label="Saved presets" :class="{ 'preset-bar-empty': !presets.length && !presetsLoading }">
      <span class="preset-label">
        <v-icon name="bookmark" small />
        Presets
      </span>

      <div v-if="presetsLoading" class="preset-empty">Loading…</div>

      <div v-else-if="!presets.length" class="preset-empty">
        No saved presets for <code>{{ schema.collection }}</code>. Click <strong>Save current</strong> to store these strategies.
      </div>

      <div v-else class="preset-list">
        <div v-for="p in presets" :key="p.id" class="preset-chip" :class="{ active: appliedId === p.id }">
          <button type="button" class="preset-apply" @click="applyPreset(p)" :title="presetTooltip(p)">
            <v-icon v-if="appliedId === p.id" name="check" small />
            {{ p.name }}
          </button>
          <button type="button" class="preset-del" @click="askDelete(p)" :title="`Delete ${p.name}`">
            <v-icon name="close" small />
          </button>
        </div>
        <button type="button" class="preset-reset" @click="resetToAuto" v-if="appliedId">
          Reset to auto
        </button>
      </div>

      <button
        type="button"
        class="preset-save"
        :disabled="saving"
        @click="openSaveDialog"
        :title="`Save current strategies for ${schema.collection} as a new preset`"
      >
        <v-icon name="bookmark_add" small />
        Save current
      </button>
    </section>

    <div v-if="warning" class="banner banner-warning" role="alert">
      <v-icon name="warning" />
      <div>
        <strong>Cannot generate yet.</strong>
        <p>{{ warning }}</p>
      </div>
    </div>

    <ul class="field-list">
      <li
        v-for="f in schema.fields"
        :key="f.field"
        class="field-row"
        :class="{ 'is-locked': isLocked(f), 'is-required': f.required }"
      >
        <div class="field-main">
          <div class="field-name">
            <code>{{ f.field }}</code>
            <span
              v-if="f.required"
              class="required-mark"
              aria-label="Required field"
              title="Required"
            >*</span>
            <v-icon
              v-if="f.isPrimaryKey"
              name="key"
              small
              class="meta-icon"
              v-tooltip="'Primary key'"
            />
            <v-icon
              v-if="isLocked(f) && !f.isPrimaryKey"
              name="lock"
              small
              class="meta-icon"
              v-tooltip="'Managed automatically by Directus'"
            />
          </div>
          <div class="field-meta">
            <span class="meta-pill">{{ f.type }}</span>
            <span v-if="f.interface" class="meta-pill meta-pill-ghost">{{ f.interface }}</span>
            <span v-if="f.relation" class="meta-pill meta-pill-rel">
              <v-icon name="link" small />
              → {{ f.relation.relatedCollection ?? '(m2a)' }}
            </span>
          </div>
        </div>

        <div class="field-strategy">
          <strategy-badge :strategy="effective(f)" />
          <span v-if="strategies[f.field]?.kind === 'skip'" class="skip-note">skipped</span>
        </div>

        <div class="field-actions">
          <v-button
            small
            secondary
            :disabled="isLocked(f)"
            @click="openEditor(f)"
          >
            <v-icon name="edit" left small />
            Edit
          </v-button>
          <v-button
            small
            secondary
            :disabled="isLocked(f) || f.required"
            @click="toggleSkip(f)"
          >
            {{ strategies[f.field]?.kind === 'skip' ? 'Include' : 'Skip' }}
          </v-button>
        </div>
      </li>
    </ul>

    <footer class="action-bar">
      <v-button secondary @click="$emit('back')">
        <v-icon name="arrow_back" left small />
        Back
      </v-button>
      <span class="action-stat">
        {{ activeCount }} of {{ generatedCount }} fields will be generated
      </span>
      <v-button :disabled="Boolean(blockingError)" @click="$emit('next')">
        Continue
        <v-icon name="arrow_forward" right small />
      </v-button>
    </footer>

    <v-dialog :model-value="!!editing" @update:model-value="(v) => !v && (editing = null)">
      <v-card v-if="editing" class="editor-card">
        <strategy-editor
          :field="editing"
          :strategy="strategies[editing.field] ?? editing.suggestedStrategy"
          :faker-methods="fakerMethods"
          :collection="schema.collection"
          @save="onSaveStrategy"
          @reset="onResetStrategy"
          @cancel="editing = null"
        />
      </v-card>
    </v-dialog>

    <v-dialog :model-value="!!pendingDelete" @update:model-value="(v) => !v && (pendingDelete = null)">
      <v-card v-if="pendingDelete" class="confirm-card">
        <v-card-title>
          <v-icon name="warning" />
          Delete preset?
        </v-card-title>
        <v-card-text>
          <p>
            Delete <strong>{{ pendingDelete.name }}</strong>? The saved strategies will be gone permanently.
            Existing rows in <code>{{ pendingDelete.collection }}</code> are not affected.
          </p>
        </v-card-text>
        <v-card-actions>
          <v-button secondary @click="pendingDelete = null">Cancel</v-button>
          <v-button kind="danger" @click="confirmDelete">
            <v-icon name="delete" left small />
            Delete
          </v-button>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog :model-value="saveOpen" @update:model-value="(v) => !v && (saveOpen = false)">
      <v-card class="save-card">
        <v-card-title>
          <v-icon name="bookmark_add" />
          Save preset
        </v-card-title>
        <v-card-text>
          <p>
            Save the current strategies for <code>{{ schema.collection }}</code> as a reusable preset.
          </p>
          <label class="save-label">Name</label>
          <v-input v-model="saveName" placeholder="e.g. Demo blog data" autofocus @keydown.enter="confirmSave" />
          <p v-if="saveError" class="save-error">{{ saveError }}</p>
        </v-card-text>
        <v-card-actions>
          <v-button secondary @click="saveOpen = false">Cancel</v-button>
          <v-button :loading="saving" :disabled="!saveName.trim()" @click="confirmSave">
            <v-icon name="check" left small />
            Save preset
          </v-button>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import StrategyBadge from '../components/StrategyBadge.vue';
import StrategyEditor from '../components/StrategyEditor.vue';
import { useSeedApi } from '../composables/useSeedApi';
import type {
  CollectionDescriptor,
  FakerMethodEntry,
  FieldDescriptor,
  GenerationStrategy,
  PresetRow,
  StrategyMap,
} from '../types';

interface Props {
  schema: CollectionDescriptor;
  strategies: StrategyMap;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: 'update:strategies', map: StrategyMap): void;
  (e: 'back'): void;
  (e: 'next'): void;
}>();

const api = useSeedApi();
const fakerMethods = ref<FakerMethodEntry[]>([]);
const editing = ref<FieldDescriptor | null>(null);
const presets = ref<PresetRow[]>([]);
const presetsLoading = ref(false);
const appliedId = ref<string | null>(null);
const pendingDelete = ref<PresetRow | null>(null);
const saveOpen = ref(false);
const saveName = ref('');
const saving = ref(false);
const saveError = ref<string | null>(null);

onMounted(async () => {
  try {
    fakerMethods.value = await api.fakerMethods();
  } catch {
    fakerMethods.value = [];
  }
  await loadPresets();
});

async function loadPresets() {
  presetsLoading.value = true;
  try {
    presets.value = await api.listPresets(props.schema.collection);
  } catch {
    presets.value = [];
  } finally {
    presetsLoading.value = false;
  }
}

function applyPreset(p: PresetRow) {
  emit('update:strategies', { ...p.strategies });
  appliedId.value = p.id ?? null;
}

function askDelete(p: PresetRow) {
  pendingDelete.value = p;
}

function openSaveDialog() {
  saveName.value = '';
  saveError.value = null;
  saveOpen.value = true;
}

async function confirmSave() {
  const name = saveName.value.trim();
  if (!name) return;
  saving.value = true;
  saveError.value = null;
  try {
    const effective: StrategyMap = {};
    for (const f of props.schema.fields) {
      effective[f.field] = props.strategies[f.field] ?? f.suggestedStrategy;
    }
    const result = await api.savePreset({
      name,
      collection: props.schema.collection,
      strategies: effective,
    });
    await loadPresets();
    appliedId.value = result.id;
    saveOpen.value = false;
  } catch (err: any) {
    saveError.value = err?.response?.data?.error ?? err?.message ?? 'Save failed';
  } finally {
    saving.value = false;
  }
}

async function confirmDelete() {
  const p = pendingDelete.value;
  pendingDelete.value = null;
  if (!p?.id) return;
  try {
    await api.deletePreset(p.id);
    if (appliedId.value === p.id) appliedId.value = null;
    await loadPresets();
  } catch {
    // ignore
  }
}

function resetToAuto() {
  const map: StrategyMap = {};
  for (const f of props.schema.fields) map[f.field] = f.suggestedStrategy;
  emit('update:strategies', map);
  appliedId.value = null;
}

function presetTooltip(p: PresetRow): string {
  const count = Object.keys(p.strategies ?? {}).length;
  return `${p.name} · ${count} field${count === 1 ? '' : 's'}`;
}

function isLocked(f: FieldDescriptor): boolean {
  return f.isSystemField || f.readonly;
}

function effective(f: FieldDescriptor): GenerationStrategy {
  return props.strategies[f.field] ?? f.suggestedStrategy;
}

function openEditor(f: FieldDescriptor) {
  if (isLocked(f)) return;
  editing.value = f;
}

function onSaveStrategy(strategy: GenerationStrategy) {
  if (!editing.value) return;
  emit('update:strategies', { ...props.strategies, [editing.value.field]: strategy });
  appliedId.value = null;
  editing.value = null;
}

function onResetStrategy() {
  if (!editing.value) return;
  const next = { ...props.strategies };
  next[editing.value.field] = editing.value.suggestedStrategy;
  emit('update:strategies', next);
  appliedId.value = null;
  editing.value = null;
}

function toggleSkip(f: FieldDescriptor) {
  if (f.required) return;
  const next: StrategyMap = { ...props.strategies };
  const current = next[f.field] ?? f.suggestedStrategy;
  next[f.field] = current.kind === 'skip' ? f.suggestedStrategy : { kind: 'skip' };
  emit('update:strategies', next);
  appliedId.value = null;
}

const blockingError = computed(() => {
  for (const f of props.schema.fields) {
    if (isLocked(f)) continue;
    const s = effective(f);
    if (f.required && (s.kind === 'null' || s.kind === 'skip')) {
      return `Field "${f.field}" is required but its strategy is "${s.kind}".`;
    }
  }
  return null;
});

const warning = computed(() => blockingError.value);

const activeCount = computed(() => {
  let n = 0;
  for (const f of props.schema.fields) {
    if (isLocked(f)) continue;
    const s = effective(f);
    if (s.kind === 'skip' || s.kind === 'system') continue;
    n++;
  }
  return n;
});

const generatedCount = computed(() => props.schema.fields.filter((f) => !isLocked(f)).length);
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
  font-size: 14px;
  color: var(--theme--foreground-subdued);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.screen-subtitle code {
  font-family: var(--theme--fonts--monospace--font-family);
}
.dot {
  opacity: 0.5;
}

/* Preset bar */
.preset-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: var(--theme--background-subdued);
  border: 1px solid var(--theme--border-color);
  border-radius: var(--theme--border-radius);
  flex-wrap: wrap;
}
.preset-bar-empty {
  border-style: dashed;
  background: transparent;
}
.preset-empty code {
  font-family: var(--theme--fonts--monospace--font-family);
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--theme--background-subdued);
  color: var(--theme--foreground);
}
.preset-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--theme--foreground-subdued);
  font-weight: 600;
}
.preset-empty {
  font-size: 12px;
  color: var(--theme--foreground-subdued);
  flex: 1;
}
.preset-empty strong {
  color: var(--theme--foreground);
  font-weight: 600;
}
.preset-list {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  flex: 1;
  min-width: 0;
}
.preset-chip {
  display: inline-flex;
  align-items: stretch;
  border: 1px solid var(--theme--border-color);
  border-radius: 999px;
  background: var(--theme--background);
  overflow: hidden;
  transition: border-color 120ms ease;
}
.preset-chip:hover {
  border-color: color-mix(in srgb, var(--theme--primary) 40%, var(--theme--border-color));
}
.preset-chip.active {
  border-color: var(--theme--primary);
  background: var(--theme--primary-background);
}
.preset-apply {
  font: inherit;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 12px;
  cursor: pointer;
}
.preset-chip.active .preset-apply {
  color: var(--theme--primary);
  font-weight: 600;
}
.preset-del {
  display: inline-grid;
  place-items: center;
  padding: 0 8px;
  border: none;
  border-left: 1px solid var(--theme--border-color);
  background: transparent;
  color: var(--theme--foreground-subdued);
  cursor: pointer;
  transition: background-color 100ms ease, color 100ms ease;
}
.preset-del:hover {
  background: color-mix(in srgb, var(--theme--danger) 12%, transparent);
  color: var(--theme--danger);
}
.preset-reset {
  font: inherit;
  font-size: 12px;
  padding: 4px 10px;
  background: transparent;
  border: none;
  color: var(--theme--foreground-subdued);
  cursor: pointer;
  text-decoration: underline;
}
.preset-reset:hover {
  color: var(--theme--foreground);
}

.preset-save {
  font: inherit;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  margin-left: auto;
  background: var(--theme--primary-background);
  color: var(--theme--primary);
  border: 1px solid color-mix(in srgb, var(--theme--primary) 35%, transparent);
  border-radius: 999px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  transition: background-color 120ms ease;
}
.preset-save:hover:not(:disabled) {
  background: color-mix(in srgb, var(--theme--primary) 18%, var(--theme--primary-background));
}
.preset-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.preset-save :deep(.v-icon) {
  --v-icon-color: var(--theme--primary);
}

.save-card {
  max-width: 480px;
}
.save-card :deep(.v-card-title) {
  display: flex;
  align-items: center;
  gap: 8px;
}
.save-card code {
  font-family: var(--theme--fonts--monospace--font-family);
  background: var(--theme--background-subdued);
  padding: 1px 6px;
  border-radius: 4px;
}
.save-label {
  display: block;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--theme--foreground-subdued);
  margin: 12px 0 6px;
}
.save-error {
  color: var(--theme--danger);
  font-size: 13px;
  margin-top: 8px;
}

/* Banner */
.banner {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 18px;
  border-radius: var(--theme--border-radius);
  background: var(--theme--background-subdued);
  border: 1px solid var(--theme--border-color);
}
.banner-warning {
  border-left: 3px solid var(--theme--warning);
  color: var(--theme--warning);
}
.banner strong {
  display: block;
  font-size: 14px;
  margin-bottom: 2px;
}
.banner p {
  margin: 0;
  font-size: 13px;
  color: var(--theme--foreground-subdued);
}
.banner-warning p {
  color: var(--theme--warning);
  opacity: 0.85;
}

/* Field list — card rows */
.field-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 16px;
  padding: 12px 16px;
  background: var(--theme--background-subdued);
  border: 1px solid var(--theme--border-color);
  border-radius: var(--theme--border-radius);
  transition: border-color 150ms ease, background-color 150ms ease;
}

.field-row:hover:not(.is-locked) {
  border-color: color-mix(in srgb, var(--theme--primary) 40%, var(--theme--border-color));
  background: var(--theme--background);
}

.field-row.is-locked {
  opacity: 0.6;
}

.field-main {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.field-name {
  display: flex;
  align-items: center;
  gap: 6px;
}
.field-name code {
  font-family: var(--theme--fonts--monospace--font-family);
  font-size: 14px;
  font-weight: 600;
  color: var(--theme--foreground);
}
.required-mark {
  color: var(--theme--danger);
  font-weight: 700;
  font-size: 16px;
  line-height: 1;
  display: inline-block;
  transform: translateY(-1px);
}
.meta-icon {
  --v-icon-color: var(--theme--foreground-subdued);
}

.field-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.meta-pill {
  font-family: var(--theme--fonts--monospace--font-family);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--theme--background);
  color: var(--theme--foreground-subdued);
  border: 1px solid var(--theme--border-color);
}
.meta-pill-ghost {
  background: transparent;
}
.meta-pill-rel {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--theme--secondary, var(--theme--primary));
  border-color: color-mix(in srgb, var(--theme--secondary, var(--theme--primary)) 35%, transparent);
}
.meta-pill-rel :deep(.v-icon) {
  --v-icon-color: currentColor;
  --v-icon-size: 12px;
}

.field-strategy {
  display: flex;
  align-items: center;
  gap: 8px;
}

.skip-note {
  font-size: 11px;
  color: var(--theme--foreground-subdued);
  font-style: italic;
}

.field-actions {
  display: flex;
  gap: 6px;
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

.editor-card {
  max-width: 480px;
}

.confirm-card {
  max-width: 480px;
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
  background: var(--theme--background-subdued);
  padding: 1px 6px;
  border-radius: 4px;
}

@media (max-width: 720px) {
  .field-row {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .field-actions {
    justify-content: flex-end;
  }
}

@media (prefers-reduced-motion: reduce) {
  .field-row {
    transition: none;
  }
}
</style>
