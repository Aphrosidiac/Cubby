<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { AccountSummary, PerPlatformOptions, Platform, PostKind } from '@shared/types';
import { PLATFORM_SPECS } from '@shared/platforms';
import Modal from '@/components/ui/Modal.vue';
import Btn from '@/components/ui/Btn.vue';
import Field from '@/components/ui/Field.vue';
import AccountChips from './AccountChips.vue';
import BrandPicker from '@/components/common/BrandPicker.vue';
import { api } from '@/lib/api';
import { toast } from '@/composables/toast';
import { useBusy } from '@/composables/busy';
import { brandById } from './meta';

/**
 * Same content for another brand = a separate draft post there (paced and approved on its own).
 */
const props = defineProps<{ open: boolean; fromBrandId: string | null; platforms: Platform[]; content: { kind: PostKind; assetIds: string[]; caption: string; perPlatform: Partial<Record<Platform, PerPlatformOptions>> } }>();
const emit = defineEmits<{ 'update:open': [v: boolean] }>();
const router = useRouter();
const brandId = ref<string | null>(null);
const accounts = ref<AccountSummary[]>([]);
const chosen = ref<string[]>([]);
const { busy, run } = useBusy();

watch(() => props.open, o => { if (o) { brandId.value = null; accounts.value = []; chosen.value = []; } });
watch(brandId, async id => {
  accounts.value = []; chosen.value = [];
  if (!id) return;
  try { accounts.value = await api('accounts.list', { brandId: id }); } catch { accounts.value = brandById(id)?.accounts ?? []; }
  const supports = (p: Platform) => PLATFORM_SPECS[p].kinds.includes(props.content.kind);
  chosen.value = accounts.value.filter(a => props.platforms.includes(a.platform) && supports(a.platform)).map(a => a.id);
});
const same = computed(() => brandId.value && brandId.value === props.fromBrandId);
const unavailable = computed<Record<string, string>>(() => Object.fromEntries(accounts.value.filter(a => !PLATFORM_SPECS[a.platform]?.kinds.includes(props.content.kind)).map(a => [a.id, `${PLATFORM_SPECS[a.platform]?.name ?? a.platform} has no ${props.content.kind} posts`])));

async function create() {
  if (!brandId.value || !chosen.value.length) return;
  const target = brandId.value;
  await run('dup', async () => {
    const plats = new Set(accounts.value.filter(a => chosen.value.includes(a.id)).map(a => a.platform));
    const perPlatform = Object.fromEntries(Object.entries(props.content.perPlatform).filter(([p]) => plats.has(p as Platform)));
    const post = await api('posts.create', { brandId: target, accountIds: chosen.value, kind: props.content.kind, assetIds: props.content.assetIds, caption: props.content.caption, perPlatform, mode: 'draft' });
    emit('update:open', false);
    toast(`Draft created for ${brandById(target)?.name ?? 'the brand'}`, { tone: 'good', body: 'It is its own post — schedule it from the composer.', action: { label: 'Open', run: () => void router.push({ path: '/compose', query: { post: post.id } }) } });
  }, 'Could not duplicate');
}
</script>

<template>
  <Modal :open="open" title="Duplicate to brand" eyebrow="Composer" @update:open="emit('update:open', $event)">
    <p class="small muted">Creates a separate draft in the other brand with the same caption, media and options. It is paced and approved on its own.</p>
    <p v-if="!content.caption.trim() && !content.assetIds.length" class="tiny muted mt-2">This post has no caption or media yet — the copy starts empty too.</p>
    <Field label="Brand" class="mt-4"><BrandPicker v-model="brandId" placeholder="Choose the brand…" /></Field>
    <p v-if="same" class="tiny muted mt-2">That's the brand this post is already in — you'll get a second copy.</p>
    <Field v-if="brandId" label="Accounts" class="mt-4" :hint="accounts.length ? undefined : 'This brand has no accounts yet.'">
      <AccountChips v-model="chosen" :accounts="accounts" :unavailable="unavailable" />
    </Field>
    <template #footer>
      <Btn variant="subtle" @click="emit('update:open', false)">Cancel</Btn>
      <Btn variant="primary" :disabled="!brandId || !chosen.length" :loading="busy === 'dup'" @click="create">Create draft</Btn>
    </template>
  </Modal>
</template>
