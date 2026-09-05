<template>
  <div class="progress-bar">
    <v-progress-linear :value="percent" rounded />
    <span class="percent">{{ percent }}%</span>
  </div>
</template>

<script setup lang="ts">
defineProps<{ percent: number }>();
</script>

<style scoped>
.progress-bar {
  display: flex;
  align-items: center;
  gap: 12px;
}

.percent {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
</style>
