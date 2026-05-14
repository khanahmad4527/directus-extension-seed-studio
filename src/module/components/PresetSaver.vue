<template>
  <div class="preset-saver">
    <v-checkbox v-model="enabled" label="Save as preset" />
    <v-input v-if="enabled" v-model="name" placeholder="Preset name" />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{ modelValue: boolean; presetName: string }>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'update:presetName', value: string): void;
}>();

const enabled = ref(props.modelValue);
const name = ref(props.presetName);

watch(enabled, (v) => emit('update:modelValue', v));
watch(name, (v) => emit('update:presetName', v));
watch(() => props.modelValue, (v) => (enabled.value = v));
watch(() => props.presetName, (v) => (name.value = v));
</script>

<style scoped>
.preset-saver {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
