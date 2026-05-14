<template>
  <div class="strategy-editor">
    <header>
      <h3>{{ field.field }}</h3>
      <code class="muted">{{ field.type }}{{ field.interface ? ' · ' + field.interface : '' }}</code>
    </header>

    <div class="form-row">
      <label>Strategy</label>
      <v-select
        :model-value="local.kind"
        :items="kindOptions"
        @update:model-value="onKindChange"
      />
    </div>

    <div v-if="local.kind === 'fixed'" class="form-row">
      <label>Value</label>
      <v-input v-model="fixedValue" placeholder="Any string, number, or JSON" />
    </div>

    <div v-if="local.kind === 'faker'" class="form-row">
      <label>Faker method</label>
      <v-select
        :model-value="(local as any).method"
        :items="fakerOptions"
        @update:model-value="onFakerMethodChange"
      />
    </div>

    <div v-if="local.kind === 'random_choice'" class="form-row">
      <label>Choices (comma-separated)</label>
      <v-input v-model="choicesText" placeholder="alpha, beta, gamma" />
    </div>

    <template v-if="local.kind === 'random_int'">
      <div class="form-row">
        <label>Min</label>
        <v-input type="number" v-model="randomIntMin" />
      </div>
      <div class="form-row">
        <label>Max</label>
        <v-input type="number" v-model="randomIntMax" />
      </div>
    </template>

    <template v-if="local.kind === 'random_float'">
      <div class="form-row">
        <label>Min</label>
        <v-input type="number" v-model="randomFloatMin" />
      </div>
      <div class="form-row">
        <label>Max</label>
        <v-input type="number" v-model="randomFloatMax" />
      </div>
      <div class="form-row">
        <label>Fraction digits</label>
        <v-input type="number" v-model="randomFloatDigits" />
      </div>
    </template>

    <template v-if="local.kind === 'random_date'">
      <div class="form-row">
        <label>Days back</label>
        <v-input type="number" v-model="dateBack" />
      </div>
      <div class="form-row">
        <label>Days forward</label>
        <v-input type="number" v-model="dateForward" />
      </div>
    </template>

    <div v-if="local.kind === 'random_boolean'" class="form-row">
      <label>True probability (0 – 1)</label>
      <v-input type="number" v-model="boolProb" />
    </div>

    <div v-if="local.kind === 'sequence'" class="form-row">
      <label>Pattern</label>
      <v-input v-model="sequencePattern" placeholder="INV-{0000}" />
    </div>

    <div v-if="local.kind === 'm2o_random'" class="form-row">
      <label>Related collection</label>
      <v-input v-model="m2oCollection" />
    </div>

    <div v-if="local.kind === 'file_reuse'" class="form-row">
      <label>Mime filter (optional)</label>
      <v-input v-model="fileMime" placeholder="image/" />
    </div>

    <div v-if="local.kind === 'lorem_paragraphs'" class="form-row">
      <label>Paragraph count</label>
      <v-input type="number" v-model="loremCount" />
    </div>

    <div v-if="local.kind === 'random_item_of_field'" class="form-row">
      <label>Sibling field holding the collection name</label>
      <v-input v-model="itemOfField" placeholder="collection" />
      <p class="form-hint">Reads the value of this row's other field (e.g. <code>collection</code>) and picks a random PK from that user collection.</p>
    </div>

    <div v-if="previewError" class="preview-error">{{ previewError }}</div>
    <div v-else-if="previewValues.length" class="preview-box">
      <strong>Sample values</strong>
      <ul>
        <li v-for="(v, i) in previewValues" :key="i">{{ formatPreview(v) }}</li>
      </ul>
    </div>

    <footer>
      <v-button secondary small :loading="previewing" @click="onPreview">
        <v-icon name="visibility" left small />
        Preview
      </v-button>
      <v-button secondary small @click="onReset">Reset to auto</v-button>
      <div class="spacer" />
      <v-button secondary small @click="$emit('cancel')">Cancel</v-button>
      <v-button small @click="onSave">Save</v-button>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useSeedApi } from '../composables/useSeedApi';
import type { FakerMethodEntry, FieldDescriptor, GenerationStrategy } from '../types';

interface Props {
  field: FieldDescriptor;
  strategy: GenerationStrategy;
  fakerMethods: FakerMethodEntry[];
  collection: string;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  (e: 'save', strategy: GenerationStrategy): void;
  (e: 'reset'): void;
  (e: 'cancel'): void;
}>();

const api = useSeedApi();
const local = ref<GenerationStrategy>(clone(props.strategy));

const fixedValue = ref('');
const choicesText = ref('');
const randomIntMin = ref('0');
const randomIntMax = ref('100');
const randomFloatMin = ref('0');
const randomFloatMax = ref('100');
const randomFloatDigits = ref('2');
const dateBack = ref('365');
const dateForward = ref('0');
const boolProb = ref('0.5');
const sequencePattern = ref('INV-{0000}');
const m2oCollection = ref('');
const fileMime = ref('image/');
const loremCount = ref('3');
const itemOfField = ref('collection');

const previewing = ref(false);
const previewValues = ref<unknown[]>([]);
const previewError = ref<string | null>(null);

watch(
  () => props.strategy,
  (s) => {
    local.value = clone(s);
    hydrate();
  },
  { immediate: true }
);

function hydrate() {
  const s = local.value;
  if (s.kind === 'fixed') fixedValue.value = String((s as any).value ?? '');
  if (s.kind === 'random_choice') choicesText.value = (s.choices as any[]).map(String).join(', ');
  if (s.kind === 'random_int') {
    randomIntMin.value = String(s.min);
    randomIntMax.value = String(s.max);
  }
  if (s.kind === 'random_float') {
    randomFloatMin.value = String(s.min);
    randomFloatMax.value = String(s.max);
    randomFloatDigits.value = String(s.fractionDigits);
  }
  if (s.kind === 'random_date') {
    dateBack.value = String(s.daysBack);
    dateForward.value = String(s.daysForward);
  }
  if (s.kind === 'random_boolean') boolProb.value = String(s.trueProbability);
  if (s.kind === 'sequence') sequencePattern.value = s.pattern;
  if (s.kind === 'm2o_random') m2oCollection.value = s.relatedCollection;
  if (s.kind === 'file_reuse') fileMime.value = s.mimeFilter ?? '';
  if (s.kind === 'lorem_paragraphs') loremCount.value = String(s.count);
  if (s.kind === 'random_item_of_field') itemOfField.value = s.collectionField;
}

const kindOptions = [
  { text: 'System (auto)', value: 'system' },
  { text: 'Skip', value: 'skip' },
  { text: 'Null', value: 'null' },
  { text: 'Fixed value', value: 'fixed' },
  { text: 'Faker method', value: 'faker' },
  { text: 'Random choice', value: 'random_choice' },
  { text: 'Random integer', value: 'random_int' },
  { text: 'Random float', value: 'random_float' },
  { text: 'Random date', value: 'random_date' },
  { text: 'Random boolean', value: 'random_boolean' },
  { text: 'UUID', value: 'uuid' },
  { text: 'Sequence', value: 'sequence' },
  { text: 'Random parent (M2O)', value: 'm2o_random' },
  { text: 'Reuse existing file', value: 'file_reuse' },
  { text: 'Lorem paragraphs', value: 'lorem_paragraphs' },
  { text: 'Random user collection', value: 'random_user_collection' },
  { text: 'Item of another field', value: 'random_item_of_field' },
];

const fakerOptions = computed(() =>
  props.fakerMethods.map((m) => ({ text: m.label, value: m.path }))
);

function onKindChange(value: string) {
  local.value = defaultsForKind(value as GenerationStrategy['kind']);
  hydrate();
}

function defaultsForKind(kind: GenerationStrategy['kind']): GenerationStrategy {
  switch (kind) {
    case 'system':
      return { kind: 'system' };
    case 'skip':
      return { kind: 'skip' };
    case 'null':
      return { kind: 'null' };
    case 'fixed':
      return { kind: 'fixed', value: '' };
    case 'faker':
      return { kind: 'faker', method: props.fakerMethods[0]?.path ?? 'lorem.word' };
    case 'random_choice':
      return { kind: 'random_choice', choices: ['alpha', 'beta'] };
    case 'random_int':
      return { kind: 'random_int', min: 0, max: 100 };
    case 'random_float':
      return { kind: 'random_float', min: 0, max: 100, fractionDigits: 2 };
    case 'random_date':
      return { kind: 'random_date', daysBack: 365, daysForward: 0 };
    case 'random_boolean':
      return { kind: 'random_boolean', trueProbability: 0.5 };
    case 'uuid':
      return { kind: 'uuid' };
    case 'sequence':
      return { kind: 'sequence', pattern: 'INV-{0000}' };
    case 'm2o_random':
      return { kind: 'm2o_random', relatedCollection: props.field.relation?.relatedCollection ?? '' };
    case 'file_reuse':
      return { kind: 'file_reuse', mimeFilter: 'image/' };
    case 'lorem_paragraphs':
      return { kind: 'lorem_paragraphs', count: 3 };
    case 'random_user_collection':
      return { kind: 'random_user_collection' };
    case 'random_item_of_field':
      return { kind: 'random_item_of_field', collectionField: 'collection' };
  }
}

function onFakerMethodChange(value: string) {
  if (local.value.kind === 'faker') {
    local.value = { kind: 'faker', method: value };
  }
}

function buildStrategy(): GenerationStrategy {
  const s = local.value;
  switch (s.kind) {
    case 'fixed':
      return { kind: 'fixed', value: coerceValue(fixedValue.value) };
    case 'random_choice':
      return {
        kind: 'random_choice',
        choices: choicesText.value
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean)
          .map(coerceValue),
      };
    case 'random_int':
      return { kind: 'random_int', min: Number(randomIntMin.value), max: Number(randomIntMax.value) };
    case 'random_float':
      return {
        kind: 'random_float',
        min: Number(randomFloatMin.value),
        max: Number(randomFloatMax.value),
        fractionDigits: Number(randomFloatDigits.value),
      };
    case 'random_date':
      return {
        kind: 'random_date',
        daysBack: Number(dateBack.value),
        daysForward: Number(dateForward.value),
      };
    case 'random_boolean':
      return { kind: 'random_boolean', trueProbability: Number(boolProb.value) };
    case 'sequence':
      return { kind: 'sequence', pattern: sequencePattern.value };
    case 'm2o_random':
      return { kind: 'm2o_random', relatedCollection: m2oCollection.value };
    case 'file_reuse':
      return { kind: 'file_reuse', mimeFilter: fileMime.value || undefined };
    case 'lorem_paragraphs':
      return { kind: 'lorem_paragraphs', count: Number(loremCount.value) };
    case 'random_item_of_field':
      return { kind: 'random_item_of_field', collectionField: itemOfField.value || 'collection' };
    case 'random_user_collection':
      return { kind: 'random_user_collection' };
    default:
      return s;
  }
}

function coerceValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  const n = Number(raw);
  if (!Number.isNaN(n) && raw.trim() !== '') return n;
  try {
    if (raw.trim().startsWith('{') || raw.trim().startsWith('[')) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return raw;
}

async function onPreview() {
  previewing.value = true;
  previewError.value = null;
  previewValues.value = [];
  try {
    const strategy = buildStrategy();
    const result = await api.preview({
      collection: props.collection,
      strategies: { [props.field.field]: strategy },
      count: 3,
    });
    previewValues.value = result.rows.map((r) => r[props.field.field]);
  } catch (err: any) {
    previewError.value = err?.response?.data?.error ?? err?.message ?? 'Preview failed';
  } finally {
    previewing.value = false;
  }
}

function onSave() {
  emit('save', buildStrategy());
}

function onReset() {
  emit('reset');
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function formatPreview(v: unknown): string {
  if (v === null || v === undefined) return '∅ null';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
</script>

<style scoped>
.strategy-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  width: 380px;
  max-width: 90vw;
}

header h3 {
  margin: 0;
  font-size: 16px;
}

.muted {
  color: var(--theme--foreground-subdued);
  font-size: 12px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-row label {
  font-size: 12px;
  color: var(--theme--foreground-subdued);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

footer {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.spacer {
  flex: 1;
}

.preview-box {
  background: var(--theme--background-subdued);
  border-radius: var(--theme--border-radius);
  padding: 12px;
  font-size: 12px;
}

.preview-box ul {
  margin: 6px 0 0;
  padding-left: 18px;
}

.preview-error {
  color: var(--theme--danger);
  font-size: 12px;
}

.form-hint {
  font-size: 11px;
  color: var(--theme--foreground-subdued);
  margin: 4px 0 0;
  line-height: 1.4;
}
.form-hint code {
  font-family: var(--theme--fonts--monospace--font-family);
  background: var(--theme--background-subdued);
  padding: 1px 4px;
  border-radius: 3px;
}
</style>
