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

    <div v-if="local.kind === 'template'" class="form-row">
      <label>Template</label>
      <v-input v-model="templateText" :placeholder="templatePlaceholder" />
      <p v-pre class="form-hint">
        Mix values from this row's entity, faker, and other fields:
        <code>{{person.firstName}}</code>,
        <code>{{row.title | slug}}</code>,
        <code>{{pick(a,b,c)}}</code>,
        <code>{{int(1,5)}}</code>,
        <code>{{seq | pad:5}}</code>.
      </p>
    </div>

    <div v-if="local.kind === 'coherent'" class="form-row">
      <label>Entity trait</label>
      <v-select :model-value="coherentTrait" :items="traitOptions" @update:model-value="(v) => (coherentTrait = v)" />
      <p class="form-hint">
        Drawn from the row's single imaginary person/company/product, so related fields agree with each other.
      </p>
    </div>

    <div v-if="local.kind === 'weighted_choice'" class="form-row">
      <label>Weighted choices</label>
      <v-input v-model="weightedText" placeholder="published:60, draft:25, archived:8" />
      <p class="form-hint">
        <code>value:weight</code> pairs. Higher weight means the value appears more often.
      </p>
    </div>

    <div v-if="local.kind === 'regex'" class="form-row">
      <label>Pattern</label>
      <v-input v-model="regexPattern" placeholder="^INV-[0-9]{5}$" />
      <p class="form-hint">Generates values that match this regular expression.</p>
    </div>

    <template v-if="local.kind === 'geometry'">
      <div class="form-row">
        <label>Geometry type</label>
        <v-select
          :model-value="geometryType"
          :items="geometryOptions"
          @update:model-value="(v) => (geometryType = v)"
        />
      </div>
      <div class="form-row">
        <label>Bounding box (minLng, minLat, maxLng, maxLat)</label>
        <v-input v-model="bboxText" placeholder="-122.6, 37.5, -122.2, 37.9" />
        <p class="form-hint">Leave empty for a default box. Coordinates are generated inside it.</p>
      </div>
    </template>

    <div v-if="local.kind === 'markdown' || local.kind === 'html'" class="form-row">
      <label>Paragraphs</label>
      <v-input type="number" v-model="richParagraphs" />
      <p class="form-hint">
        Produces headings, lists and paragraphs — not one undifferentiated block of lorem.
      </p>
    </div>

    <template v-if="local.kind === 'm2m_random'">
      <div class="form-row">
        <label>Minimum links per row</label>
        <v-input type="number" v-model="m2mMin" />
      </div>
      <div class="form-row">
        <label>Maximum links per row</label>
        <v-input type="number" v-model="m2mMax" />
        <p class="form-hint">
          Junction rows are written after the parent rows exist. Most rows get few links and a
          handful get many, the way real tagging looks.
        </p>
      </div>
    </template>

    <div v-if="supportsNullRate" class="form-row">
      <label>Leave empty (% of rows)</label>
      <v-input type="number" v-model="nullRatePercent" :disabled="field.required" />
      <p class="form-hint">
        <template v-if="field.required">This field is required, so it must always have a value.</template>
        <template v-else>Real tables are not 100% populated. 0 fills every row.</template>
      </p>
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
const templateText = ref('');
const coherentTrait = ref('content.title');
const weightedText = ref('published:60, draft:25, archived:8');
const regexPattern = ref('^[A-Z]{3}-[0-9]{5}$');
const geometryType = ref('Point');
const bboxText = ref('');
const richParagraphs = ref('3');
const m2mMin = ref('0');
const m2mMax = ref('4');
const nullRatePercent = ref('0');
/** Kept out of the template: Vue's parser treats `{{ }}` in markup as an interpolation. */
const templatePlaceholder = '{{person.firstName}} at {{company.name}}';

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
  if (s.kind === 'template') templateText.value = s.template;
  if (s.kind === 'coherent') coherentTrait.value = s.trait;
  if (s.kind === 'weighted_choice') {
    weightedText.value = s.choices.map((c) => `${String(c.value)}:${c.weight}`).join(', ');
  }
  if (s.kind === 'regex') regexPattern.value = s.pattern;
  if (s.kind === 'geometry') {
    geometryType.value = s.geometryType ?? 'Point';
    bboxText.value = s.bbox ? s.bbox.join(', ') : '';
  }
  if (s.kind === 'markdown' || s.kind === 'html') richParagraphs.value = String(s.paragraphs ?? 3);
  if (s.kind === 'm2m_random') {
    m2mMin.value = String(s.min);
    m2mMax.value = String(s.max);
  }
  nullRatePercent.value = String(Math.round((s.nullRate ?? 0) * 100));
}

/** Kinds where "sometimes leave this empty" is meaningful. */
const NO_NULL_RATE_KINDS = new Set(['system', 'skip', 'null', 'm2m_random']);
const supportsNullRate = computed(() => !NO_NULL_RATE_KINDS.has(local.value.kind));

const traitOptions = [
  { text: 'Person · first name', value: 'person.firstName' },
  { text: 'Person · last name', value: 'person.lastName' },
  { text: 'Person · full name', value: 'person.fullName' },
  { text: 'Person · job title', value: 'person.jobTitle' },
  { text: 'Person · bio', value: 'person.bio' },
  { text: 'Person · birthdate', value: 'person.birthdate' },
  { text: 'Person · avatar URL', value: 'person.avatar' },
  { text: 'Contact · email', value: 'contact.email' },
  { text: 'Contact · work email', value: 'contact.workEmail' },
  { text: 'Contact · username', value: 'contact.username' },
  { text: 'Contact · phone', value: 'contact.phone' },
  { text: 'Contact · website', value: 'contact.website' },
  { text: 'Company · name', value: 'company.name' },
  { text: 'Company · domain', value: 'company.domain' },
  { text: 'Company · catchphrase', value: 'company.catchPhrase' },
  { text: 'Location · street', value: 'location.street' },
  { text: 'Location · city', value: 'location.city' },
  { text: 'Location · state', value: 'location.state' },
  { text: 'Location · country', value: 'location.country' },
  { text: 'Location · zip', value: 'location.zip' },
  { text: 'Location · latitude', value: 'location.latitude' },
  { text: 'Location · longitude', value: 'location.longitude' },
  { text: 'Content · title', value: 'content.title' },
  { text: 'Content · slug', value: 'content.slug' },
  { text: 'Content · excerpt', value: 'content.excerpt' },
  { text: 'Content · body', value: 'content.body' },
  { text: 'Content · body (HTML)', value: 'content.bodyHtml' },
  { text: 'Content · tags', value: 'content.tags' },
  { text: 'Commerce · product name', value: 'commerce.productName' },
  { text: 'Commerce · SKU', value: 'commerce.sku' },
  { text: 'Commerce · price', value: 'commerce.price' },
  { text: 'Commerce · cost', value: 'commerce.cost' },
  { text: 'Commerce · sale price', value: 'commerce.salePrice' },
  { text: 'Commerce · currency', value: 'commerce.currency' },
  { text: 'Time · created', value: 'time.created' },
  { text: 'Time · updated', value: 'time.updated' },
];

const geometryOptions = [
  { text: 'Point', value: 'Point' },
  { text: 'MultiPoint', value: 'MultiPoint' },
  { text: 'LineString', value: 'LineString' },
  { text: 'MultiLineString', value: 'MultiLineString' },
  { text: 'Polygon', value: 'Polygon' },
  { text: 'MultiPolygon', value: 'MultiPolygon' },
];

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
  { text: 'Coherent (row entity)', value: 'coherent' },
  { text: 'Template', value: 'template' },
  { text: 'Weighted choice', value: 'weighted_choice' },
  { text: 'Regex pattern', value: 'regex' },
  { text: 'Geometry (GeoJSON)', value: 'geometry' },
  { text: 'Markdown body', value: 'markdown' },
  { text: 'HTML body', value: 'html' },
  { text: 'Random links (M2M)', value: 'm2m_random' },
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
    case 'coherent':
      return { kind: 'coherent', trait: 'content.title' };
    case 'template':
      return { kind: 'template', template: '{{content.title}}' };
    case 'weighted_choice':
      return {
        kind: 'weighted_choice',
        choices: [
          { value: 'published', weight: 60 },
          { value: 'draft', weight: 25 },
          { value: 'archived', weight: 8 },
        ],
      };
    case 'regex':
      return { kind: 'regex', pattern: '^[A-Z]{3}-[0-9]{5}$' };
    case 'geometry':
      return { kind: 'geometry', geometryType: props.field.options?.geometryType ?? 'Point' };
    case 'markdown':
      return { kind: 'markdown', paragraphs: 3 };
    case 'html':
      return { kind: 'html', paragraphs: 3 };
    case 'm2m_random':
      return { kind: 'm2m_random', min: 0, max: 4 };
  }
}

function onFakerMethodChange(value: string) {
  if (local.value.kind === 'faker') {
    local.value = { kind: 'faker', method: value };
  }
}

function buildStrategy(): GenerationStrategy {
  const strategy = buildBase();
  if (NO_NULL_RATE_KINDS.has(strategy.kind) || props.field.required) return strategy;
  const percent = Number(nullRatePercent.value);
  if (!Number.isFinite(percent) || percent <= 0) return strategy;
  return { ...strategy, nullRate: Math.min(100, percent) / 100 };
}

function buildBase(): GenerationStrategy {
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
    case 'coherent':
      return { kind: 'coherent', trait: coherentTrait.value };
    case 'template':
      return { kind: 'template', template: templateText.value };
    case 'weighted_choice':
      return { kind: 'weighted_choice', choices: parseWeighted(weightedText.value) };
    case 'regex':
      return { kind: 'regex', pattern: regexPattern.value };
    case 'geometry':
      return {
        kind: 'geometry',
        geometryType: geometryType.value,
        bbox: parseBbox(bboxText.value),
      };
    case 'markdown':
      return { kind: 'markdown', paragraphs: Math.max(1, Number(richParagraphs.value) || 3) };
    case 'html':
      return { kind: 'html', paragraphs: Math.max(1, Number(richParagraphs.value) || 3) };
    case 'm2m_random': {
      const min = Math.max(0, Number(m2mMin.value) || 0);
      const max = Math.max(min, Number(m2mMax.value) || min);
      return { kind: 'm2m_random', min, max };
    }
    default:
      return s;
  }
}

function parseWeighted(text: string): Array<{ value: unknown; weight: number }> {
  const out: Array<{ value: unknown; weight: number }> = [];
  for (const part of text.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const separator = trimmed.lastIndexOf(':');
    if (separator === -1) {
      out.push({ value: coerceValue(trimmed), weight: 10 });
      continue;
    }
    const value = coerceValue(trimmed.slice(0, separator).trim());
    const weight = Number(trimmed.slice(separator + 1).trim());
    out.push({ value, weight: Number.isFinite(weight) && weight > 0 ? weight : 10 });
  }
  return out.length > 0 ? out : [{ value: 'alpha', weight: 10 }];
}

function parseBbox(text: string): [number, number, number, number] | undefined {
  const parts = text
    .split(',')
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isFinite(n));
  if (parts.length !== 4) return undefined;
  return [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
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
