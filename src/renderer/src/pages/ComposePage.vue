<script setup lang="ts">
// Composer (PLAN 6.4): brand → accounts → kind → media → caption + per-platform overrides,
// live platform fit, preview, then Save draft · Post now · Schedule · Add to queue.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import type { AccountSummary, FitLevel, MediaAsset, PerPlatformOptions, Platform, Post, PostKind } from '@shared/types';
import { POST_KINDS } from '@shared/types';
import { PLATFORM_SPECS, countHashtags, fitTarget, gradeMedia } from '@shared/platforms';
import PageHeader from '@/components/ui/PageHeader.vue';
import Btn from '@/components/ui/Btn.vue';
import Icon from '@/components/ui/Icon.vue';
import Chip from '@/components/ui/Chip.vue';
import Menu from '@/components/ui/Menu.vue';
import Tabs from '@/components/ui/Tabs.vue';
import Segmented from '@/components/ui/Segmented.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import PlatformIcon from '@/components/common/PlatformIcon.vue';
import BrandPicker from '@/components/common/BrandPicker.vue';
import AccountChips from '@/components/posts/AccountChips.vue';
import MediaStrip from '@/components/posts/MediaStrip.vue';
import PlatformOptions from '@/components/posts/PlatformOptions.vue';
import FitPanel from '@/components/posts/FitPanel.vue';
import PreviewCard from '@/components/posts/PreviewCard.vue';
import DuplicateModal from '@/components/posts/DuplicateModal.vue';
import MediaPickerDrawer from '@/components/media/MediaPickerDrawer.vue';
import AssetDrawer from '@/components/media/AssetDrawer.vue';
import { KIND_LABEL, EDITABLE, RETRYABLE, brandById, errorFor, postStatus, useBrands } from '@/components/posts/meta';
import { ago } from '@/lib/format';
import { fmtWhen, fromWall, splitWall, tzLabel } from '@/components/posts/time';
import { api, on } from '@/lib/api';
import { fail, ok, toast } from '@/composables/toast';
import { confirm } from '@/composables/confirm';
import { useShortcuts } from '@/composables/shortcuts';
import type { MenuItem } from '@/components/ui/types';

type Acc = Pick<AccountSummary, 'id' | 'platform' | 'handle' | 'loginState'>;
type PerPlatform = Partial<Record<Platform, PerPlatformOptions>>;

const route = useRoute();
const router = useRouter();
const brands = useBrands();

// ── form state ────────────────────────────────────────────────────────────────
const brandId = ref<string | null>(null);
const accounts = ref<Acc[]>([]);
const accountsLoading = ref(false);
/** What the person ticked. Accounts whose platform can't take the current kind are left out of the post (see accountIds). */
const picked = ref<string[]>([]);
const kind = ref<PostKind>('reel');
const assets = ref<MediaAsset[]>([]);
const caption = ref('');
const perPlatform = ref<PerPlatform>({});
const when = ref<'queue' | 'schedule' | 'now'>('queue');
const day = ref('');
const time = ref('');
const editing = ref<Post | null>(null);
const loadingPost = ref(false);
const loadError = ref<string | null>(null);
let restoring = false;

const brand = computed(() => brandById(brandId.value));
const supports = (a: Acc, k: PostKind) => PLATFORM_SPECS[a.platform]?.kinds.includes(k) ?? false;
/** account id → why it can't take this kind ("X has no reel posts") */
const unavailable = computed<Record<string, string>>(() => Object.fromEntries(accounts.value.filter(a => !supports(a, kind.value)).map(a => [a.id, `${PLATFORM_SPECS[a.platform]?.name ?? a.platform} has no ${KIND_LABEL[kind.value].toLowerCase()} posts`])));
/** The accounts the post goes to: ticked and able to take the kind. */
const accountIds = computed(() => picked.value.filter(id => accounts.value.some(a => a.id === id) && !unavailable.value[id]));
const leftOut = computed(() => accounts.value.filter(a => unavailable.value[a.id]));
const selected = computed(() => accounts.value.filter(a => accountIds.value.includes(a.id)));
const platforms = computed(() => [...new Set(selected.value.map(a => a.platform))] as Platform[]);
const readOnly = computed(() => !!editing.value && !EDITABLE.includes(editing.value.status));
const isDraftEdit = computed(() => editing.value?.status === 'draft');
/** an approved / awaiting post whose content edit sends it back through approval */
const reApproval = computed(() => !!editing.value && ['ready_for_approval', 'approved'].includes(editing.value.status));

function defaultWhen() {
  const t = new Date(Date.now() + 2 * 3600_000);
  t.setMinutes(0, 0, 0);
  const s = splitWall(t);
  day.value = s.day; time.value = s.time;
}
defaultWhen();

// every kind at least one of the brand's accounts can take; accounts that can't take the chosen one sit it out
const kindOptions = computed<PostKind[]>(() => {
  const kinds = POST_KINDS.filter(k => accounts.value.some(a => supports(a, k)));
  return kinds.length ? kinds : [...POST_KINDS];
});
watch(kindOptions, ks => { if (ks.length && !ks.includes(kind.value) && !restoring) kind.value = ks[0]; });
const multi = computed(() => kind.value === 'carousel');
watch(kind, k => {
  if (k !== 'carousel' && assets.value.length > 1 && !restoring) {
    assets.value = assets.value.slice(0, 1);
    toast('Kept the first file', { body: 'Only carousels take several files.' });
  }
});

// ── loading: ?post=<id> edits, ?brand=<id> preselects, ?media=<id> attaches ────
async function loadFromRoute() {
  loadError.value = null;
  const postId = typeof route.query.post === 'string' ? route.query.post : null;
  const qb = typeof route.query.brand === 'string' ? route.query.brand : null;
  const qm = typeof route.query.media === 'string' ? route.query.media : null;
  if (postId) {
    if (editing.value?.id === postId && !loadError.value) return; // just saved here — already showing it
    loadingPost.value = true;
    try {
      const p = await api('posts.get', { id: postId });
      restoring = true;
      editing.value = p;
      brandId.value = p.brandId;
      await loadAccounts(p.brandId);
      picked.value = [...p.accountIds];
      kind.value = p.kind;
      caption.value = p.caption;
      perPlatform.value = JSON.parse(JSON.stringify(p.perPlatform ?? {}));
      // a time that has passed (failed / stuck posts) is not offered back: two hours from now instead
      if (p.scheduledAt && (new Date(p.scheduledAt).getTime() > Date.now() + 60_000 || !EDITABLE.includes(p.status))) { const s = splitWall(p.scheduledAt); day.value = s.day; time.value = s.time; when.value = 'schedule'; }
      else { defaultWhen(); when.value = p.scheduledAt ? 'schedule' : 'queue'; }
      assets.value = [];
      if (p.assetIds.length) {
        try {
          const list = await api('media.list', { ids: p.assetIds });
          const byId = new Map(list.map(a => [a.id, a]));
          assets.value = p.assetIds.map(id => byId.get(id)).filter((a): a is MediaAsset => !!a);
        } catch (e) { fail(e, 'Could not load the post’s media'); }
      }
    } catch (e) {
      loadError.value = (e as Error).message;
    } finally {
      loadingPost.value = false;
      setTimeout(() => { restoring = false; snapshot(); }, 0);
    }
    return;
  }
  if (editing.value) {
    // from a saved post to a new one: start clean (same brand keeps its default accounts)
    editing.value = null;
    assets.value = []; caption.value = ''; perPlatform.value = {}; when.value = 'queue'; defaultWhen();
    picked.value = accounts.value.filter(a => a.loginState !== 'expired').map(a => a.id);
  }
  if (qb) brandId.value = qb;
  else if (!brandId.value && brands.list.length === 1) brandId.value = brands.list[0].id;
  if (qm) {
    try { const [a] = await api('media.list', { ids: [qm] }); if (a) { assets.value = multi.value ? [...assets.value, a] : [a]; if (a.kind === 'image' && kind.value !== 'carousel') kind.value = 'image'; } }
    catch (e) { fail(e, 'Could not attach that file'); }
  }
  setTimeout(snapshot, 0);
}
async function loadAccounts(id: string) {
  accountsLoading.value = true;
  try { accounts.value = await api('accounts.list', { brandId: id }); }
  catch { accounts.value = brandById(id)?.accounts ?? []; }
  finally { accountsLoading.value = false; }
}
watch(brandId, async id => {
  if (restoring) return;
  accounts.value = []; picked.value = [];
  if (!id) return;
  await loadAccounts(id);
  if (brandId.value !== id) return;
  picked.value = accounts.value.filter(a => a.loginState !== 'expired').map(a => a.id);
});
watch(() => brands.loaded, l => { if (l && !brandId.value && !route.query.post && brands.list.length === 1) brandId.value = brands.list[0].id; });
onMounted(loadFromRoute);
watch(() => route.fullPath, (to, from) => { if (route.path === '/compose' && to !== from) void loadFromRoute(); });

// ── next queue slot ──────────────────────────────────────────────────────────
const nextSlot = ref<string | null | undefined>(undefined);
const nextSlotErr = ref<string | null>(null);
watch(brandId, async id => {
  nextSlot.value = undefined; nextSlotErr.value = null;
  if (!id) return;
  try { nextSlot.value = await api('posts.nextSlot', { brandId: id }); } catch (e) { nextSlotErr.value = (e as Error).message; nextSlot.value = null; }
}, { immediate: true });

// ── per-platform tabs ────────────────────────────────────────────────────────
const tab = ref<Platform | null>(null);
watch(platforms, ps => { if (!tab.value || !ps.includes(tab.value)) tab.value = ps[0] ?? null; }, { immediate: true });
const platformTabs = computed(() => platforms.value.map(p => ({ value: p as string, label: PLATFORM_SPECS[p].name })));
const optsFor = (p: Platform) => perPlatform.value[p] ?? {};
const setOpts = (p: Platform, v: PerPlatformOptions) => { perPlatform.value = { ...perPlatform.value, [p]: v }; };
const firstVideo = computed(() => assets.value.find(a => a.kind === 'video') ?? null);
const effCaption = (p: Platform) => perPlatform.value[p]?.caption?.trim() ? perPlatform.value[p]!.caption! : caption.value;
const counters = computed(() => platforms.value.map(p => {
  const s = PLATFORM_SPECS[p];
  const c = effCaption(p);
  return { p, name: s.name, len: [...c].length, max: s.captionMax, tags: countHashtags(c), tagMax: s.hashtagMax, override: !!perPlatform.value[p]?.caption?.trim() };
}));

// ── media ───────────────────────────────────────────────────────────────────
const pickerOpen = ref(false);
const peek = ref<MediaAsset | null>(null);
const addingFiles = ref(false);
async function addFiles(paths: string[]) {
  addingFiles.value = true;
  try {
    const added = await api('media.add', { paths });
    if (!added.length) { toast('Nothing added', { body: 'Those are not media files Cubby can read.' }); return; }
    attach(added);
  } catch (e) {
    fail(e, 'Could not add the files');
  } finally {
    addingFiles.value = false;
  }
}
function attach(list: MediaAsset[]) {
  if (multi.value) {
    const have = new Set(assets.value.map(a => a.id));
    assets.value = [...assets.value, ...list.filter(a => !have.has(a.id))];
  } else {
    assets.value = list.slice(0, 1);
    if (list.length > 1) toast('Attached the first file', { body: 'Switch to Carousel to post several.' });
  }
  // a lone image on a video kind (or the other way round) — nudge the kind when it is unambiguous
  const a = assets.value[0];
  if (a && assets.value.length === 1) {
    if (a.kind === 'image' && ['reel', 'video'].includes(kind.value) && kindOptions.value.includes('image')) kind.value = 'image';
    if (a.kind === 'video' && kind.value === 'image') kind.value = kindOptions.value.includes('reel') ? 'reel' : kindOptions.value.includes('video') ? 'video' : kind.value;
  }
}
function onPick(list: MediaAsset[]) {
  if (multi.value) assets.value = list; // the picker returns the full ordered selection
  else attach(list);
}

// ── platform fit (server, falling back to the shared rules in-app) ────────────
const fitRows = ref<{ accountId: string; platform: Platform; handle: string; level: FitLevel; notes: string[] }[]>([]);
const fitChecking = ref(false);
const fitLocal = ref(false);
function localFit() {
  return selected.value.map(a => {
    const s = PLATFORM_SPECS[a.platform];
    const notes: string[] = [];
    let level: FitLevel = 'ok';
    const worse = (l: FitLevel) => { if (l === 'bad' || (l === 'warn' && level === 'ok')) level = l; };
    if (!s.kinds.includes(kind.value)) { worse('bad'); notes.push(`${s.name} has no ${KIND_LABEL[kind.value].toLowerCase()} posts`); }
    const t = fitTarget(a.platform, kind.value);
    if (kind.value !== 'text' && !assets.value.length) { worse('bad'); notes.push('add media'); }
    if (t?.maxItems && assets.value.length > t.maxItems) { worse('bad'); notes.push(`at most ${t.maxItems} files`); }
    if (t) for (const m of assets.value) { const g = gradeMedia(m, t); worse(g.level); notes.push(...g.notes.map(n => (assets.value.length > 1 ? `${m.filename}: ${n}` : n))); }
    const c = effCaption(a.platform);
    if ([...c].length > s.captionMax) { worse('bad'); notes.push(`caption is ${[...c].length - s.captionMax} characters too long`); }
    if (countHashtags(c) > s.hashtagMax) { worse('warn'); notes.push(`more than ${s.hashtagMax} hashtags`); }
    if (a.loginState === 'expired') { worse('warn'); notes.push('login expired — log in again first'); }
    return { accountId: a.id, platform: a.platform, handle: a.handle, level, notes };
  });
}
let fitTimer = 0;
let fitSeq = 0;
watch([brandId, kind, () => assets.value.map(a => a.id).join(), accountIds, caption, perPlatform], () => {
  clearTimeout(fitTimer);
  if (!brandId.value || !accountIds.value.length) { fitRows.value = []; return; }
  fitChecking.value = true;
  fitTimer = window.setTimeout(async () => {
    const my = ++fitSeq;
    try {
      const r = await api('posts.fit', { brandId: brandId.value!, kind: kind.value, assetIds: kind.value === 'text' ? [] : assets.value.map(a => a.id), accountIds: accountIds.value, caption: caption.value, perPlatform: cleanPerPlatform() });
      if (my !== fitSeq) return;
      const byId = new Map(accounts.value.map(a => [a.id, a]));
      fitRows.value = r.map(x => ({ ...x, handle: byId.get(x.accountId)?.handle ?? x.platform }));
      fitLocal.value = false;
    } catch {
      if (my !== fitSeq) return;
      fitRows.value = localFit();
      fitLocal.value = true;
    } finally {
      if (my === fitSeq) fitChecking.value = false;
    }
  }, 450);
}, { deep: true, immediate: true });
const worstFit = computed<FitLevel>(() => (fitRows.value.some(r => r.level === 'bad') ? 'bad' : fitRows.value.some(r => r.level === 'warn') ? 'warn' : 'ok'));

// ── preview ──────────────────────────────────────────────────────────────────
const previewP = ref<Platform | null>(null);
watch(platforms, ps => { if (!previewP.value || !ps.includes(previewP.value)) previewP.value = ps[0] ?? null; }, { immediate: true });
const previewAcc = computed(() => selected.value.find(a => a.platform === previewP.value) ?? null);

// ── saving ───────────────────────────────────────────────────────────────────
function cleanPerPlatform(): PerPlatform {
  const out: PerPlatform = {};
  for (const p of platforms.value) {
    const o = { ...(perPlatform.value[p] ?? {}) } as Record<string, unknown>;
    for (const k of Object.keys(o)) if (o[k] === '' || o[k] === undefined) delete o[k];
    if (Object.keys(o).length) out[p] = o as PerPlatformOptions;
  }
  return out;
}
const scheduledIso = computed(() => (day.value && time.value ? fromWall(day.value, time.value) : null));
const errors = computed(() => {
  const e: string[] = [];
  if (!brandId.value) e.push('Choose a brand');
  else if (!accounts.value.length && !accountsLoading.value) e.push('Add an account to this brand');
  else if (!accountIds.value.length) e.push(picked.value.some(id => unavailable.value[id]) ? `None of the ticked accounts take ${KIND_LABEL[kind.value].toLowerCase()} posts — choose another type` : 'Choose at least one account');
  if (kind.value === 'carousel' && assets.value.length < 2) e.push(assets.value.length ? 'Add at least one more file' : 'Attach at least 2 files');
  else if (kind.value !== 'text' && !assets.value.length) e.push('Attach media');
  return e;
});
const scheduleError = computed(() => {
  if (when.value !== 'schedule') return null;
  if (!scheduledIso.value) return 'Pick a date and time';
  if (new Date(scheduledIso.value).getTime() < Date.now() + 60_000) return 'That time has passed — pick a later one, or use Queue or Now';
  return null;
});
const submitting = ref<string | null>(null);
const approvalNote = computed(() => !!brand.value?.approvalRequired);
const retrying = computed(() => !!editing.value && RETRYABLE.includes(editing.value.status));
const primaryLabel = computed(() => (retrying.value ? 'Save and send again' : editing.value && !isDraftEdit.value ? 'Save changes' : when.value === 'queue' ? 'Add to queue' : when.value === 'schedule' ? 'Schedule' : approvalNote.value ? 'Prepare now' : 'Post now'));

function payload() {
  return { accountIds: accountIds.value, kind: kind.value, assetIds: kind.value === 'text' ? [] : assets.value.map(a => a.id), caption: caption.value, perPlatform: cleanPerPlatform() };
}

async function saveDraft() {
  if (readOnly.value || submitting.value) return;
  if (!brandId.value || !accountIds.value.length) { toast('Choose a brand and at least one account first', { tone: 'warn' }); return; }
  submitting.value = 'draft';
  try {
    if (editing.value) {
      editing.value = await api('posts.update', { id: editing.value.id, patch: { ...payload(), scheduledAt: when.value === 'schedule' ? scheduledIso.value : editing.value.scheduledAt } });
      ok('Saved');
    } else {
      const p = await api('posts.create', { brandId: brandId.value, ...payload(), scheduledAt: when.value === 'schedule' ? scheduledIso.value : null, mode: 'draft' });
      editing.value = p;
      void router.replace({ path: '/compose', query: { post: p.id } });
      ok('Draft saved', p.scheduledAt ? 'It is on the calendar — keep editing here any time.' : 'It is under Not scheduled in the Calendar — keep editing here any time.');
    }
    snapshot();
  } catch (e) {
    fail(e, 'Could not save the draft');
  } finally {
    submitting.value = null;
  }
}

async function submit() {
  if (readOnly.value || submitting.value) return;
  if (errors.value.length) { toast(errors.value[0], { tone: 'warn' }); return; }
  if (scheduleError.value) { toast(scheduleError.value, { tone: 'warn' }); return; }
  if (worstFit.value === 'bad' && !(await confirm({ title: 'Some accounts won’t take this post', body: fitRows.value.filter(r => r.level === 'bad').map(r => `${r.handle}: ${r.notes.join(', ')}`).join('\n'), confirm: 'Continue anyway', danger: true }))) return;
  submitting.value = 'submit';
  try {
    const old = editing.value;
    if (old && !isDraftEdit.value) {
      // an existing post: save the content and the time the When panel says
      const at = when.value === 'schedule' ? scheduledIso.value : when.value === 'now' ? new Date().toISOString() : (nextSlot.value ?? old.scheduledAt);
      let p = await api('posts.update', { id: old.id, patch: { ...payload(), scheduledAt: at } });
      if (p.status === 'draft') {
        // the edit dropped its approval / failure: send it on its way again (prepared again when the brand needs approval)
        p = await api('posts.submit', { id: p.id, mode: when.value, scheduledAt: when.value === 'schedule' ? scheduledIso.value : null });
        toast(approvalNote.value ? 'Saved — preparing it again for approval' : 'Saved and back in the queue', { tone: 'good', body: approvalNote.value ? 'It will be filled in the brand window again and wait in Approvals.' : p.scheduledAt ? `Goes out ${fmtWhen(p.scheduledAt)}.` : undefined });
      } else ok('Changes saved', p.scheduledAt ? `Goes out ${fmtWhen(p.scheduledAt)}` : undefined);
      editing.value = p;
      snapshot();
      return;
    }
    // an existing draft keeps its id: save the content, then send it on its way
    const p = old
      ? (await api('posts.update', { id: old.id, patch: payload() }), await api('posts.submit', { id: old.id, mode: when.value, scheduledAt: when.value === 'schedule' ? scheduledIso.value : null }))
      : await api('posts.create', { brandId: brandId.value!, ...payload(), scheduledAt: when.value === 'schedule' ? scheduledIso.value : null, mode: when.value });
    const whenText = when.value === 'schedule' ? `Scheduled for ${fmtWhen(p.scheduledAt)}.` : when.value === 'queue' ? (p.scheduledAt ? `Queued for ${fmtWhen(p.scheduledAt)}.` : 'Queued for the next free slot.') : 'Going out as soon as pacing allows.';
    toast(when.value === 'now' ? (approvalNote.value ? 'Preparing in the brand window' : 'Posting now') : when.value === 'queue' ? 'Added to the queue' : 'Scheduled', {
      tone: 'good',
      body: approvalNote.value ? `It will be filled in the brand window first and wait in Approvals.${when.value === 'now' ? '' : ` ${whenText}`}` : whenText,
      action: { label: approvalNote.value ? 'Approvals' : 'Calendar', run: () => void router.push(approvalNote.value ? '/approvals' : '/calendar') }
    });
    resetContent();
    if (old) void router.replace({ path: '/compose', query: { brand: brandId.value! } });
  } catch (e) {
    fail(e, when.value === 'now' ? 'Could not post' : 'Could not schedule');
  } finally {
    submitting.value = null;
  }
}

function resetContent() {
  editing.value = null;
  assets.value = [];
  caption.value = '';
  perPlatform.value = {};
  defaultWhen();
  setTimeout(snapshot, 0);
}

async function deletePost() {
  const p = editing.value; if (!p) return;
  if (!(await confirm({ title: 'Delete this post?', body: 'It is removed from the calendar and queue. Media files are not touched.', confirm: 'Delete', danger: true }))) return;
  try { await api('posts.delete', { id: p.id }); ok('Post deleted'); snapshot(); resetContent(); void router.replace({ path: '/compose', query: { brand: p.brandId } }); }
  catch (e) { fail(e); }
}

// ── leave guard ──────────────────────────────────────────────────────────────
const snap = ref('');
const state = () => JSON.stringify([brandId.value, picked.value, kind.value, assets.value.map(a => a.id), caption.value, perPlatform.value, when.value, day.value, time.value]);
function snapshot() { snap.value = state(); }
const dirty = computed(() => state() !== snap.value && (caption.value.trim() !== '' || assets.value.length > 0));
const guard = async () => {
  if (!dirty.value || submitting.value) return true;
  return await confirm({ title: 'Leave without saving?', body: 'This post has changes that are not saved.', confirm: 'Discard changes', cancel: 'Keep editing', danger: true });
};
onBeforeRouteLeave(guard);
// switching post inside the composer (Start a new post, a link to another ?post=) is leaving too
onBeforeRouteUpdate(guard);

// not while a drawer / modal (media picker, duplicate, confirm) is on top
const overlayOpen = () => !!document.querySelector('[role="dialog"][aria-modal="true"]');
useShortcuts({ 'mod+Enter': () => { if (!overlayOpen()) void submit(); }, 'mod+s': () => { if (!overlayOpen()) void saveDraft(); } });

const dupOpen = ref(false);
const menu = computed<MenuItem[]>(() => [
  { label: 'Duplicate to brand…', icon: 'copy', run: () => (dupOpen.value = true), disabled: !brandId.value },
  { label: 'Start a new post', icon: 'plus', run: () => void router.push({ path: '/compose', query: brandId.value ? { brand: brandId.value } : {} }), disabled: !editing.value },
  { divider: true, label: '' },
  { label: 'Delete post', icon: 'trash', danger: true, run: () => void deletePost(), disabled: !editing.value || editing.value.status === 'running' }
]);
const whenOptions = [{ value: 'queue', label: 'Queue', icon: 'queue' }, { value: 'schedule', label: 'Schedule', icon: 'calendar' }, { value: 'now', label: 'Now', icon: 'bolt' }];
const kindSegments = computed(() => kindOptions.value.map(k => ({ value: k, label: KIND_LABEL[k] })));
const todayWall = computed(() => splitWall(new Date()).day);

// ── read-only posts (running / posted / cancelled): what happened, instead of the When panel ──
const results = computed(() => (editing.value?.results ?? []).map(r => ({ ...r, acc: accounts.value.find(a => a.id === r.accountId) })));
const openUrl = (url: string) => void api('app.openExternal', { url }).catch(e => fail(e, 'Could not open the link'));
const stopping = ref(false);
async function stopPost() {
  const p = editing.value; if (!p) return;
  if (!(await confirm({ title: 'Stop this post?', body: 'Cubby stops working in the brand window and marks the post cancelled. Accounts already posted stay posted.', confirm: 'Stop post', cancel: 'Keep going', danger: true }))) return;
  stopping.value = true;
  try { editing.value = await api('posts.cancel', { id: p.id }); ok('Post stopped'); snapshot(); }
  catch (e) { fail(e, 'Could not stop the post'); }
  finally { stopping.value = false; }
}
const openingBrand = ref(false);
async function openBrand() {
  const id = editing.value?.brandId; if (!id) return;
  openingBrand.value = true;
  try { await api('brands.open', { id }); await api('brands.front', { id }).catch(() => {}); }
  catch (e) { fail(e, 'Could not open the brand'); }
  finally { openingBrand.value = false; }
}
// the post can move on its own (prepare finishing, the scheduler running it): keep its status, error and results live
let liveSeq = 0;
const offLive = on('posts.changed', async e => {
  const cur = editing.value;
  if (!cur || (e?.id && e.id !== cur.id) || submitting.value) return;
  const my = ++liveSeq;
  try {
    const p = await api('posts.get', { id: cur.id });
    if (my !== liveSeq || editing.value?.id !== p.id) return;
    if (p.status !== cur.status || p.error !== cur.error || p.updatedAt !== cur.updatedAt) editing.value = p;
  } catch { /* deleted elsewhere — the next save says so */ }
});
onBeforeUnmount(offLive);
const errTone = computed(() => (!editing.value?.error ? null : ['failed', 'needs_human'].includes(editing.value.status) ? 'bad' : 'warn'));
const leftOutText = computed(() => leftOut.value.map(a => `${a.handle} (${PLATFORM_SPECS[a.platform]?.name ?? a.platform})`).join(', '));
</script>

<template>
  <div class="page compose">
    <PageHeader eyebrow="Posting" :title="editing ? (readOnly ? 'Post' : 'Edit post') : 'Compose'">
      <template v-if="editing">
        <Chip :tone="postStatus(editing.status).tone">{{ postStatus(editing.status).label }}</Chip>
        <span v-if="editing.scheduledAt">{{ fmtWhen(editing.scheduledAt) }}</span>
      </template>
      <span v-else>One post, any of the brand’s accounts. Times are {{ tzLabel() }}.</span>
      <template #actions>
        <span v-if="dirty" class="tiny muted unsaved">Unsaved</span>
        <Menu v-if="!loadError && (!brands.loaded || brands.list.length)" :items="menu"><Btn icon="more" square aria-label="More" title="More" /></Menu>
      </template>
    </PageHeader>

    <EmptyState v-if="loadError" icon="warn" title="Could not open this post" :body="loadError">
      <Btn size="sm" to="/compose">Start a new post</Btn>
    </EmptyState>
    <EmptyState v-else-if="brands.loaded && !brands.list.length" icon="cubby" title="Create a brand first" body="Posts belong to a brand and go out through its accounts.">
      <Btn variant="primary" size="sm" icon="plus" to="/brands/new">New brand</Btn>
    </EmptyState>

    <div v-else class="cw" :class="{ busy: loadingPost }">
      <div v-if="readOnly" class="banner small"><Icon name="lock" :size="14" /><span>This post is {{ postStatus(editing!.status).label.toLowerCase() }} — it can no longer be edited. Duplicate it to reuse the content.</span></div>
      <div v-if="editing?.error" class="errbox small" :class="errTone" role="status">
        <Icon name="warn" :size="14" /><span class="grow">{{ editing.error }}</span>
        <button v-if="editing.status === 'needs_human'" type="button" class="link small nowrap" :disabled="openingBrand" @click="openBrand">Open the brand window</button>
      </div>
      <div class="cgrid">
        <fieldset class="maincol" :disabled="readOnly">
          <section class="blk">
            <div class="bh"><span class="n">1</span><h2 class="h3">Brand and accounts</h2></div>
            <div class="brandrow">
              <div class="bp"><BrandPicker v-model="brandId" placeholder="Choose a brand…" :disabled="!!editing" /></div>
              <span v-if="brand?.approvalRequired" class="tiny muted row gap-1 nowrap"><Icon name="approve" :size="13" />Needs approval</span>
            </div>
            <p v-if="editing && !readOnly" class="tiny muted mt-2">A post stays in its brand — use Duplicate to brand… in the ⋯ menu to post it elsewhere.</p>
            <div v-if="brandId" class="mt-3">
              <div v-if="accountsLoading" class="row gap-2"><span v-for="i in 3" :key="i" class="skel" style="width: 130px; height: 36px; border-radius: 99px" /></div>
              <p v-else-if="!accounts.length" class="small muted">This brand has no accounts yet. <RouterLink :to="`/brands/${brandId}`" class="link">Add them on the brand page</RouterLink>.</p>
              <template v-else>
                <AccountChips v-model="picked" :accounts="accounts" :unavailable="unavailable" />
                <p v-if="leftOut.length" class="tiny muted mt-2 leftout">Not for {{ KIND_LABEL[kind].toLowerCase() }} posts: {{ leftOutText }}.</p>
              </template>
            </div>
          </section>

          <section class="blk">
            <div class="bh"><span class="n">2</span><h2 class="h3">Post type</h2></div>
            <Segmented v-model="kind" :options="kindSegments" />
          </section>

          <section v-if="kind !== 'text'" class="blk">
            <div class="bh"><span class="n">3</span><h2 class="h3">Media</h2><span class="grow" /><span class="tiny muted">{{ multi ? 'Several files, in order' : 'One file' }}</span></div>
            <MediaStrip v-model:assets="assets" :multi="multi" :busy="addingFiles" :disabled="readOnly" @files="addFiles" @library="pickerOpen = true" @open="peek = $event" />
          </section>

          <section class="blk">
            <div class="bh"><span class="n">{{ kind === 'text' ? 3 : 4 }}</span><h2 class="h3">Caption</h2></div>
            <textarea v-model="caption" v-autosize class="textarea cap" rows="5" data-max="420" placeholder="Write the caption. #hashtags count toward each platform’s limit." :disabled="readOnly" aria-label="Caption" />
            <div v-if="counters.length" class="counters">
              <span v-for="c in counters" :key="c.p" class="ctr" :class="{ over: c.len > c.max || c.tags > c.tagMax }" :title="`${c.name}: ${c.len.toLocaleString()} of ${c.max.toLocaleString()} characters, ${c.tags} of ${c.tagMax} hashtags${c.override ? ' — uses its own caption' : ''}`">
                <PlatformIcon :platform="c.p" :size="12" />
                <span class="num">{{ c.len.toLocaleString() }}/{{ c.max.toLocaleString() }}</span>
                <span class="num tags">#{{ c.tags }}/{{ c.tagMax }}</span>
                <span v-if="c.override" class="ov">own</span>
              </span>
            </div>

            <div v-if="platforms.length" class="mt-5">
              <div class="label mb-2">Per platform</div>
              <Tabs v-if="tab" :model-value="tab" :tabs="platformTabs" @update:model-value="tab = $event as Platform" />
              <div v-if="tab" class="tabbody">
                <PlatformOptions :key="tab" :platform="tab" :kind="kind" :model-value="optsFor(tab)" :main-caption="caption" :video="firstVideo" @update:model-value="setOpts(tab!, $event)" />
              </div>
            </div>
          </section>
        </fieldset>

        <aside class="side">
          <div v-if="readOnly && editing" class="panel pad outcome">
            <div class="label mb-3">{{ editing.status === 'running' ? 'Working on it' : editing.status === 'posted' ? 'Posted' : 'Outcome' }}</div>
            <div class="row gap-2 wrap"><Chip :tone="postStatus(editing.status).tone">{{ postStatus(editing.status).label }}</Chip><span class="small muted">{{ editing.scheduledAt ? fmtWhen(editing.scheduledAt) : 'No time set' }}</span></div>
            <p v-if="editing.status === 'running'" class="small mt-3">Cubby is working on this post in {{ brand?.name ?? 'the brand' }}’s window right now. The calendar and this page update when it finishes.</p>
            <p v-else-if="editing.status === 'cancelled'" class="small muted mt-3">It was cancelled and will not go out.</p>
            <ul v-if="results.length" class="results mt-3">
              <li v-for="r in results" :key="r.accountId">
                <PlatformIcon :platform="r.acc?.platform ?? 'custom'" :size="14" colored />
                <div class="grow minw">
                  <div class="small strong ellipsis" :title="r.acc?.handle">{{ r.acc?.handle ?? 'removed account' }}</div>
                  <div v-if="r.error" class="tiny bad clamp2" :title="r.error">{{ errorFor(r.error, r.acc) }}</div>
                  <div v-else class="tiny muted">Posted {{ ago(r.at) }}</div>
                </div>
                <Btn v-if="r.url" size="sm" variant="ghost" icon="external" @click="openUrl(r.url)">View post</Btn>
              </li>
            </ul>
            <div class="btns">
              <Btn v-if="editing.status === 'running'" block variant="danger" icon="stop" :loading="stopping" @click="stopPost">Stop post</Btn>
              <Btn block icon="copy" @click="dupOpen = true">Duplicate to brand…</Btn>
              <Btn block variant="subtle" icon="plus" :to="{ path: '/compose', query: { brand: editing.brandId } }">Start a new post</Btn>
            </div>
          </div>

          <div v-else class="panel pad actions">
            <div class="label mb-3">When</div>
            <Segmented v-model="when" :options="whenOptions" size="sm" />
            <div class="whenbody">
              <template v-if="when === 'queue'">
                <p class="small">
                  <template v-if="nextSlot">Next free slot: <b>{{ fmtWhen(nextSlot) }}</b></template>
                  <template v-else-if="nextSlot === undefined && brandId"><span class="skel-line" style="width: 70%; display: inline-block" /></template>
                  <template v-else-if="nextSlotErr">Goes into the next free posting slot.</template>
                  <template v-else-if="brandId">No posting slots set for this brand. <RouterLink to="/calendar?slots=1" class="link">Set slots</RouterLink></template>
                  <template v-else>Goes into the brand’s next free posting slot.</template>
                </p>
              </template>
              <template v-else-if="when === 'schedule'">
                <div class="dt">
                  <input v-model="day" type="date" class="input" :min="todayWall" aria-label="Date" />
                  <input v-model="time" type="time" class="input" :aria-label="`Time (${tzLabel()})`" />
                </div>
                <p v-if="scheduleError" class="tiny err">{{ scheduleError }}</p>
                <p v-else class="tiny muted">{{ fmtWhen(scheduledIso) }}</p>
              </template>
              <p v-else class="small">As soon as pacing allows for each account.</p>
              <p v-if="approvalNote" class="appr tiny"><Icon name="approve" :size="13" /><span>{{ brand?.name }} needs approval: the post will be prepared in the brand window and wait in <RouterLink to="/approvals" class="link">Approvals</RouterLink>.</span></p>
            </div>
            <div class="btns">
              <Btn variant="signal" block :loading="submitting === 'submit'" :disabled="readOnly || !!errors.length || !!scheduleError" :title="errors[0] ?? scheduleError ?? undefined" @click="submit">{{ primaryLabel }}</Btn>
              <Btn block :loading="submitting === 'draft'" :disabled="readOnly || (!!editing && !isDraftEdit)" @click="saveDraft">{{ isDraftEdit ? 'Save draft' : 'Save as draft' }}</Btn>
            </div>
            <ul v-if="errors.length" class="todo tiny">
              <li v-for="e in errors" :key="e"><Icon name="info" :size="12" /><span>{{ e }}</span></li>
            </ul>
            <p v-if="reApproval" class="tiny muted mt-2">Changing the content sends it back for approval; changing only the time keeps the approval.</p>
            <p v-else-if="retrying" class="tiny muted mt-2">{{ approvalNote ? 'Saving prepares it again in the brand window for approval.' : 'Saving puts it back in the queue at the time above; accounts already posted are skipped.' }}</p>
            <p class="tiny muted keys mt-2"><kbd>Ctrl</kbd> <kbd>Enter</kbd> {{ primaryLabel.toLowerCase() }}<template v-if="!editing || isDraftEdit"> · <kbd>Ctrl</kbd> <kbd>S</kbd> draft</template></p>
          </div>

          <div v-if="!readOnly" class="panel pad">
            <FitPanel :rows="fitRows" :checking="fitChecking" :local="fitLocal" :empty="brandId ? 'Choose accounts to check the post against each platform.' : 'Choose a brand to start.'" />
          </div>

          <div class="panel pad">
            <div class="row between mb-3"><span class="label">Preview</span>
              <div v-if="platforms.length > 1" class="pvtabs">
                <button v-for="p in platforms" :key="p" type="button" :class="{ on: p === previewP }" :aria-label="PLATFORM_SPECS[p].name" :title="PLATFORM_SPECS[p].name" @click="previewP = p"><PlatformIcon :platform="p" :size="14" /></button>
              </div>
            </div>
            <PreviewCard v-if="previewP && previewAcc" :platform="previewP" :kind="kind" :handle="previewAcc.handle" :brand="brand" :caption="effCaption(previewP)" :title="perPlatform[previewP]?.title" :assets="assets" />
            <p v-else class="small muted">Choose an account to see a preview.</p>
          </div>
        </aside>
      </div>
    </div>

    <MediaPickerDrawer v-model:open="pickerOpen" :selected="multi ? assets.map(a => a.id) : []" :multi="multi" :kind="kind === 'image' ? 'image' : ['reel', 'video'].includes(kind) ? 'video' : null" @pick="onPick" />
    <AssetDrawer :asset="peek" @close="peek = null" @removed="id => { peek = null; assets = assets.filter(a => a.id !== id); }" />
    <DuplicateModal v-model:open="dupOpen" :from-brand-id="brandId" :platforms="platforms" :content="{ kind, assetIds: kind === 'text' ? [] : assets.map(a => a.id), caption, perPlatform: cleanPerPlatform() }" />
  </div>
</template>

<style scoped>
.cw { container-type: inline-size; transition: opacity 200ms; }
.cw.busy { opacity: .5; pointer-events: none; }
.cgrid { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s5); }
@container (min-width: 880px) {
  .cgrid { grid-template-columns: minmax(0, 1fr) 320px; align-items: start; }
  .side { position: sticky; top: calc(var(--topbar) + 20px); }
}
@container (min-width: 1120px) { .cgrid { grid-template-columns: minmax(0, 1fr) 360px; gap: var(--s6); } }
.maincol { display: flex; flex-direction: column; gap: var(--s6); min-width: 0; margin: 0; padding: 0; border: 0; }
.maincol:disabled .blk { opacity: .78; }
.errbox { display: flex; gap: 8px; align-items: flex-start; padding: 10px 14px; margin-bottom: var(--s5); border-radius: var(--r-lg); line-height: 1.45; overflow-wrap: anywhere; }
.errbox .icon { margin-top: 2px; flex: none; }
.errbox.bad { background: var(--bad-bg); color: var(--bad); }
.errbox.warn { background: var(--warn-bg); color: var(--warn); }
.leftout { line-height: 1.45; }
.ctr .tags { color: var(--muted); }
.ctr.over .tags { color: inherit; }
.results li { display: flex; align-items: center; gap: 10px; padding: 9px 0; border-top: 1px solid var(--line-soft); }
.results li:first-child { border-top: 0; padding-top: 0; }
.results .icon, .results .pi { flex: none; }
.minw { min-width: 0; }
.bad { color: var(--bad); }
.clamp2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.side { display: flex; flex-direction: column; gap: var(--s4); min-width: 0; }
.blk { min-width: 0; }
.bh { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--line); }
.n { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-family: var(--mono); font-size: var(--fs-2xs); background: var(--fg); color: var(--bg); flex: none; }
.brandrow { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.bp { width: min(360px, 100%); }
.cap { min-height: 120px; font-size: var(--fs-md); }
.counters { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.ctr { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 9px; border-radius: 99px; background: var(--panel-2); font-size: var(--fs-xs); color: var(--fg-2); }
.ctr.over { background: var(--bad-bg); color: var(--bad); }
.ov { font-family: var(--mono); font-size: var(--fs-2xs); text-transform: uppercase; color: var(--muted); }
.tabbody { padding-top: var(--s4); }
.actions .whenbody { margin-top: 14px; min-height: 64px; display: flex; flex-direction: column; gap: 8px; }
.dt { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 6px; align-items: center; }
.dt .input { min-height: 38px; padding: 7px 9px; }
.tz { color: var(--muted); }
.err { color: var(--bad); }
.appr { display: flex; gap: 8px; align-items: flex-start; padding: 9px 10px; border-radius: var(--r); background: var(--panel-2); color: var(--fg-2); line-height: 1.45; }
.appr .icon { margin-top: 1px; }
.btns { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; }
.todo { margin-top: 10px; display: flex; flex-direction: column; gap: 4px; color: var(--muted); }
.todo li { display: flex; align-items: center; gap: 6px; }
.pvtabs { display: inline-flex; gap: 2px; padding: 2px; border-radius: 99px; background: var(--panel-2); }
.pvtabs button { width: 28px; height: 24px; border-radius: 99px; display: grid; place-items: center; color: var(--muted); }
.pvtabs button.on { background: var(--fg); color: var(--bg); }
.banner { display: flex; align-items: center; gap: 8px; padding: 10px 14px; margin-bottom: var(--s5); border-radius: var(--r-lg); background: var(--panel-2); color: var(--fg-2); }
.unsaved { padding-right: 4px; }
</style>
