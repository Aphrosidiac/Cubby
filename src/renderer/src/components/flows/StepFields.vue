<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { FlowStep, RecipeInfo } from '@shared/types';
import Field from '@/components/ui/Field.vue';
import Select from '@/components/ui/Select.vue';
import Btn from '@/components/ui/Btn.vue';
import Icon from '@/components/ui/Icon.vue';
import { api } from '@/lib/api';
import { fail } from '@/composables/toast';

/** The form for one step's own fields (nested steps are drawn by StepList). */
const props = defineProps<{ step: FlowStep; recipes: RecipeInfo[] | null }>();
const emit = defineEmits<{ 'update:step': [s: FlowStep] }>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const s = computed(() => props.step as any);
function set(k: string, v: unknown) {
  const next = { ...props.step, [k]: v } as Record<string, unknown>;
  if (v === undefined) delete next[k];
  emit('update:step', next as FlowStep);
}
const str = (e: Event) => (e.target as HTMLInputElement).value;
const optStr = (e: Event) => str(e) || undefined;

// run_recipe params as JSON text with its own error
const paramsText = ref('');
const paramsErr = ref<string | null>(null);
watch(() => props.step, st => {
  if (st.type !== 'run_recipe') return;
  const cur = (() => { try { return JSON.stringify(JSON.parse(paramsText.value || '{}')); } catch { return null; } })();
  if (cur !== JSON.stringify(st.params ?? {})) paramsText.value = Object.keys(st.params ?? {}).length ? JSON.stringify(st.params, null, 2) : '';
}, { immediate: true });
function setParams(t: string) {
  paramsText.value = t;
  try {
    const v = t.trim() ? JSON.parse(t) : {};
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Params must be a JSON object, e.g. { "key": "value" }');
    paramsErr.value = null;
    set('params', v);
  } catch (e) {
    paramsErr.value = e instanceof SyntaxError ? 'Not valid JSON yet' : (e as Error).message;
  }
}
const recipeOptions = computed(() => (props.recipes ?? []).map(r => ({ value: r.id, label: r.name, sub: r.description, group: r.platform ? 'Posting' : 'General' })));

async function chooseFiles() {
  try {
    const paths = await api('app.pickFiles', { multi: true });
    if (paths.length) set('files', [...(s.value.files ?? []), ...paths.filter((p: string) => !(s.value.files ?? []).includes(p))]);
  } catch (e) { fail(e); }
}
const KEYS = ['Enter', 'Tab', 'Escape', 'Backspace', 'ArrowDown', 'ArrowUp', 'Space', 'PageDown', 'PageUp'].map(k => ({ value: k, label: k }));
</script>

<template>
  <div class="sf">
    <template v-if="step.type === 'open_url'">
      <Field label="Address"><input class="input code-in" :value="s.url" placeholder="https://www.instagram.com/" @input="set('url', str($event))" /></Field>
    </template>

    <div v-else-if="step.type === 'click' || step.type === 'wait_for' || step.type === 'if_exists'" class="two">
      <Field label="Visible text" hint="Matches buttons and links by what they say"><input class="input" :value="s.text ?? ''" placeholder="e.g. Next" @input="set('text', optStr($event))" /></Field>
      <Field label="or CSS selector"><input class="input code-in" :value="s.selector ?? ''" placeholder="e.g. button[type=submit]" @input="set('selector', optStr($event))" /></Field>
      <Field v-if="step.type === 'wait_for'" label="Give up after (seconds)"><input class="input num" type="number" min="1" :value="(s.timeoutMs ?? 15000) / 1000" @input="set('timeoutMs', Math.round(Number(str($event)) * 1000) || undefined)" /></Field>
    </div>

    <template v-else-if="step.type === 'type'">
      <Field label="Text"><textarea v-autosize class="textarea" rows="2" :value="s.text" data-max="200" @input="set('text', str($event))" /></Field>
      <div class="two mt-3">
        <Field label="Into (CSS selector)" hint="Empty = the focused field"><input class="input code-in" :value="s.selector ?? ''" placeholder="e.g. textarea[aria-label=Caption]" @input="set('selector', optStr($event))" /></Field>
        <label class="chk"><input type="checkbox" :checked="!!s.clear" @change="set('clear', ($event.target as HTMLInputElement).checked || undefined)" /> Clear the field first</label>
      </div>
    </template>

    <template v-else-if="step.type === 'press'">
      <Field label="Key"><Select :model-value="s.key" :options="KEYS.some(k => k.value === s.key) ? KEYS : [...KEYS, { value: s.key, label: s.key }]" @update:model-value="set('key', $event)" /></Field>
    </template>

    <template v-else-if="step.type === 'scroll'">
      <Field label="Pixels" hint="Negative scrolls up"><input class="input num narrow" type="number" step="100" :value="s.dy" @input="set('dy', Number(str($event)))" /></Field>
    </template>

    <template v-else-if="step.type === 'upload'">
      <Field label="File input (CSS selector)"><input class="input code-in" :value="s.selector" @input="set('selector', str($event))" /></Field>
      <div class="mt-3">
        <div class="row between mb-2"><span class="flabel">Files</span><Btn size="sm" icon="plus" @click="chooseFiles">Choose files</Btn></div>
        <p v-if="!s.files.length" class="tiny muted">No files yet.</p>
        <ul v-else class="files">
          <li v-for="(f, i) in s.files" :key="f"><Icon name="file" :size="13" /><span class="grow code ellipsis" :title="f">{{ f }}</span><button type="button" class="rm" :aria-label="`Remove ${f}`" @click="set('files', s.files.filter((_: string, j: number) => j !== i))"><Icon name="close" :size="12" /></button></li>
        </ul>
      </div>
    </template>

    <template v-else-if="step.type === 'wait'">
      <Field label="Seconds"><input class="input num narrow" type="number" min="0.1" step="0.5" :value="s.ms / 1000" @input="set('ms', Math.round(Number(str($event)) * 1000))" /></Field>
    </template>

    <template v-else-if="step.type === 'screenshot'">
      <Field label="Label (optional)"><input class="input" :value="s.label ?? ''" placeholder="e.g. after login" @input="set('label', optStr($event))" /></Field>
    </template>

    <template v-else-if="step.type === 'loop_media'">
      <Field label="Media with tag" hint="Runs the steps below once per library file with this tag"><input class="input" :value="s.tag ?? ''" placeholder="e.g. october-reels" @input="set('tag', optStr($event)?.replace(/^#/, ''))" /></Field>
    </template>

    <template v-else-if="step.type === 'run_recipe'">
      <Field label="Recipe">
        <Select v-if="recipes?.length" :model-value="s.recipe || null" :options="recipeOptions" placeholder="Choose a recipe…" @update:model-value="set('recipe', $event)" />
        <input v-else class="input code-in" :value="s.recipe" placeholder="recipe id, e.g. check_logins" @input="set('recipe', str($event))" />
      </Field>
      <Field label="Params (JSON)" :error="paramsErr" hint="Optional — what the recipe needs, as a JSON object" class="mt-3">
        <textarea v-autosize class="textarea code-in" rows="2" :value="paramsText" placeholder="{ }" spellcheck="false" data-max="240" @input="setParams(str($event))" />
      </Field>
    </template>

    <template v-else-if="step.type === 'ask_claude'">
      <Field label="What Claude should do" hint="Claude works in this brand’s window with every guardrail on.">
        <textarea v-autosize class="textarea" rows="3" :value="s.prompt" placeholder="e.g. Reply to new comments on the latest post, friendly and short." data-max="260" @input="set('prompt', str($event))" />
      </Field>
    </template>

    <template v-else-if="step.type === 'notify'">
      <Field label="Message"><input class="input" :value="s.message" placeholder="e.g. Logins checked" @input="set('message', str($event))" /></Field>
    </template>

    <p v-else class="tiny muted">No settings — it just does it.</p>
  </div>
</template>

<style scoped>
.two { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; align-items: start; }
.code-in { font-family: var(--mono); font-size: var(--fs-xs); }
.narrow { max-width: 160px; }
.chk { display: inline-flex; align-items: center; gap: 8px; font-size: var(--fs-sm); color: var(--fg-2); padding-top: 28px; }
.chk input { accent-color: var(--fg); }
.flabel { font-size: var(--fs-sm); font-weight: 500; color: var(--fg-2); }
.files li { display: flex; align-items: center; gap: 8px; padding: 5px 0; color: var(--muted); }
.rm { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; color: var(--muted); }
.rm:hover { background: var(--panel-2); color: var(--bad); }
</style>
