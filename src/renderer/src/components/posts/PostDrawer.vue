<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { MediaAsset, PerPlatformOptions, Platform, Post } from '@shared/types';
import { PLATFORM_SPECS } from '@shared/platforms';
import Drawer from '@/components/ui/Drawer.vue';
import Btn from '@/components/ui/Btn.vue';
import Sep from './Sep.vue';
import StatusChip from './StatusChip.vue';
import Icon from '@/components/ui/Icon.vue';
import PlatformIcon from '@/components/common/PlatformIcon.vue';
import ImageZoom from '@/components/media/ImageZoom.vue';
import { api, fileUrl } from '@/lib/api';
import { onTopics } from '@/lib/live';
import { ago } from '@/lib/format';
import { ok, toast } from '@/composables/toast';
import { confirm } from '@/composables/confirm';
import { useBusy } from '@/composables/busy';
import { EDITABLE, KIND_LABEL, RESCHEDULABLE, RETRYABLE, brandById, errorFor, postStatus } from './meta';
import { clock, fmtWhen, fromWall, splitWall, tzLabel } from './time';

/** One post at a glance (from the calendar or anywhere): details, screenshots, results and the actions its status allows. */
const props = defineProps<{ postId: string | null }>();
const emit = defineEmits<{ close: [] }>();
const router = useRouter();

const post = ref<Post | null>(null);
const error = ref<string | null>(null);
const media = ref<MediaAsset[]>([]);
const zoom = ref<number | null>(null);
const runId = ref<string | null>(null);
const { busy, run } = useBusy();

async function load(quiet = false) {
  const id = props.postId;
  if (!id) return;
  if (!quiet) { post.value = null; media.value = []; error.value = null; runId.value = null; resched.value = false; }
  try {
    const p = await api('posts.get', { id });
    if (props.postId !== id) return;
    post.value = p;
    if (p.assetIds.length) { try { const l = await api('media.list', { ids: p.assetIds }); const m = new Map(l.map(a => [a.id, a])); media.value = p.assetIds.map(x => m.get(x)).filter((a): a is MediaAsset => !!a); } catch { media.value = []; } }
    else media.value = [];
    if (!resched.value) {
      const s = p.scheduledAt && new Date(p.scheduledAt).getTime() > Date.now() ? splitWall(p.scheduledAt) : splitWall(new Date(Date.now() + 3600_000));
      day.value = s.day; time.value = s.time;
    }
    // the latest run that worked on this post (for "View run" on running / failed / stuck posts)
    if (['running', 'failed', 'needs_human', 'posted'].includes(p.status)) {
      try { const [r] = await api('runs.list', { postId: p.id, limit: 1 }); if (props.postId === id) runId.value = r?.id ?? null; } catch { runId.value = null; }
    }
  } catch (e) {
    error.value = (e as Error).message;
  }
}
watch(() => props.postId, () => void load(), { immediate: true });
const off = onTopics(['posts.changed'], () => { if (props.postId) void load(true); });
onBeforeUnmount(off);

const brand = computed(() => brandById(post.value?.brandId));
const accs = computed(() => (post.value?.accountIds ?? []).map(id => brand.value?.accounts.find(a => a.id === id) ?? { id, platform: 'custom' as const, handle: 'removed account', loginState: 'unknown' as const }));
const status = computed(() => post.value?.status ?? 'draft');
const editable = computed(() => EDITABLE.includes(status.value));
const canResched = computed(() => RESCHEDULABLE.includes(status.value));
const canRetry = computed(() => RETRYABLE.includes(status.value) && (!brand.value?.approvalRequired || !!post.value?.approval));
const canPublish = computed(() => status.value === 'approved' || (status.value === 'queued' && !brand.value?.approvalRequired));
const screens = computed(() => (post.value?.screens ?? []).map(s => ({ path: s.path, label: `${accs.value.find(a => a.id === s.accountId)?.handle ?? 'account'} · prepared ${ago(s.at)}` })));
const results = computed(() => (post.value?.results ?? []).map(r => ({ ...r, acc: accs.value.find(a => a.id === r.accountId) })));
const errTone = computed(() => (['failed', 'needs_human'].includes(status.value) ? 'bad' : 'warn'));

/** Per-platform settings in words: "own caption · first comment · cover at 0:03". */
const PRIVACY: Record<string, string> = { public: 'everyone', friends: 'friends', private: 'only me' };
const overrides = computed(() => Object.entries(post.value?.perPlatform ?? {}).map(([p, o]) => {
  const v = (o ?? {}) as PerPlatformOptions;
  const bits: string[] = [];
  if (v.caption?.trim()) bits.push('own caption');
  if (v.title?.trim()) bits.push(`title “${v.title.trim()}”`);
  if (v.firstComment?.trim()) bits.push(p === 'x' || p === 'threads' ? 'first reply' : 'first comment');
  if (v.coverMs != null) bits.push(`cover at ${clock(v.coverMs)}`);
  if (v.fbPageName?.trim()) bits.push(`as ${v.fbPageName.trim()}`);
  if (v.tiktokPrivacy && v.tiktokPrivacy !== 'public') bits.push(`visible to ${PRIVACY[v.tiktokPrivacy] ?? v.tiktokPrivacy}`);
  const off = [v.allowComments === false && 'comments', v.allowDuet === false && 'duet', v.allowStitch === false && 'stitch'].filter(Boolean);
  if (off.length) bits.push(`${off.join(', ')} off`);
  if (v.igShareToFeed === false) bits.push('not shared to feed');
  return { platform: p as Platform, name: PLATFORM_SPECS[p as Platform]?.name ?? p, bits, caption: v.caption?.trim() ? v.caption : null };
}).filter(o => o.bits.length));

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
const act = (key: string, fn: () => Promise<Post>, done: string, body?: string) => run(key, async () => { post.value = await fn(); ok(done, body); });
const prepare = () => run('prepare', async () => {
  const p = await api('posts.prepare', { id: post.value!.id });
  post.value = p;
  if (p.status === 'ready_for_approval') ok('Prepared — waiting in Approvals', 'Cubby filled the post in the brand window and stopped before the final button.');
  else if (p.status === 'failed' || p.status === 'needs_human') toast(p.status === 'failed' ? 'Prepare failed' : 'Prepare needs you', { tone: 'bad', body: p.error ?? undefined });
  else if (p.status !== 'cancelled') ok('Prepared', 'Cubby filled the post in the brand window and stopped before the final button.');
}, 'Could not prepare');
const approve = () => act('approve', () => api('posts.approve', { id: post.value!.id }), 'Approved', post.value?.scheduledAt ? `Goes out ${fmtWhen(post.value.scheduledAt)}` : 'Goes out as soon as pacing allows');
async function publish(retry = false) {
  if (!(await confirm({ title: retry ? 'Try this post again now?' : 'Publish now?', body: retry ? 'Cubby opens the brand and posts again to every account that hasn’t been posted yet, respecting pacing.' : 'Cubby opens the brand and posts to every account on this post, respecting pacing.', confirm: retry ? 'Try again' : 'Publish now' }))) return;
  await run('run', async () => {
    const p = await api('posts.run', { id: post.value!.id });
    post.value = p;
    const s = postStatus(p.status).label.toLowerCase();
    if (p.status === 'posted') ok('Posted');
    else toast(`The post is ${s}`, { tone: p.status === 'failed' || p.status === 'needs_human' ? 'bad' : 'neutral', body: p.error ?? undefined });
  }, 'Could not publish');
}
async function cancel() {
  const running = status.value === 'running';
  if (!(await confirm({ title: running ? 'Stop this post?' : 'Cancel this post?', body: running ? 'Cubby stops working in the brand window and marks the post cancelled. Accounts already posted stay posted.' : 'It stays in the history as cancelled and will not go out.', confirm: running ? 'Stop post' : 'Cancel post', cancel: running ? 'Keep going' : 'Keep it', danger: true }))) return;
  await act('cancel', () => api('posts.cancel', { id: post.value!.id }), running ? 'Post stopped' : 'Post cancelled');
}
async function remove() {
  if (!(await confirm({ title: 'Delete this draft?', body: 'It is removed for good. Media files are not touched.', confirm: 'Delete', danger: true }))) return;
  await run('delete', async () => { await api('posts.delete', { id: post.value!.id }); ok('Draft deleted'); emit('close'); });
}
const openBrand = () => run('brand', async () => { await api('brands.open', { id: post.value!.brandId }); await api('brands.front', { id: post.value!.brandId }).catch(() => {}); }, 'Could not open the brand');
const openUrl = (url: string) => void run('url', () => api('app.openExternal', { url }), 'Could not open the link');
const go = (to: string | { path: string; query?: Record<string, string> }) => { emit('close'); void router.push(to); };
</script>

<template>
  <Drawer :open="!!postId" :title="brand?.name ?? 'Post'" :eyebrow="post ? `${KIND_LABEL[post.kind]} post` : 'Post'" :width="560" @update:open="v => !v && emit('close')">
    <template #head>
      <div v-if="post" class="row gap-2 mt-2 wrap">
        <StatusChip :status="status" />
        <span class="small muted">{{ post.scheduledAt ? fmtWhen(post.scheduledAt) : status === 'ready_for_approval' || status === 'approved' ? 'As soon as approved' : 'No time set' }}</span>
      </div>
    </template>
    <div v-if="error" class="errbox bad small"><Icon name="warn" :size="14" /><span>Could not load the post — {{ error }}</span></div>
    <div v-else-if="!post" class="col"><div class="skel-line" style="width: 70%" /><div class="skel-line" style="width: 50%" /><div class="skel" style="height: 120px; border-radius: 8px" /></div>
    <template v-else>
      <div v-if="post.error" class="errbox small" :class="errTone"><Icon name="warn" :size="14" /><span class="grow">{{ post.error }}</span></div>
      <div v-if="status === 'running'" class="note small"><span class="pulse" aria-hidden="true" /><span class="grow">Cubby is working on this post in the brand window right now.</span></div>
      <div v-if="runId || status === 'needs_human'" class="row gap-3 wrap mb-5 links">
        <RouterLink v-if="runId" :to="`/runs/${runId}`" class="link small" @click="emit('close')">View the run</RouterLink>
        <button v-if="status === 'needs_human'" type="button" class="link small" :disabled="busy === 'brand'" @click="openBrand">Open the brand window</button>
      </div>

      <div class="label mb-2">Accounts</div>
      <div class="accs">
        <span v-for="a in accs" :key="a.id" class="acc" :title="a.handle"><PlatformIcon :platform="a.platform" :size="14" colored /><span class="ellipsis">{{ a.handle }}</span><span v-if="post.approval?.accountIds?.includes(a.id)" class="tick" title="Approved" aria-label="Approved"><Icon name="check" :size="12" /></span></span>
      </div>

      <div class="label mb-2 mt-5">Caption</div>
      <p class="cap pre small">{{ post.caption || 'No caption.' }}</p>
      <template v-if="overrides.length">
        <div class="label mb-2 mt-5">Per platform</div>
        <ul class="ovr">
          <li v-for="o in overrides" :key="o.platform">
            <div class="row gap-2"><PlatformIcon :platform="o.platform" :size="14" colored /><span class="small strong">{{ o.name }}</span><span class="small muted ellipsis grow">{{ o.bits.join(' · ') }}</span></div>
            <p v-if="o.caption" class="cap pre small mt-2">{{ o.caption }}</p>
          </li>
        </ul>
      </template>

      <template v-if="media.length">
        <div class="label mb-2 mt-5">Media</div>
        <div class="thumbs">
          <span v-for="m in media" :key="m.id" class="mt" :title="m.filename">
            <img v-if="m.thumb" :src="fileUrl(m.thumb)" :alt="m.filename" />
            <Icon v-else :name="m.kind === 'video' ? 'video' : 'image'" :size="18" />
            <span v-if="m.missing" class="miss tiny">Missing</span>
          </span>
        </div>
      </template>

      <template v-if="screens.length">
        <div class="label mb-2 mt-5">Prepared screenshots</div>
        <div class="thumbs">
          <button v-for="(s, i) in screens" :key="s.path" type="button" class="shot" :title="s.label" :aria-label="`Zoom ${s.label}`" @click="zoom = i"><img :src="fileUrl(s.path)" alt="" /></button>
        </div>
      </template>

      <template v-if="results.length">
        <div class="label mb-2 mt-5">Results</div>
        <ul class="results">
          <li v-for="r in results" :key="r.accountId + r.at">
            <PlatformIcon :platform="r.acc?.platform ?? 'custom'" :size="14" colored />
            <div class="grow minw">
              <div class="small ellipsis" :title="r.acc?.handle">{{ r.acc?.handle ?? 'removed account' }}</div>
              <div v-if="r.error" class="tiny bad clamp2" :title="r.error">{{ errorFor(r.error, r.acc) }}</div>
              <div v-else class="tiny muted">Posted {{ ago(r.at) }}</div>
            </div>
            <Btn v-if="r.url" size="sm" icon="external" @click="openUrl(r.url)">View post</Btn>
          </li>
        </ul>
      </template>

      <Transition name="slide-down">
        <div v-if="resched" class="resched mt-5">
          <div class="label mb-2">New time ({{ tzLabel() }})</div>
          <div class="dt"><input v-model="day" type="date" class="input" aria-label="Date" /><input v-model="time" type="time" class="input" :aria-label="`Time (${tzLabel()})`" /></div>
          <p class="tiny muted mt-2">{{ day && time ? fmtWhen(fromWall(day, time)) : 'Pick a date and time' }}<Sep />pacing is checked for each account.</p>
          <div class="row gap-2 mt-3"><Btn size="sm" variant="primary" :loading="busy === 'resched'" @click="reschedule">Save time</Btn><Btn size="sm" variant="subtle" @click="resched = false">Cancel</Btn></div>
        </div>
      </Transition>
    </template>
    <template v-if="post" #footer>
      <Btn v-if="status === 'draft'" size="sm" variant="subtle" icon="trash" :loading="busy === 'delete'" @click="remove">Delete</Btn>
      <Btn v-else-if="editable || status === 'running'" size="sm" variant="subtle" :loading="busy === 'cancel'" @click="cancel">{{ status === 'running' ? 'Stop post' : 'Cancel post' }}</Btn>
      <span class="grow" />
      <Btn v-if="canResched && !resched" size="sm" icon="clock" @click="resched = true">Reschedule</Btn>
      <Btn v-if="['draft', 'queued', 'failed', 'needs_human'].includes(status)" size="sm" icon="eye" :loading="busy === 'prepare'" :title="brand?.approvalRequired ? 'Fill it in the brand window and send it to Approvals' : 'Fill it in the brand window and stop before the final button'" @click="prepare">Prepare</Btn>
      <Btn v-if="canRetry" size="sm" icon="refresh" :loading="busy === 'run'" @click="publish(true)">Try again</Btn>
      <Btn v-if="status === 'ready_for_approval'" size="sm" variant="primary" icon="check" :loading="busy === 'approve'" @click="approve">Approve</Btn>
      <Btn v-if="canPublish" size="sm" icon="send" :loading="busy === 'run'" @click="publish()">Publish now</Btn>
      <Btn v-if="editable" size="sm" :variant="status === 'ready_for_approval' ? 'ghost' : 'primary'" icon="edit" @click="go({ path: '/compose', query: { post: post.id } })">Edit</Btn>
      <Btn v-else size="sm" icon="arrow" @click="go({ path: '/compose', query: { post: post.id } })">Open in composer</Btn>
    </template>
  </Drawer>
  <ImageZoom v-model:index="zoom" :images="screens" />
</template>

<style scoped>
.errbox { display: flex; gap: 8px; align-items: flex-start; padding: 10px 12px; border-radius: var(--r); margin-bottom: var(--s4); line-height: 1.45; overflow-wrap: anywhere; }
.errbox.bad { background: var(--bad-bg); color: var(--bad); }
.errbox.warn { background: var(--warn-bg); color: var(--warn); }
.errbox .icon { margin-top: 2px; flex: none; }
.note { display: flex; gap: 10px; align-items: center; padding: 10px 12px; border-radius: var(--r); background: var(--warn-bg); color: var(--warn); margin-bottom: var(--s4); }
.pulse { width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex: none; animation: drawer-blink 1.6s ease-in-out infinite; }
@keyframes drawer-blink { 50% { opacity: .35; } }
.links .link:disabled { opacity: .5; }
.accs { display: flex; flex-wrap: wrap; gap: 6px; }
.acc { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; max-width: 100%; min-width: 0; border-radius: 99px; border: 1px solid var(--line); font-size: var(--fs-sm); }
.acc .pi, .acc .tick { flex: none; }
.tick { color: var(--good); display: inline-grid; }
.cap { padding: 12px 14px; border-radius: var(--r); background: var(--panel); border: 1px solid var(--line-soft); line-height: 1.5; max-height: 240px; overflow: auto; overflow-wrap: anywhere; }
.ovr li + li { margin-top: 10px; }
.thumbs { display: flex; flex-wrap: wrap; gap: 8px; }
.mt { position: relative; width: 84px; height: 84px; border-radius: 6px; overflow: hidden; background: var(--panel-2); display: grid; place-items: center; color: var(--muted); }
.mt img { width: 100%; height: 100%; object-fit: cover; }
.mt::after { content: ''; position: absolute; inset: 0; border-radius: inherit; box-shadow: inset 0 0 0 1px var(--line); pointer-events: none; }
.miss { position: absolute; left: 4px; bottom: 4px; padding: 0 5px; border-radius: 3px; background: var(--bad); color: #fff; font-weight: 600; }
.shot { border-radius: 6px; overflow: hidden; transition: transform 200ms var(--ease-out), box-shadow 200ms; box-shadow: 0 0 0 1px var(--line-soft); }
.shot:hover { transform: translateY(-2px); box-shadow: 0 0 0 1px var(--line-strong); }
.shot img { display: block; width: 120px; height: 84px; object-fit: cover; object-position: top; }
.results li { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid var(--line-soft); }
.results li:first-child { border-top: 0; }
.results .pi { flex: none; }
.minw { min-width: 0; }
.bad { color: var(--bad); }
.clamp2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.resched { padding: 14px; border-radius: var(--r-lg); border: 1px solid var(--line); background: var(--panel); }
.dt { display: grid; grid-template-columns: 1.3fr 1fr; gap: 8px; }
</style>
