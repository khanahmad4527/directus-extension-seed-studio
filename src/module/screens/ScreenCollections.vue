<template>
  <section class="screen">
    <header class="screen-header">
      <div>
        <h1 class="screen-title">Pick a collection</h1>
        <p class="screen-subtitle">Choose where to write realistic test data.</p>
      </div>
      <div class="screen-tools">
        <v-input
          v-model="search"
          class="search-input"
          placeholder="Search collections…"
          :small="true"
        >
          <template #prepend>
            <v-icon name="search" small />
          </template>
        </v-input>
        <v-checkbox v-model="showSystem" label="System" />
        <v-button secondary small :loading="loading" @click="reload">
          <v-icon name="refresh" left small />
          Reload
        </v-button>
      </div>
    </header>

    <v-progress-linear v-if="loading" indeterminate rounded />

    <div v-else-if="error" class="banner banner-error" role="alert">
      <v-icon name="error" />
      <div>
        <strong>Could not load collections.</strong>
        <p>{{ error }}</p>
      </div>
      <v-button small @click="reload">Retry</v-button>
    </div>

    <div v-else-if="!collections.length" class="banner banner-empty">
      <v-icon name="inbox" large />
      <div>
        <strong>No collections yet.</strong>
        <p>Create a collection in Directus first, then come back here.</p>
      </div>
    </div>

    <div v-else-if="!filteredCollections.length" class="banner banner-empty">
      <v-icon name="search_off" />
      <div>
        <strong>No matches for "{{ search }}".</strong>
        <p>Clear the search to see all collections.</p>
      </div>
    </div>

    <div v-else class="bento">
      <article
        v-for="c in filteredCollections"
        :key="c.collection"
        class="card"
        :class="{ 'card-system': c.isSystem }"
        tabindex="0"
        role="button"
        :aria-label="`Select ${c.displayName}`"
        @click="select(c.collection)"
        @keydown.enter="select(c.collection)"
        @keydown.space.prevent="select(c.collection)"
      >
        <header class="card-head">
          <span class="card-icon">
            <v-icon :name="c.isSystem ? 'settings' : 'dataset'" />
          </span>
          <div class="card-titles">
            <h3 class="card-title">{{ c.displayName }}</h3>
            <code class="card-slug">{{ c.collection }}</code>
          </div>
          <span v-if="c.isSystem" class="card-tag">system</span>
        </header>

        <dl class="card-stats">
          <div>
            <dt>Fields</dt>
            <dd>{{ c.fieldCount }}</dd>
          </div>
          <div>
            <dt>Rows</dt>
            <dd>{{ c.rowCount.toLocaleString() }}</dd>
          </div>
        </dl>

        <footer class="card-foot">
          <span class="card-cta">
            Generate
            <v-icon name="arrow_forward" small />
          </span>
        </footer>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useSeedApi, type CollectionSummary } from '../composables/useSeedApi';

const emit = defineEmits<{ (e: 'selected', collection: string): void }>();

const api = useSeedApi();
const collections = ref<CollectionSummary[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const showSystem = ref(false);
const search = ref('');

const filteredCollections = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return collections.value;
  return collections.value.filter(
    (c) =>
      c.collection.toLowerCase().includes(q) ||
      c.displayName.toLowerCase().includes(q)
  );
});

async function reload() {
  loading.value = true;
  error.value = null;
  try {
    collections.value = await api.listCollections(showSystem.value);
  } catch (err: any) {
    error.value = err?.response?.data?.error ?? err?.message ?? 'Failed to load collections';
  } finally {
    loading.value = false;
  }
}

function select(name: string) {
  emit('selected', name);
}

onMounted(reload);
watch(showSystem, reload);
</script>

<style scoped>
.screen {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.screen-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 24px;
  flex-wrap: wrap;
}

.screen-title {
  font-size: 32px;
  font-weight: 700;
  margin: 0;
  letter-spacing: -0.02em;
  color: var(--theme--foreground);
}

.screen-subtitle {
  margin: 8px 0 0;
  font-size: 15px;
  color: var(--theme--foreground-subdued);
}

.screen-tools {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.search-input {
  min-width: 240px;
  max-width: 320px;
}

/* ─── Banners ────────────────────────────────────────── */
.banner {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 24px;
  background: var(--theme--background-subdued);
  border: 1px solid var(--theme--border-color);
  border-radius: var(--theme--border-radius);
}
.banner > div {
  flex: 1;
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
.banner-error {
  border-left: 3px solid var(--theme--danger);
  color: var(--theme--danger);
}
.banner-error p {
  color: var(--theme--danger);
  opacity: 0.85;
}
.banner-empty {
  border-left: 3px solid var(--theme--primary);
}

/* ─── Bento grid ────────────────────────────────────── */
.bento {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}

.card {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px;
  background: var(--theme--background-subdued);
  border: 1px solid var(--theme--border-color);
  border-radius: var(--theme--border-radius);
  cursor: pointer;
  transition: border-color 150ms ease, background-color 150ms ease;
}

.card:hover,
.card:focus-visible {
  border-color: var(--theme--primary);
  background: var(--theme--background);
  outline: none;
}

.card-system {
  opacity: 0.85;
}

.card-tag {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  padding: 3px 8px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--theme--foreground) 12%, transparent);
  color: var(--theme--foreground-subdued);
  flex-shrink: 0;
  align-self: flex-start;
}

.card-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.card-icon {
  display: inline-grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--theme--primary-background);
  color: var(--theme--primary);
  flex-shrink: 0;
}
.card-icon :deep(.v-icon) {
  --v-icon-color: var(--theme--primary);
}
.card-system .card-icon {
  background: var(--theme--background);
  color: var(--theme--foreground-subdued);
}
.card-system .card-icon :deep(.v-icon) {
  --v-icon-color: var(--theme--foreground-subdued);
}

.card-titles {
  flex: 1;
  min-width: 0;
}

.card-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 2px;
  color: var(--theme--foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-slug {
  font-family: var(--theme--fonts--monospace--font-family);
  font-size: 11px;
  color: var(--theme--foreground-subdued);
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-stats {
  display: flex;
  gap: 24px;
  margin: 0;
}

.card-stats div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.card-stats dt {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--theme--foreground-subdued);
  margin: 0;
}

.card-stats dd {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--theme--foreground);
  line-height: 1;
}

.card-foot {
  margin-top: auto;
  display: flex;
  justify-content: flex-end;
}

.card-cta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--theme--primary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  opacity: 0.6;
  transition: opacity 150ms ease;
}
.card-cta :deep(.v-icon) {
  --v-icon-color: var(--theme--primary);
}
.card:hover .card-cta,
.card:focus-visible .card-cta {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  .card,
  .card-cta {
    transition: none;
  }
}
</style>
