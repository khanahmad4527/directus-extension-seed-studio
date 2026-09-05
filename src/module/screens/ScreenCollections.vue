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

    <!--
      The progress lane keeps its height whether or not the bar is showing.
      Toggling `System` or hitting Reload used to mount the bar and unmount the
      whole grid, so the page collapsed to two rows and snapped back — the
      "whole UI moves" jump. Reserving the space here and keeping the grid
      mounted below means a reload changes nothing but the bar's opacity.
    -->
    <div class="progress-lane" :aria-hidden="!loading">
      <v-progress-linear v-show="loading" indeterminate rounded />
    </div>

    <div v-if="error" class="banner banner-error" role="alert">
      <v-icon name="error" />
      <div>
        <strong>Could not load collections.</strong>
        <p>{{ error }}</p>
      </div>
      <v-button small @click="reload">Retry</v-button>
    </div>

    <!-- First load only: placeholder cards so the grid starts at full height. -->
    <div v-else-if="showSkeleton" class="bento" aria-busy="true">
      <article v-for="n in 6" :key="`skeleton-${n}`" class="card card-skeleton" aria-hidden="true">
        <header class="card-head">
          <span class="card-icon skeleton-block" />
          <div class="card-titles">
            <span class="skeleton-line skeleton-line-title" />
            <span class="skeleton-line skeleton-line-slug" />
          </div>
        </header>
        <dl class="card-stats">
          <div><dt>Fields</dt><dd><span class="skeleton-line skeleton-line-stat" /></dd></div>
          <div><dt>Rows</dt><dd><span class="skeleton-line skeleton-line-stat" /></dd></div>
        </dl>
      </article>
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

    <div v-else class="results" :class="{ 'is-stale': loading }" :aria-busy="loading">
      <div v-if="seedableCollections.length" class="bento">
        <article
          v-for="c in seedableCollections"
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
              <v-icon :name="iconOf(c.collection, c.isSystem ? 'settings' : 'dataset')" />
            </span>
            <div class="card-titles">
              <h3 class="card-title" :title="c.collection">{{ nameOf(c.collection, c.displayName) }}</h3>
              <code class="card-slug">{{ c.collection }}</code>
            </div>
            <span v-if="c.warning" class="card-note" :title="c.warning">
              <v-icon name="info" small />
            </span>
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

          <p v-if="c.warning" class="card-warning">{{ c.warning }}</p>

          <footer class="card-foot">
            <span class="card-cta">
              Generate
              <v-icon name="arrow_forward" small />
            </span>
          </footer>
        </article>
      </div>

      <!--
        Blocked collections are shown rather than hidden: a user who enabled
        System and cannot find directus_migrations deserves to know it was a
        deliberate decision, and why.
      -->
      <section v-if="blockedCollections.length" class="blocked-section">
        <h2 class="blocked-heading">
          <v-icon name="lock" small />
          Not available for seeding
          <span class="blocked-count">{{ blockedCollections.length }}</span>
        </h2>
        <p class="blocked-intro">
          These hold your schema, auth state, or platform records — generated rows would
          corrupt them rather than fill them.
        </p>
        <div class="bento">
          <article
            v-for="c in blockedCollections"
            :key="c.collection"
            class="card card-blocked"
            :aria-label="`${c.displayName} cannot be seeded`"
          >
            <header class="card-head">
              <span class="card-icon">
                <v-icon name="lock" />
              </span>
              <div class="card-titles">
                <h3 class="card-title" :title="c.collection">{{ nameOf(c.collection, c.displayName) }}</h3>
                <code class="card-slug">{{ c.collection }}</code>
              </div>
              <span v-if="c.blockedCategory" class="card-tag">{{ c.blockedCategory }}</span>
            </header>
            <p class="card-reason">{{ c.blockedReason }}</p>
          </article>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useCollectionName } from '../composables/useCollectionName';
import { useSeedApi, type CollectionSummary } from '../composables/useSeedApi';

const emit = defineEmits<{ (e: 'selected', collection: string): void }>();

const { nameOf, iconOf } = useCollectionName();
const api = useSeedApi();
const collections = ref<CollectionSummary[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const showSystem = ref(false);
const search = ref('');
/** True until the first response lands, so reloads never show the skeleton. */
const firstLoad = ref(true);

const showSkeleton = computed(() => loading.value && firstLoad.value);

const filteredCollections = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return collections.value;
  return collections.value.filter(
    (c) =>
      c.collection.toLowerCase().includes(q) ||
      c.displayName.toLowerCase().includes(q)
  );
});

const seedableCollections = computed(() =>
  filteredCollections.value.filter((c) => c.seedable !== false)
);
const blockedCollections = computed(() =>
  filteredCollections.value.filter((c) => c.seedable === false)
);

async function reload() {
  loading.value = true;
  error.value = null;
  try {
    collections.value = await api.listCollections(showSystem.value);
  } catch (err: any) {
    error.value = err?.response?.data?.error ?? err?.message ?? 'Failed to load collections';
  } finally {
    loading.value = false;
    firstLoad.value = false;
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

/* ─── Progress lane ─────────────────────────────────────
   Height is reserved unconditionally. `v-show` (not `v-if`) keeps the bar in
   the layout so nothing below it shifts when a reload starts or finishes. */
.progress-lane {
  height: 4px;
  flex-shrink: 0;
  margin-top: -12px;
}

/* A reload keeps the previous results on screen; dimming is the only cue, so
   the grid never collapses and springs back. */
.results {
  display: flex;
  flex-direction: column;
  gap: 32px;
  transition: opacity 150ms ease;
}
.results.is-stale {
  opacity: 0.55;
  /* Stale rows must not be clickable — the list is about to be replaced. */
  pointer-events: none;
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
  flex-wrap: wrap;
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
  /*
   * Wide enough for the longest system slug (`directus_deployment_projects`).
   * Without a floor the category tag beside it squeezes this column and the
   * monospace slug breaks mid-word — `directus_deploym / ents`. With one, the
   * tag wraps to its own line instead, which costs a few pixels of height on
   * long names only.
   */
  min-width: 176px;
}

/*
 * These wrap rather than clip. Truncating both lines made
 * `directus_deployment_projects` and `directus_deployment_runs` render as an
 * identical "Deployment …" / `directus_deploy…` pair — the one thing a card
 * has to get across is which collection it is.
 */
.card-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 2px;
  color: var(--theme--foreground);
  overflow-wrap: anywhere;
}

.card-slug {
  font-family: var(--theme--fonts--monospace--font-family);
  font-size: 11px;
  color: var(--theme--foreground-subdued);
  display: block;
  overflow-wrap: anywhere;
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

.card-note {
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  color: var(--theme--warning);
  cursor: help;
}
.card-note :deep(.v-icon) {
  --v-icon-color: var(--theme--warning);
}

.card-warning {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--theme--foreground-subdued);
  padding-left: 10px;
  border-left: 2px solid var(--theme--warning);
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

/* ─── Blocked collections ───────────────────────────── */
.blocked-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.blocked-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: var(--theme--foreground-subdued);
}
.blocked-heading :deep(.v-icon) {
  --v-icon-color: var(--theme--foreground-subdued);
}

.blocked-count {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--theme--foreground) 12%, transparent);
  letter-spacing: 0;
}

.blocked-intro {
  margin: 0;
  max-width: 70ch;
  font-size: 13px;
  color: var(--theme--foreground-subdued);
}

.card-blocked {
  cursor: not-allowed;
  gap: 12px;
  background: transparent;
  border-style: dashed;
}
.card-blocked:hover,
.card-blocked:focus-visible {
  /* Blocked cards are inert: no affordance on hover. */
  border-color: var(--theme--border-color);
  background: transparent;
}
.card-blocked .card-icon {
  background: color-mix(in srgb, var(--theme--foreground) 8%, transparent);
}
.card-blocked .card-icon :deep(.v-icon) {
  --v-icon-color: var(--theme--foreground-subdued);
}
.card-blocked .card-title {
  color: var(--theme--foreground-subdued);
}

.card-reason {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--theme--foreground-subdued);
}

/* ─── First-load skeleton ───────────────────────────── */
.card-skeleton {
  cursor: default;
}
.card-skeleton:hover {
  border-color: var(--theme--border-color);
  background: var(--theme--background-subdued);
}
.skeleton-block,
.skeleton-line {
  display: block;
  background: color-mix(in srgb, var(--theme--foreground) 10%, transparent);
  border-radius: 4px;
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}
.skeleton-line-title {
  height: 13px;
  width: 65%;
  margin-bottom: 6px;
}
.skeleton-line-slug {
  height: 10px;
  width: 45%;
}
.skeleton-line-stat {
  height: 18px;
  width: 40px;
}

@keyframes skeleton-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}

@media (prefers-reduced-motion: reduce) {
  .card,
  .card-cta,
  .results {
    transition: none;
  }
  .skeleton-block,
  .skeleton-line {
    animation: none;
  }
}
</style>
