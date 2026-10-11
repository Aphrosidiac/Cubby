<script setup lang="ts">
import { ref, watch } from 'vue';
import Modal from '@/components/ui/Modal.vue';
import Btn from '@/components/ui/Btn.vue';
import Field from '@/components/ui/Field.vue';
import Icon from '@/components/ui/Icon.vue';
import BrandPicker from '@/components/common/BrandPicker.vue';
import { api } from '@/lib/api';
import { fail, ok } from '@/composables/toast';
import { brandById } from './meta';
import { tzLabel } from './time';

/** Posting slots per brand ("Ascend: every day 20:00") — where "Add to queue" puts posts. */
const props = defineProps<{ open: boolean; brandId: string | null }>();
const emit = defineEmits<{ 'update:open': [v: boolean] }>();
const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const brand = ref<string | null>(null);
const rows = ref<{ weekdays: number[]; time: string; k: number }[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const saving = ref(false);
let k = 0;

watch(() => props.open, o => { if (o) brand.value = props.brandId; });
watch([brand, () => props.open], async ([id, o]) => {
  rows.value = []; error.value = null;
  if (!id || !o) return;
  loading.value = true;
  try {
    const s = await api('slots.list', { brandId: id });
    rows.value = s.map(x => ({ weekdays: [...x.weekdays].sort(), time: x.time, k: ++k }));
  } catch (e) { error.value = (e as Error).message; }
  finally { loading.value = false; }
});
const add = () => rows.value.push({ weekdays: [1, 2, 3, 4, 5], time: rows.value.at(-1)?.time ?? '20:00', k: ++k });
const toggleDay = (r: { weekdays: number[] }, d: number) => { r.weekdays = r.weekdays.includes(d) ? r.weekdays.filter(x => x !== d) : [...r.weekdays, d].sort(); };
const preset = (r: { weekdays: number[] }, which: 'all' | 'week' | 'end') => { r.weekdays = which === 'all' ? [0, 1, 2, 3, 4, 5, 6] : which === 'week' ? [1, 2, 3, 4, 5] : [0, 6]; };

async function save() {
  if (!brand.value) return;
  if (rows.value.some(r => !r.weekdays.length || !/^\d{2}:\d{2}$/.test(r.time))) { fail(new Error('Every slot needs at least one day and a time.'), 'Check the slots'); return; }
  saving.value = true;
  try {
    await api('slots.set', { brandId: brand.value, slots: rows.value.map(r => ({ weekdays: r.weekdays, time: r.time })) });
    ok('Posting slots saved', brandById(brand.value)?.name);
    emit('update:open', false);
  } catch (e) { fail(e, 'Could not save the slots'); }
  finally { saving.value = false; }
}
</script>

<template>
  <Modal :open="open" title="Posting slots" eyebrow="Queue" size="md" @update:open="emit('update:open', $event)">
    <p class="small muted">“Add to queue” puts a post in the brand’s next free slot. Times are {{ tzLabel() }}; pacing still applies per account.</p>
    <Field label="Brand" class="mt-4"><BrandPicker v-model="brand" /></Field>
    <div v-if="brand" class="mt-5">
      <div v-if="loading" class="col"><div v-for="i in 2" :key="i" class="skel" style="height: 46px; border-radius: 6px" /></div>
      <p v-else-if="error" class="small muted">Slots aren’t available yet — {{ error }}</p>
      <template v-else>
        <p v-if="!rows.length" class="small muted">No slots yet — queued posts have nowhere to go. Add one below.</p>
        <ul class="slots">
          <li v-for="(r, i) in rows" :key="r.k" :class="{ invalid: !r.weekdays.length }">
            <div class="left">
              <div class="days" role="group" :aria-label="`Slot ${i + 1} days`">
                <button v-for="(d, j) in DAYS" :key="j" type="button" :class="{ on: r.weekdays.includes(j) }" :aria-pressed="r.weekdays.includes(j)" :aria-label="DAY_NAMES[j]" :title="DAY_NAMES[j]" @click="toggleDay(r, j)">{{ d }}</button>
              </div>
              <div class="pre tiny">
                <span v-if="!r.weekdays.length" class="err">Pick at least one day ·</span>
                <button type="button" @click="preset(r, 'all')">Daily</button><button type="button" @click="preset(r, 'week')">Weekdays</button><button type="button" @click="preset(r, 'end')">Weekend</button>
              </div>
            </div>
            <input v-model="r.time" type="time" class="input time" :aria-label="`Slot ${i + 1} time (${tzLabel()})`" />
            <button type="button" class="rm" :aria-label="`Remove slot ${i + 1}`" :title="`Remove slot ${i + 1}`" @click="rows.splice(i, 1)"><Icon name="close" :size="14" /></button>
          </li>
        </ul>
        <Btn size="sm" icon="plus" class="mt-3" @click="add">Add slot</Btn>
      </template>
    </div>
    <template #footer>
      <Btn variant="subtle" @click="emit('update:open', false)">Cancel</Btn>
      <Btn variant="primary" :disabled="!brand || loading || !!error" :loading="saving" @click="save">Save slots</Btn>
    </template>
  </Modal>
</template>

<style scoped>
.slots li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid var(--line-soft); }
.left { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.err { color: var(--bad); }
.slots li:first-child { border-top: 0; }
.days { display: inline-flex; gap: 3px; }
.days button { width: 28px; height: 28px; border-radius: 50%; font-size: var(--fs-xs); font-weight: 600; color: var(--muted); box-shadow: inset 0 0 0 1px var(--line); transition: background-color 150ms, color 150ms; }
.days button.on { background: var(--fg); color: var(--bg); box-shadow: none; }
.days button:hover:not(.on) { color: var(--fg); box-shadow: inset 0 0 0 1px var(--fg); }
.pre { display: flex; flex-wrap: wrap; gap: 4px 10px; color: var(--muted); }
.pre button { color: var(--muted); }
.pre button:hover { color: var(--fg); text-decoration: underline; }
.time { width: 136px; min-height: 36px; padding: 5px 9px; }
.rm { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; color: var(--muted); }
.rm:hover { background: var(--panel-2); color: var(--bad); }
</style>
