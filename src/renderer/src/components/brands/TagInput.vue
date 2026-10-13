<script setup lang="ts">
import { computed, ref } from 'vue';
import Icon from '@/components/ui/Icon.vue';

/**
 * Tags as chips. Type and press Enter or comma to add; Backspace on an empty field removes the
 * last; suggestions (existing tags) appear while typing and with ↓.
 */
const props = withDefaults(defineProps<{ modelValue: string[]; suggestions?: string[]; placeholder?: string; id?: string }>(), { suggestions: () => [], placeholder: 'Add a tag…' });
const emit = defineEmits<{ 'update:modelValue': [v: string[]] }>();
const q = ref('');
const focused = ref(false);
const active = ref(0);
const input = ref<HTMLInputElement | null>(null);
const has = (t: string) => props.modelValue.some(x => x.toLowerCase() === t.toLowerCase());
const shown = computed(() => {
  const s = q.value.trim().toLowerCase().replace(/^#/, '');
  return props.suggestions.filter(t => !has(t) && (!s || t.toLowerCase().includes(s))).slice(0, 8);
});
function add(t: string) {
  const v = t.trim().replace(/^#/, '').replace(/,$/, '').trim();
  if (v && !has(v)) emit('update:modelValue', [...props.modelValue, v]);
  q.value = '';
  active.value = 0;
}
function removeAt(i: number) { emit('update:modelValue', props.modelValue.filter((_, j) => j !== i)); input.value?.focus(); }
function key(e: KeyboardEvent) {
  const list = focused.value && listOpen.value && shown.value.length > 0;
  if (e.key === 'ArrowDown' && list) {
    e.preventDefault();
    if (!pickedByArrow.value) { pickedByArrow.value = true; active.value = 0; } else active.value = Math.min(shown.value.length - 1, active.value + 1);
  } else if (e.key === 'ArrowUp' && list && pickedByArrow.value) { e.preventDefault(); active.value = Math.max(0, active.value - 1); }
  else if (e.key === 'Enter' || e.key === ',' || (e.key === 'Tab' && q.value.trim())) {
    const pick = list && pickedByArrow.value ? shown.value[active.value] : null;
    if (!pick && !q.value.trim()) { if (e.key === ',') e.preventDefault(); return; }
    e.preventDefault();
    add(pick ?? q.value);
  } else if (e.key === 'Backspace' && !q.value && props.modelValue.length) removeAt(props.modelValue.length - 1);
  else if (e.key === 'Escape' && list) { e.stopPropagation(); listOpen.value = false; }
}
const listOpen = ref(true);
const pickedByArrow = ref(false);
function onInput() { listOpen.value = true; pickedByArrow.value = false; active.value = 0; }
</script>

<template>
  <div class="ti" :class="{ focused }" @click="input?.focus()">
    <TransitionGroup name="list">
      <span v-for="(t, i) in modelValue" :key="t" class="tag">
        <span class="ellipsis">{{ t }}</span>
        <button type="button" class="x" :aria-label="`Remove ${t}`" @click.stop="removeAt(i)"><Icon name="close" :size="11" /></button>
      </span>
    </TransitionGroup>
    <input :id="id" ref="input" v-model="q" :placeholder="modelValue.length ? '' : placeholder" autocomplete="off" spellcheck="false"
      @keydown="key" @input="onInput" @focus="focused = true" @blur="focused = false; q.trim() && add(q)" />
    <Transition name="pop">
      <ul v-if="focused && listOpen && shown.length" class="sugg" role="listbox">
        <li v-for="(t, i) in shown" :key="t" role="option" :aria-selected="i === active && pickedByArrow" :class="{ act: i === active && pickedByArrow }" @mousedown.prevent="add(t)" @mouseenter="active = i; pickedByArrow = true">
          <Icon name="tag" :size="13" /><span>{{ t }}</span>
        </li>
      </ul>
    </Transition>
  </div>
</template>

<style scoped>
/* one line at the height of the inputs beside it (40px); it grows a line at a time as tags wrap */
.ti { position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; min-height: 40px; padding: 4px 8px; border-radius: var(--r); background: var(--panel); border: 1px solid var(--line); cursor: text; transition: border-color var(--t-micro), box-shadow var(--t-micro); }
.ti:hover { border-color: var(--line-strong); }
.ti.focused { border-color: var(--focus-border); box-shadow: var(--focus-ring); }
.tag { display: inline-flex; align-items: center; gap: 4px; max-width: 220px; height: 24px; padding: 0 4px 0 9px; border-radius: var(--r-pill); background: var(--panel-2); font-size: var(--fs-sm); font-weight: 500; }
.x { width: 18px; height: 18px; display: grid; place-items: center; border-radius: 50%; color: var(--muted); }
.x:hover { background: var(--line); color: var(--fg); }
input { flex: 1; min-width: 90px; height: 30px; border: 0; background: none; outline: none; padding: 0 4px; font-size: var(--fs-base); color: var(--fg); }
input:focus, input:focus-visible { outline: none; box-shadow: none; }
input::placeholder { color: var(--faint); }
.sugg { position: absolute; top: calc(100% + 6px); left: 0; z-index: 50; min-width: 220px; max-height: 240px; overflow-y: auto; padding: 5px; border-radius: 10px; background: var(--panel); border: 1px solid var(--line); box-shadow: var(--shadow-2); }
.sugg li { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 6px; cursor: pointer; font-size: var(--fs-base); color: var(--fg-2); }
.sugg li .icon { color: var(--muted); }
.sugg li.act { background: var(--panel-2); color: var(--fg); }
</style>
