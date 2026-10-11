<script setup lang="ts">
import { nextTick, ref } from 'vue';
import type { Group, Tag } from '@shared/types';
import Icon from '@/components/ui/Icon.vue';
import Menu from '@/components/ui/Menu.vue';
import Modal from '@/components/ui/Modal.vue';
import Btn from '@/components/ui/Btn.vue';
import Field from '@/components/ui/Field.vue';
import ColorPicker from './ColorPicker.vue';
import type { BrandFilter } from './filter';
import { GROUP_COLORS } from './filter';
import { api } from '@/lib/api';
import { confirm } from '@/composables/confirm';
import { fail, ok } from '@/composables/toast';

/**
 * The Brands page's own sidebar: saved views (All, Needs relogin, Open now), groups with counts
 * (create, rename, recolour, delete right here) and tags with counts. It only reads and writes
 * the shared filter; the list does the rest.
 */
const props = defineProps<{ filter: BrandFilter; groups: Group[] | null; tags: Tag[] | null; total: number | null; relogin: number; open: number; ungrouped: number }>();
const emit = defineEmits<{ set: [f: BrandFilter] }>();

const isAll = () => !Object.values(props.filter).some(Boolean);
const only = (f: BrandFilter) => emit('set', f);

// ── new group, inline ──
const adding = ref(false);
const newName = ref('');
const newInput = ref<HTMLInputElement | null>(null);
async function startAdd() { adding.value = true; newName.value = ''; await nextTick(); newInput.value?.focus(); }
async function add() {
  if (!adding.value) return;
  const name = newName.value.trim();
  adding.value = false; // Enter submits, then the input's blur fires: only the first one creates
  newName.value = '';
  if (!name) return;
  try { const g = await api('groups.create', { name, color: GROUP_COLORS[(props.groups?.length ?? 0) % GROUP_COLORS.length] }); only({ groupId: g.id }); } catch (e) { fail(e, 'Could not create the group'); }
}

// ── edit group (rename + recolour) ──
const editing = ref<{ id: string; name: string; color: string } | null>(null);
const saving = ref(false);
async function saveGroup() {
  if (!editing.value?.name.trim()) return;
  saving.value = true;
  try { await api('groups.update', { id: editing.value.id, patch: { name: editing.value.name.trim(), color: editing.value.color } }); editing.value = null; }
  catch (e) { fail(e, 'Could not save the group'); } finally { saving.value = false; }
}
async function delGroup(g: Group) {
  if (!(await confirm({ title: `Delete the group “${g.name}”?`, body: g.count ? `Its ${g.count} brand${g.count === 1 ? '' : 's'} stay — they just won’t be in a group.` : 'It has no brands.', confirm: 'Delete group', danger: true }))) return;
  try { await api('groups.delete', { id: g.id }); if (props.filter.groupId === g.id) only({}); ok('Group deleted'); } catch (e) { fail(e); }
}
async function move(g: Group, dir: -1 | 1) {
  const list = [...(props.groups ?? [])];
  const i = list.findIndex(x => x.id === g.id), j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  try { await Promise.all(list.map((x, k) => api('groups.update', { id: x.id, patch: { sort: k } }))); } catch (e) { fail(e); }
}
const groupMenu = (g: Group, i: number) => [
  { label: 'Rename / colour…', icon: 'edit', run: () => (editing.value = { id: g.id, name: g.name, color: g.color }) },
  { label: 'Move up', icon: 'arrow-up', disabled: i === 0, run: () => void move(g, -1) },
  { label: 'Move down', icon: 'arrow-down', disabled: i === (props.groups?.length ?? 0) - 1, run: () => void move(g, 1) },
  { divider: true, label: '' },
  { label: 'Delete group', icon: 'trash', danger: true, run: () => void delGroup(g) }
];

// ── tags ──
async function renameTag(t: Tag) {
  const name = await confirm({ title: `Rename tag “${t.name}”`, body: 'Every brand with this tag is updated.', confirm: 'Rename', input: { label: 'Name', value: t.name } });
  if (!name || name === t.name) return;
  try { await api('tags.update', { id: t.id, patch: { name } }); if (props.filter.tag === t.name) only({ ...props.filter, tag: name }); } catch (e) { fail(e); }
}
async function delTag(t: Tag) {
  if (!(await confirm({ title: `Delete tag “${t.name}”?`, body: t.count ? `It is removed from ${t.count} brand${t.count === 1 ? '' : 's'}.` : undefined, confirm: 'Delete tag', danger: true }))) return;
  try { await api('tags.delete', { id: t.id }); if (props.filter.tag === t.name) only({ ...props.filter, tag: undefined }); } catch (e) { fail(e); }
}
const tagMenu = (t: Tag) => [
  { label: 'Rename…', icon: 'edit', run: () => void renameTag(t) },
  { label: 'Delete tag', icon: 'trash', danger: true, run: () => void delTag(t) }
];
const showAllTags = ref(false);
</script>

<template>
  <nav class="bsb" aria-label="Brand views">
    <div class="sec">
      <button type="button" class="it" :class="{ on: isAll() }" @click="only({})"><Icon name="cubby" :size="15" /><span class="grow">All brands</span><span class="n num">{{ total ?? '' }}</span></button>
      <button type="button" class="it" :class="{ on: filter.loginState === 'relogin' && !filter.groupId && !filter.tag }" @click="only({ loginState: 'relogin' })">
        <Icon name="warn" :size="15" /><span class="grow">Needs relogin</span><span class="n num" :class="{ bad: relogin > 0 }">{{ relogin || '' }}</span>
      </button>
      <button type="button" class="it" :class="{ on: filter.status === 'open' && !filter.groupId && !filter.tag }" @click="only({ status: 'open' })">
        <Icon name="window" :size="15" /><span class="grow">Open now</span><span class="n num" :class="{ live: open > 0 }">{{ open || '' }}</span>
      </button>
    </div>

    <div class="head"><span class="label">Groups</span><button type="button" class="add" aria-label="New group" title="New group" @click="startAdd"><Icon name="plus" :size="14" /></button></div>
    <div class="sec">
      <div v-if="groups === null" class="skel-line" style="width: 70%; margin: 10px 10px" />
      <div v-for="(g, i) in groups ?? []" :key="g.id" class="it-row" :class="{ on: filter.groupId === g.id }">
        <button type="button" class="it" :class="{ on: filter.groupId === g.id }" @click="only(filter.groupId === g.id ? {} : { groupId: g.id })">
          <span class="swatch" :style="{ background: g.color }" /><span class="grow ellipsis" :title="g.name">{{ g.name }}</span><span class="n num">{{ g.count }}</span>
        </button>
        <Menu v-slot="{ open }" :items="groupMenu(g, i)" :width="200">
          <button type="button" class="dots" :class="{ on: open }" :aria-label="`Edit group ${g.name}`"><Icon name="more" :size="16" :stroke="3" /></button>
        </Menu>
      </div>
      <button v-if="groups?.length && ungrouped" type="button" class="it" :class="{ on: filter.groupId === 'none' }" @click="only(filter.groupId === 'none' ? {} : { groupId: 'none' })">
        <span class="swatch empty" /><span class="grow nog">No group</span><span class="n num">{{ ungrouped }}</span>
      </button>
      <form v-if="adding" class="new" @submit.prevent="add">
        <input ref="newInput" v-model="newName" class="input" placeholder="Group name" maxlength="60" @keydown.esc.stop="adding = false" @blur="add" />
      </form>
      <button v-else-if="!groups?.length" type="button" class="it ghost" @click="startAdd"><Icon name="plus" :size="14" /><span>New group</span></button>
    </div>

    <template v-if="tags?.length">
      <div class="head"><span class="label">Tags</span></div>
      <div class="sec">
        <div v-for="t in showAllTags ? tags : tags.slice(0, 10)" :key="t.id" class="it-row" :class="{ on: filter.tag === t.name }">
          <button type="button" class="it" :class="{ on: filter.tag === t.name }" @click="only(filter.tag === t.name ? {} : { tag: t.name })">
            <Icon name="hash" :size="14" /><span class="grow ellipsis" :title="t.name">{{ t.name }}</span><span class="n num">{{ t.count }}</span>
          </button>
          <Menu v-slot="{ open }" :items="tagMenu(t)" :width="180">
            <button type="button" class="dots" :class="{ on: open }" :aria-label="`Edit tag ${t.name}`"><Icon name="more" :size="16" :stroke="3" /></button>
          </Menu>
        </div>
        <button v-if="tags.length > 10" type="button" class="it ghost" @click="showAllTags = !showAllTags"><span>{{ showAllTags ? 'Show fewer' : `Show all ${tags.length}` }}</span></button>
      </div>
    </template>

    <div class="sec foot">
      <RouterLink to="/recycle" class="it"><Icon name="recycle" :size="15" /><span class="grow">Recycle bin</span><Icon name="arrow" :size="13" class="faint" /></RouterLink>
    </div>

    <Modal :open="!!editing" title="Edit group" size="sm" @update:open="v => !v && (editing = null)">
      <form v-if="editing" class="col gap-4" @submit.prevent="saveGroup">
        <Field label="Name"><input v-model="editing.name" class="input" maxlength="60" autofocus /></Field>
        <Field label="Colour"><ColorPicker v-model="editing.color" /></Field>
      </form>
      <template #footer>
        <Btn variant="subtle" @click="editing = null">Cancel</Btn>
        <Btn variant="primary" :loading="saving" :disabled="!editing?.name.trim()" @click="saveGroup">Save group</Btn>
      </template>
    </Modal>
  </nav>
</template>

<style scoped>
.bsb { display: flex; flex-direction: column; gap: 2px; font-size: var(--fs-base); }
.sec { display: flex; flex-direction: column; gap: 1px; }
.head { display: flex; align-items: center; justify-content: space-between; margin: 18px 0 4px; padding: 0 4px 0 10px; height: 22px; }
.add { width: 22px; height: 22px; display: grid; place-items: center; border-radius: 6px; color: var(--muted); }
.add:hover { background: var(--panel-2); color: var(--fg); }
/* Every row keeps a 28px lane on the right for its ⋯ (groups and tags) so counts line up in one
   column; the ⋯ sits beside the row's button, never on top of it. */
.it { width: 100%; display: flex; align-items: center; gap: 9px; height: 32px; padding: 0 36px 0 10px; border-radius: 7px; color: var(--fg-2); text-align: left; font-weight: 500; transition: background-color 160ms, color 160ms; min-width: 0; }
.it .icon { color: var(--muted); flex: none; }
.it:hover { background: var(--panel-2); color: var(--fg); }
.it.on { background: var(--fg); color: var(--bg); }
.it.on .icon, .it.on .n { color: color-mix(in srgb, var(--bg) 72%, transparent); }
.it.ghost { color: var(--muted); font-weight: 400; }
.nog { color: var(--muted); }
.it.on .nog { color: inherit; }
.it-row { position: relative; display: flex; align-items: center; border-radius: 7px; transition: background-color 160ms, color 160ms; }
.it-row .it { flex: 1; padding-right: 8px; background: none; color: var(--fg-2); }
.it-row:hover { background: var(--panel-2); }
.it-row:hover .it { color: var(--fg); }
.it-row.on { background: var(--fg); }
.it-row.on .it { color: var(--bg); }
.it-row :deep(.menu-root) { flex: none; width: 28px; display: grid; place-items: center; }
.dots { width: 26px; height: 26px; display: grid; place-items: center; border-radius: 6px; color: var(--muted); opacity: 0; transition: opacity 140ms, background-color 140ms; }
.it-row:hover .dots, .it-row:focus-within .dots, .dots.on { opacity: 1; }
.it-row.on .dots { color: color-mix(in srgb, var(--bg) 80%, transparent); }
.dots:hover, .dots:focus-visible { background: color-mix(in srgb, var(--muted) 20%, transparent); color: var(--fg); }
.it-row.on .dots:hover, .it-row.on .dots:focus-visible { color: var(--bg); background: color-mix(in srgb, var(--bg) 18%, transparent); }
.n { flex: none; font-family: var(--mono); font-size: var(--fs-2xs); color: var(--muted); min-width: 16px; text-align: right; font-variant-numeric: tabular-nums; }
.n.bad { color: var(--bad); font-weight: 500; }
.n.live { color: var(--good); font-weight: 500; }
.it.on .n.bad, .it.on .n.live { color: var(--bg); }
.swatch.empty { background: transparent; box-shadow: none; border: 1.5px dashed var(--muted); }
[data-theme='dark'] .swatch:not(.empty) { box-shadow: inset 0 0 0 1px rgb(243 239 228 / .3); }
.foot .it { padding-right: 10px; }
.new { padding: 3px 0; }
.new .input { min-height: 32px; padding: 5px 10px; font-size: var(--fs-sm); }
.foot { margin-top: 18px; padding-top: 10px; border-top: 1px solid var(--line-soft); }
</style>
