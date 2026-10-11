<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { MediaAsset, Post } from '@shared/types';
import Drawer from '@/components/ui/Drawer.vue';
import Btn from '@/components/ui/Btn.vue';
import Chip from '@/components/ui/Chip.vue';
import Icon from '@/components/ui/Icon.vue';
import PlatformIcon from '@/components/common/PlatformIcon.vue';
import ImageZoom from '@/components/media/ImageZoom.vue';
import { api, fileUrl } from '@/lib/api';
import { onTopics } from '@/lib/live';
import { ago } from '@/lib/format';
import { fail, ok, toast } from '@/composables/toast';
import { confirm } from '@/composables/confirm';
import { useBusy } from '@/composables/busy';
import { EDITABLE, KIND_LABEL, brandById, postStatus } from './meta';
import { fmtWhen, fromWall, splitWall, tzLabel } from './time';

/** One post at a glance (from the calendar or anywhere): details, screenshots, results and the actions its status allows. */
const props = defineProps<{ postId: string | null }>();
const emit = defineEmits<{ close: [] }>();
const router = useRouter();

const post = ref<Post | null>(null);
const error = ref<string | null>(null);
const media = ref<MediaAsset[]>([]);
const zoom = ref<number | null>(null);
const { busy, run } = useBusy();

async function load(quiet = false) {
  const id = props.postId;
  if (!id) return;
  if (!quiet) { post.value = null; media.value = []; error.value = null; }
  try {
    const p = await api('posts.get', { id });
    if (props.postId !== id) return;
    post.value = p;
    if (p.assetIds.length) { try { const l = await api('media.list', { ids: p.assetIds }); const m = new Map(l.map(a => [a.id, a])); media.value = p.assetIds.map(x => m.get(x)).filter((a): a is MediaAsset => !!a); } catch { media.value = []; } }
    const s = p.scheduledAt ? splitWall(p.scheduledAt) : splitWall(new Date(Date.now() + 3600_000));
    day.value = s.day; time.value = s.time;
  } catch (e) {
    error.value = (e as Error).message;
  }
}
watch(() => props.postId, () => void load(), { immediate: true });
const off = onTopics(['posts.changed'], () => { if (props.postId) void load(true); });
onBeforeUnmount(off);

const brand = computed(() => brandById(post.value?.brandId));
const accs = computed(() => (post.value?.accountIds ?? []).map(id => brand.value?.accounts.find(a => a.id === id) ?? { id, platform: 'custom' as const, handle: 'removed account', loginState: 'unknown' as const }));
const st = computed(() => postStatus(post.value?.status ?? 'draft'));
const editable = computed(() => !!post.value && EDITABLE.includes(post.value.status));
const screens = computed(() => (post.value?.screens ?? []).map(s => ({ path: s.path, label: `${accs.value.find(a => a.id === s.accountId)?.handle ?? 'account'} · prepared ${ago(s.at)}` })));
const results = computed(() => (post.value?.results ?? []).map(r => ({ ...r, acc: accs.value.find(a => a.id === r.accountId) })));

const day = ref('');
const time = ref('');
const resched = ref(false);
async function reschedule() {
  const p = post.value; if (!p || !day.value || !time.value) return;
  await run('resched', async () => {
    const r = await api('posts.reschedule', { id: p.id, scheduledAt: fromWall(day.value, time.value) });
    post.value = r; resched.value = false;
    if (r.error) toast('Rescheduled — check pacing', { tone: 'warn', body: r.error }); else ok('Rescheduled', fmtWhen(r.scheduledAt));
  }, 'Could not reschedule');
}
const act = (key: string, fn: () => Promise<Post>, done: string) => run(key, async () => { post.value = await fn(); ok(done); });
const prepare = () => act('prepare', () => api('posts.prepare', { id: post.value!.id }), 'Preparing in the brand window');
const approve = () => act('approve', () => api('posts.approve', { id: post.value!.id }), 'Approved');
const runNow = async () => { if (await confirm({ title: 'Publish now?', body: 'Cubby opens the brand and posts to every account on this post, respecting pacing.', confirm: 'Publish now' })) await act('run', () => api('posts.run', { id: post.value!.id }), 'Publishing'); };
async function cancel() {
  if (!(await confirm({ title: 'Cancel this post?', body: 'It stays in the history as cancelled and will not go out.', confirm: 'Cancel post', cancel: 'Keep it', danger: true }))) return;
  await act('cancel', () => api('posts.cancel', { id: post.value!.id }), 'Post cancelled');
}
async function remove() {
  if (!(await confirm({ title: 'Delete this draft?', confirm: 'Delete', danger: true }))) return;
  await run('delete', async () => { await api('posts.delete', { id: post.value!.id }); ok('Draft deleted'); emit('close'); });
}
const openUrl = (url: string) => void run('url', () => api('app.openExternal', { url }));
</script>

<template>
  <Drawer :open="!!postId" :title="brand?.name ?? 'Post'" :eyebrow="post ? `${KIND_LABEL[post.kind]} post` : 'Post'" :width="560" @update:open="v => !v && emit('close')">
    <template #head>
      <div v-if="post" class="row gap-2 mt-2 wrap">
        <Chip :tone="st.tone">{{ st.label }}</Chip>
        <span class="small muted">{{ post.scheduledAt ? fmtWhen(post.scheduledAt) : 'No time set' }}</span>
      </div>
    </template>
    <div v-if="error" class="small muted">Could not load the post — {{ error }}</div>
    <div v-else-if="!post" class="col"><div class="skel-line" style="width: 70%" /><div class="skel-line" style="width: 50%" /><div class="skel" style="height: 120px; border-radius: 8px" /></div>
    <template v-else>
      <div v-if="post.error" class="errbox small"><Icon name="warn" :size="14" /><span>{{ post.error }}</span></div>

      <div class="label mb-2">Accounts</div>
      <div class="accs">
        <span v-for="a in accs" :key="a.id" class="acc"><PlatformIcon :platform="a.platform" :size="14" colored />{{ a.handle }}<span v-if="post.approval?.accountIds?.includes(a.id)" class="tick" title="Approved"><Icon name="check" :size="12" /></span></span>
      </div>

      <div class="label mb-2 mt-5">Caption</div>
      <p class="cap pre small">{{ post.caption || 'No caption.' }}</p>
      <div v-if="Object.keys(post.perPlatform ?? {}).length" class="tiny muted mt-2">Has its own settings for {{ Object.keys(post.perPlatform).join(', ') }}.</div>

      <template v-if="media.length">
        <div class="label mb-2 mt-5">Media</div>
        <div class="thumbs">
          <img v-for="m in media" :key="m.id" :src="fileUrl(m.thumb)" :alt="m.filename" :title="m.filename" />
        </div>
      </template>

      <template v-if="screens.length">
        <div class="label mb-2 mt-5">Prepared screenshots</div>
        <div class="thumbs">
          <button v-for="(s, i) in screens" :key="s.path" type="button" class="shot" :title="s.label" @click="zoom = i"><img :src="fileUrl(s.path)" alt="" /></button>
        </div>
      </template>

      <template v-if="results.length">
        <div class="label mb-2 mt-5">Results</div>
        <ul class="results">
          <li v-for="r in results" :key="r.accountId + r.at">
            <PlatformIcon :platform="r.acc?.platform ?? 'custom'" :size="14" />
            <span class="grow small ellipsis">{{ r.acc?.handle }}</span>
            <button v-if="r.url" type="button" class="link small" @click="openUrl(r.url)">View post</button>
            <span v-else-if="r.error" class="small bad ellipsis" :title="r.error">{{ r.error }}</span>
          </li>
        </ul>
      </template>

      <Transition name="slide-down">
        <div v-if="resched" class="resched mt-5">
          <div><div class="label mb-2">New time ({{ tzLabel() }})</div>
            <div class="dt"><input v-model="day" type="date" class="input" aria-label="Date" /><input v-model="time" type="time" class="input" aria-label="Time" /></div>
          </div>
          <div class="row gap-2 mt-3"><Btn size="sm" variant="primary" :loading="busy === 'resched'" @click="reschedule">Save time</Btn><Btn size="sm" variant="subtle" @click="resched = false">Cancel</Btn></div>
        </div>
      </Transition>
    </template>
    <template v-if="post" #footer>
      <Btn v-if="post.status === 'draft'" size="sm" variant="danger" icon="trash" :loading="busy === 'delete'" @click="remove">Delete</Btn>
      <Btn v-else-if="editable" size="sm" variant="subtle" :loading="busy === 'cancel'" @click="cancel">Cancel post</Btn>
      <span class="grow" />
      <Btn v-if="editable && !resched" size="sm" icon="clock" @click="resched = true">Reschedule</Btn>
      <Btn v-if="['draft', 'queued', 'failed', 'needs_human'].includes(post.status)" size="sm" icon="eye" :loading="busy === 'prepare'" @click="prepare">Prepare</Btn>
      <Btn v-if="post.status === 'ready_for_approval'" size="sm" variant="signal" icon="check" :loading="busy === 'approve'" @click="approve">Approve</Btn>
      <Btn v-if="post.status === 'approved' || (post.status === 'queued' && !brand?.approvalRequired)" size="sm" icon="send" :loading="busy === 'run'" @click="runNow">Publish now</Btn>
      <Btn v-if="editable" size="sm" variant="primary" icon="edit" @click="router.push({ path: '/compose', query: { post: post.id } })">Edit</Btn>
      <Btn v-else size="sm" icon="copy" @click="router.push({ path: '/compose', query: { post: post.id } })">Open</Btn>
    </template>
  </Drawer>
  <ImageZoom v-model:index="zoom" :images="screens" />
</template>

<style scoped>
.errbox { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: var(--r); background: var(--bad-bg); color: var(--bad); margin-bottom: var(--s5); line-height: 1.45; }
.errbox .icon { margin-top: 2px; }
.accs { display: flex; flex-wrap: wrap; gap: 6px; }
.acc { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border-radius: 99px; border: 1px solid var(--line); font-size: var(--fs-sm); }
.tick { color: var(--good); }
.cap { padding: 12px 14px; border-radius: var(--r); background: var(--panel); border: 1px solid var(--line-soft); line-height: 1.5; max-height: 240px; overflow: auto; }
.thumbs { display: flex; flex-wrap: wrap; gap: 8px; }
.thumbs img { width: 84px; height: 84px; object-fit: cover; border-radius: 6px; background: var(--panel-2); }
.shot { border-radius: 6px; overflow: hidden; transition: transform 200ms var(--ease-out); }
.shot:hover { transform: translateY(-2px); }
.shot img { width: 120px; height: 84px; object-fit: cover; object-position: top; }
.results li { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--line-soft); }
.results li:first-child { border-top: 0; }
.bad { color: var(--bad); max-width: 60%; }
.resched { padding: 14px; border-radius: var(--r-lg); border: 1px solid var(--line); background: var(--panel); }
.dt { display: grid; grid-template-columns: 1.3fr 1fr; gap: 8px; }
</style>
