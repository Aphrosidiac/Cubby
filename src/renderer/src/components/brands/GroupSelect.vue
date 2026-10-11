<script setup lang="ts">
import { computed } from 'vue';
import Select, { type SelectOption } from '@/components/ui/Select.vue';
import { api } from '@/lib/api';
import { useLoad } from '@/composables/useLoad';
import { confirm } from '@/composables/confirm';
import { fail } from '@/composables/toast';
import { GROUP_COLORS } from './filter';

/** Group dropdown with "New group…" at the bottom (asks for a name, creates it, selects it). */
const props = withDefaults(defineProps<{ modelValue: string | null | undefined; variant?: 'field' | 'pill' | 'sm'; noneLabel?: string; id?: string }>(), { variant: 'field', noneLabel: 'No group' });
const emit = defineEmits<{ 'update:modelValue': [v: string | null] }>();
const { data } = useLoad(() => api('groups.list'), { topics: ['brands.changed'] });
const NEW = '__new__';
const options = computed<SelectOption[]>(() => [
  { value: null, label: props.noneLabel },
  ...(data.value ?? []).map(g => ({ value: g.id, label: g.name, sub: `${g.count} brand${g.count === 1 ? '' : 's'}` })),
  { value: NEW, label: '+ New group…' }
]);
async function pick(v: string | null) {
  if (v !== NEW) { emit('update:modelValue', v); return; }
  const name = await confirm({ title: 'New group', confirm: 'Create group', input: { label: 'Name', placeholder: 'Clients, Personal, Ascend…' } });
  if (!name) return;
  try { const g = await api('groups.create', { name, color: GROUP_COLORS[(data.value?.length ?? 0) % GROUP_COLORS.length] }); emit('update:modelValue', g.id); } catch (e) { fail(e, 'Could not create the group'); }
}
</script>

<template>
  <Select :id="id" :model-value="modelValue ?? null" :options="options" :variant="variant" aria-label="Group" @update:model-value="pick" />
</template>
