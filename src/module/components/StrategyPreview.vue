<template>
  <div class="strategy-preview">
    <strong>Sample values</strong>
    <ul v-if="values.length">
      <li v-for="(v, i) in values" :key="i">{{ format(v) }}</li>
    </ul>
    <p v-else class="muted">No samples generated yet.</p>
  </div>
</template>

<script setup lang="ts">
defineProps<{ values: unknown[] }>();

function format(v: unknown): string {
  if (v === null || v === undefined) return '∅ null';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
</script>

<style scoped>
.strategy-preview {
  background: var(--theme--background-subdued);
  border-radius: var(--theme--border-radius);
  padding: 12px;
  font-size: 12px;
}

.strategy-preview ul {
  margin: 6px 0 0;
  padding-left: 18px;
}

.muted {
  color: var(--theme--foreground-subdued);
  margin: 6px 0 0;
}
</style>
