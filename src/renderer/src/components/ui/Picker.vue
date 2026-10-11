<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import Icon from './Icon.vue';
import type { Option } from './types';

/**
 * Searchable single-select (clients, projects, accounts, plans). `load` is
 * called with the query; results rise in. Keyboard: ↑ ↓ Enter Esc.
 */
const props = withDefaults(defineProps<{ modelValue: string | null | undefined; options?: Option[]; load?: (q: string) => Promise<Option[]>; placeholder?: string; clearable?: boolean; disabled?: boolean; selectedLabel?: string | null; create?: string; id?: string }>(), { placeholder: 'Choose…', clearable: true });
const emit = defineEmits<{ 'update:modelValue': [v: string | null]; pick: [o: Option | null]; create: [q: string] }>();
const open = ref(false);
const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const q = ref('');
const list = ref<Option[]>(props.options ?? []);
const active = ref(0);
const loading = ref(false);
const root = ref<HTMLElement | null>(null);
const input = ref<HTMLInputElement | null>(null);
const known = ref<Option | null>(null);
const current = computed(() => (props.options ?? list.value).find(o => o.value === props.modelValue) ?? (known.value?.value === props.modelValue ? known.value : null));
const shownLabel = computed(() => current.value?.label ?? props.selectedLabel ?? '');
const filtered = computed(() => {
  if (props.load) return list.value;
  const t = q.value.trim().toLowerCase();
  const src = props.options ?? [];
  return t ? src.filter(o => `${o.label} ${o.sub ?? ''}`.toLowerCase().includes(t)) : src;
});
let timer = 0;
watch(q, v => {
  active.value = 0;
  if (!props.load) return;
  clearTimeout(timer);
  timer = window.setTimeout(async () => { loading.value = true; try { list.value = await props.load!(v); } finally { loading.value = false; } }, 160);
});
watch(() => props.options, o => { if (o) list.value = o; });
async function show() {
  if (props.disabled) return;
  open.value = true; q.value = '';
  if (props.load) { loading.value = !list.value.length; try { list.value = await props.load(''); } finally { loading.value = false; } }
  // A phone keyboard would cover the list it is meant to search — there the list shows first
  // and the search field is one tap away.
  if (!touch) setTimeout(() => input.value?.focus(), 20);
}
function pick(o: Option | null) { known.value = o; emit('update:modelValue', o?.value ?? null); emit('pick', o); open.value = false; }
function key(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') { e.preventDefault(); active.value = Math.min(filtered.value.length - 1, active.value + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); active.value = Math.max(0, active.value - 1); }
  else if (e.key === 'Enter') { e.preventDefault(); const o = filtered.value[active.value]; if (o) pick(o); else if (props.create && q.value.trim()) { emit('create', q.value.trim()); open.value = false; } }
  else if (e.key === 'Escape') { e.stopPropagation(); open.value = false; }
}
// The popover is teleported to <body> and positioned against the trigger, so no
// animated/overflowing ancestor (modals, staggered grids) can clip or cover it.
const popEl = ref<HTMLElement | null>(null);
const pos = ref({ top: 0, left: 0, width: 0, up: false });
function place() {
  const r = root.value?.getBoundingClientRect();
  if (!r) return;
  const up = r.bottom + 340 > window.innerHeight && r.top > 360;
  const vw = document.documentElement.clientWidth;
  const width = Math.min(Math.max(r.width, 260), vw - 16);
  pos.value = { top: up ? r.top - 6 : r.bottom + 6, left: Math.max(8, Math.min(r.left, vw - 8 - width)), width, up };
}
const outside = (e: MouseEvent) => { const t = e.target as Node; if (root.value?.contains(t) || popEl.value?.contains(t)) return; open.value = false; };
watch(open, o => {
  if (o) { place(); setTimeout(() => document.addEventListener('mousedown', outside), 0); window.addEventListener('scroll', place, true); window.addEventListener('resize', place); }
  else { document.removeEventListener('mousedown', outside); window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); }
});
onBeforeUnmount(() => { document.removeEventListener('mousedown', outside); window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); });
</script>

<template>
  <div ref="root" class="picker" :class="{ open, disabled }">
    <button :id="id" type="button" class="trigger input" :disabled="disabled" @click="open ? (open = false) : show()">
      <span v-if="shownLabel" class="val ellipsis">{{ shownLabel }}</span>
      <span v-else class="ph">{{ placeholder }}</span>
      <span v-if="clearable && modelValue" class="clr" role="button" aria-label="Clear" @click.stop="pick(null)"><Icon name="close" :size="13" /></span>
      <Icon name="chevron-down" :size="14" class="chev" />
    </button>
    <Teleport to="body">
    <Transition name="pop">
      <div v-if="open" ref="popEl" class="ff-picker-pop" :class="{ up: pos.up }" :style="{ top: `${pos.top}px`, left: `${pos.left}px`, width: `${pos.width}px` }">
        <div class="search"><Icon name="search" :size="15" /><input ref="input" v-model="q" placeholder="Search…" @keydown="key" /><span v-if="loading" class="spin" /></div>
        <ul class="opts">
          <li v-for="(o, i) in filtered" :key="o.value" :class="{ act: i === active, sel: o.value === modelValue }" :style="{ '--i': Math.min(i, 10) }" @mouseenter="active = i" @mousedown.prevent="pick(o)">
            <div class="grow"><div class="ellipsis">{{ o.label }}</div><div v-if="o.sub" class="sub ellipsis">{{ o.sub }}</div></div>
            <Icon v-if="o.value === modelValue" name="check" :size="14" />
          </li>
          <li v-if="!filtered.length && !loading" class="none">{{ q ? 'No matches' : 'Nothing to choose yet' }}</li>
          <li v-if="create && q.trim()" class="create" @mousedown.prevent="emit('create', q.trim()); open = false"><Icon name="plus" :size="14" /> {{ create }} “{{ q.trim() }}”</li>
        </ul>
      </div>
    </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.picker { position: relative; }
.trigger { display: flex; align-items: center; gap: 8px; text-align: left; cursor: pointer; }
.val { flex: 1; } .ph { flex: 1; color: var(--faint); }
.chev { color: var(--muted); transition: transform 300ms var(--ease-out); }
.open .chev { transform: rotate(180deg); }
.open .trigger { border-color: var(--focus-border); box-shadow: var(--focus-ring); }
.clr { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; color: var(--muted); }
.clr:hover { background: var(--panel-2); color: var(--fg); }
.ff-picker-pop { position: fixed; z-index: 1100; border-radius: 10px; background: var(--panel); border: 1px solid var(--line); box-shadow: var(--shadow-2); overflow: hidden; }
.ff-picker-pop.up { transform: translateY(-100%); }
.search { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--line); color: var(--muted); }
.search input { flex: 1; border: 0; background: none; outline: none; color: var(--fg); font-size: var(--fs-base); }
.search input:focus, .search input:focus-visible { outline: none; box-shadow: none; }
.opts { max-height: 280px; overflow-y: auto; padding: 5px; }
li { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 6px; cursor: pointer; font-size: var(--fs-base); animation: ff-rise .3s var(--ease-out) backwards; animation-delay: calc(var(--i) * 14ms); }
li.act { background: var(--panel-2); }
li.sel { font-weight: 600; }
.sub { font-size: var(--fs-xs); color: var(--muted); }
.none { color: var(--muted); cursor: default; }
.create { color: var(--fg); font-weight: 500; border-top: 1px solid var(--line-soft); margin-top: 4px; }
.spin { width: 13px; height: 13px; border-radius: 50%; border: 1.5px solid currentColor; border-right-color: transparent; animation: ff-spin .7s linear infinite; }
.disabled { opacity: .6; }
@media (pointer: coarse) { li { padding: 11px 12px; font-size: var(--fs-base); } .opts { max-height: min(320px, 45vh); } }
</style>
