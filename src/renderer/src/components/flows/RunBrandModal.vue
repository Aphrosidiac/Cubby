<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import Modal from '@/components/ui/Modal.vue';
import Btn from '@/components/ui/Btn.vue';
import Icon from '@/components/ui/Icon.vue';
import BrandAvatar from '@/components/common/BrandAvatar.vue';
import { useBrands } from '@/components/posts/meta';

/** Choose the brand(s) a flow or recipe runs on. Runs queue one at a time per brand. */
const props = defineProps<{ open: boolean; title: string; multi?: boolean; limitTo?: string[] | null; busy?: boolean; confirmLabel?: string }>();
const emit = defineEmits<{ 'update:open': [v: boolean]; confirm: [ids: string[]] }>();
const brands = useBrands();
const chosen = ref<string[]>([]);
const q = ref('');
const list = computed(() => brands.list.filter(b => (!props.limitTo?.length || props.limitTo.includes(b.id)) && (!q.value.trim() || b.name.toLowerCase().includes(q.value.trim().toLowerCase()))));
watch(() => props.open, o => { if (o) { q.value = ''; chosen.value = props.limitTo?.length && props.multi ? [...props.limitTo] : []; } });
const toggle = (id: string) => { chosen.value = props.multi ? (chosen.value.includes(id) ? chosen.value.filter(x => x !== id) : [...chosen.value, id]) : [id]; };
</script>

<template>
  <Modal :open="open" :title="title" eyebrow="Run" size="sm" @update:open="emit('update:open', $event)">
    <p class="small muted">{{ multi ? 'Pick the brands. Each runs in its own window, one run per brand at a time.' : 'Pick the brand to run it in.' }}</p>
    <input v-if="brands.list.length > 6" v-model="q" class="input mt-3" placeholder="Search brands" aria-label="Search brands" />
    <ul class="bl mt-3" role="listbox" :aria-multiselectable="multi">
      <li v-for="b in list" :key="b.id">
        <button type="button" class="bi" :class="{ on: chosen.includes(b.id) }" role="option" :aria-selected="chosen.includes(b.id)" @click="toggle(b.id)" @dblclick="!multi && emit('confirm', [b.id])">
          <BrandAvatar :brand="b" :size="22" />
          <span class="grow ellipsis">{{ b.name }}</span>
          <span class="tiny muted">{{ b.status === 'open' ? 'open' : '' }}</span>
          <span class="box"><Icon v-if="chosen.includes(b.id)" name="check" :size="12" :stroke="2.2" /></span>
        </button>
      </li>
      <li v-if="!list.length" class="small muted">No brands to choose.</li>
    </ul>
    <template #footer>
      <Btn variant="subtle" @click="emit('update:open', false)">Cancel</Btn>
      <Btn variant="primary" icon="play" :disabled="!chosen.length" :loading="busy" @click="emit('confirm', chosen)">{{ confirmLabel ?? 'Run' }}{{ multi && chosen.length > 1 ? ` on ${chosen.length}` : '' }}</Btn>
    </template>
  </Modal>
</template>

<style scoped>
.bl { display: flex; flex-direction: column; gap: 4px; max-height: 320px; overflow-y: auto; }
.bi { width: 100%; display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 6px; text-align: left; font-size: var(--fs-base); border: 1px solid transparent; }
.bi:hover { background: var(--panel-2); }
.bi.on { border-color: var(--fg); background: var(--bg-elev); }
.box { width: 18px; height: 18px; border-radius: 4px; display: grid; place-items: center; box-shadow: inset 0 0 0 1.5px var(--line-strong); }
.on .box { background: var(--fg); color: var(--bg); box-shadow: none; }
</style>
