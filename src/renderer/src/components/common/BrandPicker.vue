<script setup lang="ts">
import { computed } from 'vue';
import Select, { type SelectOption } from '@/components/ui/Select.vue';
import { api } from '@/lib/api';
import { useLoad } from '@/composables/useLoad';
import { handleText, serialText } from './login';

/** Choose one brand (composer, flows, filters). Searchable by name, serial and handle; stays live. */
const props = withDefaults(defineProps<{ modelValue: string | null; placeholder?: string; variant?: 'field' | 'pill' | 'sm'; disabled?: boolean; allowNone?: string }>(), { placeholder: 'Choose a brand…', variant: 'field' });
const emit = defineEmits<{ 'update:modelValue': [v: string | null]; change: [v: string | null] }>();
const { data } = useLoad(() => api('brands.list', {}), { topics: ['brands.changed'] });
const options = computed<SelectOption[]>(() => [
  ...(props.allowNone ? [{ value: null, label: props.allowNone }] : []),
  ...(data.value ?? []).map(b => ({ value: b.id, label: b.name, sub: [serialText(b.serial), ...b.accounts.map(a => handleText(a.platform, a.handle))].join(' · ') }))
]);
function set(v: string | null) { emit('update:modelValue', v); emit('change', v); }
</script>

<template>
  <Select :model-value="modelValue" :options="options" :placeholder="data ? placeholder : 'Loading brands…'" :variant="variant" :disabled="disabled" searchable aria-label="Brand" @update:model-value="set" />
</template>
