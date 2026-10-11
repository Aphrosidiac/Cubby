<script setup lang="ts">
import { computed, ref } from 'vue';
import type { FlowStep, FlowStepType, RecipeInfo } from '@shared/types';
import Icon from '@/components/ui/Icon.vue';
import Menu from '@/components/ui/Menu.vue';
import StepFields from './StepFields.vue';
import { STEP_META, STEP_ORDER, cloneStep, newStep, stepSummary } from './steps';
import type { MenuItem } from '@/components/ui/types';

/**
 * An ordered list of steps; containers (If exists, Loop over media) draw their own nested list,
 * indented, with their own Add button. Reorder by dragging the handle or with the card menu.
 */
const props = withDefaults(defineProps<{ modelValue: FlowStep[]; errors: Record<string, string>; recipes: RecipeInfo[] | null; depth?: number; addLabel?: string }>(), { depth: 0, addLabel: 'Add step' });
const emit = defineEmits<{ 'update:modelValue': [v: FlowStep[]] }>();
const listId = `l${Math.random().toString(36).slice(2, 8)}`;

const collapsed = ref(new Set<string>());
const toggle = (id: string) => { const s = new Set(collapsed.value); s.has(id) ? s.delete(id) : s.add(id); collapsed.value = s; };
const notes = ref(new Set<string>());

const update = (i: number, s: FlowStep) => { const next = [...props.modelValue]; next[i] = s; emit('update:modelValue', next); };
const remove = (i: number) => emit('update:modelValue', props.modelValue.filter((_, j) => j !== i));
const duplicate = (i: number) => { const next = [...props.modelValue]; next.splice(i + 1, 0, cloneStep(props.modelValue[i])); emit('update:modelValue', next); };
function move(from: number, to: number) {
  if (to < 0 || to >= props.modelValue.length || from === to) return;
  const next = [...props.modelValue];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  emit('update:modelValue', next);
}
function add(type: FlowStepType) {
  const s = newStep(type);
  emit('update:modelValue', [...props.modelValue, s]);
  setTimeout(() => document.querySelector<HTMLElement>(`[data-step="${s.id}"] input, [data-step="${s.id}"] textarea, [data-step="${s.id}"] .trigger`)?.focus(), 60);
}
const addItems = computed<MenuItem[]>(() => {
  const out: MenuItem[] = [];
  let g = '';
  for (const t of STEP_ORDER) {
    const m = STEP_META[t];
    if (props.depth >= 2 && (t === 'if_exists' || t === 'loop_media')) continue; // keep nesting readable
    if (g && m.group !== g) out.push({ divider: true, label: '' });
    g = m.group;
    out.push({ label: m.label, icon: m.icon, run: () => add(t) });
  }
  return out;
});
const cardMenu = (i: number): MenuItem[] => [
  { label: 'Move up', icon: 'arrow-up', run: () => move(i, i - 1), disabled: i === 0, hint: 'Alt ↑' },
  { label: 'Move down', icon: 'arrow-down', run: () => move(i, i + 1), disabled: i === props.modelValue.length - 1, hint: 'Alt ↓' },
  { label: 'Duplicate', icon: 'copy', run: () => duplicate(i) },
  { label: props.modelValue[i].note !== undefined || notes.value.has(props.modelValue[i].id) ? 'Remove note' : 'Add note', icon: 'note', run: () => toggleNote(i) },
  { divider: true, label: '' },
  { label: 'Delete step', icon: 'trash', danger: true, run: () => remove(i) }
];
function toggleNote(i: number) {
  const s = props.modelValue[i];
  const n = new Set(notes.value);
  if (s.note !== undefined || n.has(s.id)) { n.delete(s.id); const c = { ...s }; delete c.note; update(i, c); }
  else n.add(s.id);
  notes.value = n;
}
function cardKey(i: number, e: KeyboardEvent) {
  if (!e.altKey || (e.target as HTMLElement).closest('input,textarea')) return;
  if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); move(i, i - 1); }
  if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); move(i, i + 1); }
}

// drag to reorder within this list (the handle arms dragging so inputs stay selectable)
const armed = ref<string | null>(null);
const from = ref<number | null>(null);
const over = ref<number | null>(null);
function dragStart(i: number, e: DragEvent) {
  e.stopPropagation();
  from.value = i;
  e.dataTransfer?.setData('text/cubby-step', `${listId}:${i}`);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
}
function dragOver(i: number, e: DragEvent) {
  if (from.value === null) return; // a drag from another list or from outside
  e.preventDefault(); e.stopPropagation();
  over.value = i;
}
function drop(i: number, e: DragEvent) {
  const d = e.dataTransfer?.getData('text/cubby-step');
  if (!d || !d.startsWith(`${listId}:`)) return;
  e.preventDefault(); e.stopPropagation();
  move(Number(d.split(':')[1]), i);
  end();
}
function end() { from.value = over.value = null; armed.value = null; }

/** Open/Close brand have no fields: no body unless they carry a note. */
const hasBody = (s: FlowStep) => !['open_brand', 'close_brand'].includes(s.type) || s.note !== undefined || notes.value.has(s.id);
const nested = (s: FlowStep, key: 'then' | 'else' | 'steps', v: FlowStep[]) => ({ ...s, [key]: v }) as FlowStep;
</script>

<template>
  <div class="steps" :class="`d${depth}`">
    <TransitionGroup tag="ol" name="list" class="ol">
      <li v-for="(s, i) in modelValue" :key="s.id" :data-step="s.id" class="card" :class="{ err: !!errors[s.id], dragging: from === i, target: over === i && from !== i && from !== null, below: over === i && from !== null && from < i }"
        :draggable="armed === s.id" @dragstart="dragStart(i, $event)" @dragend="end" @dragover="dragOver(i, $event)" @drop="drop(i, $event)" @keydown="cardKey(i, $event)">
        <header class="hd">
          <span class="handle" title="Drag to reorder" aria-hidden="true" @mousedown="armed = s.id" @mouseup="armed = null"><Icon name="drag" :size="16" :stroke="3" /></span>
          <span class="idx num">{{ i + 1 }}</span>
          <Icon :name="STEP_META[s.type].icon" :size="15" class="ti" />
          <button type="button" class="ttl" :aria-expanded="!collapsed.has(s.id)" @click="toggle(s.id)">
            <span class="strong small">{{ STEP_META[s.type].label }}</span>
            <span v-if="collapsed.has(s.id) || ['open_brand', 'close_brand'].includes(s.type)" class="sum tiny muted ellipsis">{{ stepSummary(s) }}</span>
          </button>
          <span v-if="errors[s.id]" class="edot" :title="errors[s.id]" />
          <span v-if="!hasBody(s)" class="ib-sp" />
          <button v-else type="button" class="ib" :aria-label="collapsed.has(s.id) ? 'Expand step' : 'Collapse step'" :title="collapsed.has(s.id) ? 'Expand' : 'Collapse'" @click="toggle(s.id)"><Icon name="chevron-down" :size="14" :class="{ rot: collapsed.has(s.id) }" /></button>
          <Menu :items="cardMenu(i)" :width="200"><button type="button" class="ib" :aria-label="`Step ${i + 1} actions`"><Icon name="more" :size="16" :stroke="3" /></button></Menu>
        </header>
        <p v-if="errors[s.id]" class="emsg tiny">{{ errors[s.id] }}</p>
        <div v-if="hasBody(s)" v-show="!collapsed.has(s.id)" class="bd">
          <StepFields v-if="!['open_brand', 'close_brand'].includes(s.type)" :step="s" :recipes="recipes" @update:step="update(i, $event)" />
          <input v-if="s.note !== undefined || notes.has(s.id)" class="input note" :value="s.note ?? ''" placeholder="Note — why this step is here" aria-label="Step note" @input="update(i, { ...s, note: ($event.target as HTMLInputElement).value })" />
          <template v-if="s.type === 'if_exists'">
            <div class="branch"><span class="label">Then</span>
              <StepList :model-value="s.then" :errors="errors" :recipes="recipes" :depth="depth + 1" add-label="Add step to Then" @update:model-value="update(i, nested(s, 'then', $event))" />
            </div>
            <div class="branch"><span class="label">Otherwise</span>
              <StepList :model-value="s.else ?? []" :errors="errors" :recipes="recipes" :depth="depth + 1" add-label="Add step to Otherwise" @update:model-value="update(i, nested(s, 'else', $event))" />
            </div>
          </template>
          <div v-else-if="s.type === 'loop_media'" class="branch"><span class="label">For each file</span>
            <StepList :model-value="s.steps" :errors="errors" :recipes="recipes" :depth="depth + 1" add-label="Add step to loop" @update:model-value="update(i, nested(s, 'steps', $event))" />
          </div>
        </div>
      </li>
    </TransitionGroup>
    <p v-if="!modelValue.length && depth > 0" class="tiny muted none">No steps here yet.</p>
    <Menu :items="addItems" align="left" :width="230">
      <button type="button" class="addb" :class="{ small: depth > 0 }"><Icon name="plus" :size="14" />{{ addLabel }}</button>
    </Menu>
  </div>
</template>

<style scoped>
.ol { display: flex; flex-direction: column; gap: 8px; }
.card { position: relative; border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--panel); transition: border-color 160ms, opacity 160ms, box-shadow 160ms; }
.d1 .card, .d2 .card, .d3 .card { background: var(--bg-elev); }
.card.err { border-color: color-mix(in srgb, var(--bad) 55%, var(--line)); }
.card.dragging { opacity: .45; }
.card.target::before { content: ''; position: absolute; left: 8px; right: 8px; top: -6px; height: 2px; background: var(--lime); box-shadow: 0 0 0 1px var(--ink); border-radius: 2px; }
.card.target.below::before { top: auto; bottom: -6px; }
.hd { display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 8px; min-height: 44px; }
.handle { color: var(--muted); cursor: grab; display: grid; place-items: center; width: 18px; height: 28px; }
.handle:hover { color: var(--fg); }
.idx { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font-family: var(--mono); font-size: var(--fs-2xs); background: var(--panel-2); color: var(--fg-2); flex: none; }
.ti { color: var(--fg-2); }
.ttl { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 10px; text-align: left; padding: 4px 0; }
.sum { min-width: 0; flex: 1; }
.edot { width: 8px; height: 8px; border-radius: 50%; background: var(--bad); flex: none; }
.ib { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; color: var(--muted); flex: none; }
.ib:hover { background: var(--panel-2); color: var(--fg); }
.rot { transform: rotate(-90deg); }
.ib-sp { width: 30px; flex: none; }
.emsg { color: var(--bad); padding: 0 12px 6px 62px; margin-top: -4px; }
.bd { padding: 4px 14px 14px 62px; display: flex; flex-direction: column; gap: 12px; }
.d1 .bd, .d2 .bd, .d3 .bd { padding-left: 14px; }
.note { min-height: 34px; padding: 6px 10px; font-size: var(--fs-sm); background: var(--bg-elev); }
.branch { display: flex; flex-direction: column; gap: 8px; padding-left: 14px; border-left: 2px solid var(--line); }
.addb { display: inline-flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px; margin-top: 10px; border-radius: 99px; border: 1px dashed var(--line-strong); color: var(--fg-2); font-size: var(--fs-sm); font-weight: 500; transition: border-color 160ms, color 160ms; }
.addb.small { height: 30px; margin-top: 4px; font-size: var(--fs-xs); }
.addb:hover { border-color: var(--fg); color: var(--fg); }
.none { padding: 2px 0; }
</style>
