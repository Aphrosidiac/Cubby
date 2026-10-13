<script setup lang="ts">
import { computed, ref } from 'vue';
import type { BrandRow } from '@shared/types';
import { PLATFORM_SPECS } from '@shared/platforms';
import Btn from '@/components/ui/Btn.vue';
import Chip from '@/components/ui/Chip.vue';
import Icon from '@/components/ui/Icon.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import PlatformIcon from '@/components/common/PlatformIcon.vue';
import LoadError from '@/components/common/LoadError.vue';
import BrandStatus from '../BrandStatus.vue';
import { LOGIN_LABEL, LOGIN_TONE, TIER_LABEL, handleText } from '@/components/common/login';
import { postStatus, KIND_LABEL } from '@/components/posts/meta';
import { humanAction, detailLine } from '@/components/activity/humanize';
import { api, isMac } from '@/lib/api';
import { useLoad } from '@/composables/useLoad';
import { fail, ok, toast } from '@/composables/toast';
import { ago, date, dateTime } from '@/lib/format';
import { capital } from '@/components/common/text';

/** Brand at a glance: window, login health per platform (Check now), what's scheduled next, what happened lately. */
const props = defineProps<{ brand: BrandRow }>();
const emit = defineEmits<{ tab: [t: string] }>();
const posts = useLoad(() => api('posts.list', { brandId: props.brand.id, status: ['ready_for_approval', 'approved', 'queued', 'running', 'needs_human'], from: new Date(Date.now() - 3600_000).toISOString(), limit: 6 }), { topics: ['posts.changed'] });
const activity = useLoad(() => api('activity.list', { brandId: props.brand.id, limit: 8 }), { topics: ['activity.new'] });
const binned = computed(() => !!props.brand.deletedAt);
const checking = ref(false);
async function check() {
  checking.value = true;
  try {
    const r = await api('health.check', { brandId: props.brand.id });
    const bad = r.filter(a => a.loginState === 'expired' || a.loginState === 'expiring').length;
    if (bad) toast(`${bad} login${bad === 1 ? '' : 's'} need${bad === 1 ? 's' : ''} attention`, { tone: 'warn' }); else ok('All logins look fine');
  } catch (e) { fail(e, 'Health check failed'); } finally { checking.value = false; }
}
const upcoming = computed(() => (posts.data.value ?? []).slice().sort((a, b) => (a.scheduledAt ?? '9').localeCompare(b.scheduledAt ?? '9')));
const isPast = (d: string) => new Date(d) < new Date();
const ACTOR: Record<string, string> = { you: 'You', claude: 'Claude', scheduler: 'Scheduler', flow: 'Flow', api: 'Local API' };
const profileShort = computed(() => {
  const p = props.brand.profileDir.split(/[\\/]/).slice(-2).join('/');
  return { head: p.slice(0, Math.max(0, p.length - 12)), tail: p.slice(-12) };
});
const revealProfile = () => api('app.revealPath', { path: props.brand.profileDir }).catch(e => fail(e));
</script>

<template>
  <div class="ov">
    <section class="panel">
      <header class="panel-head"><h3 class="h3">Window</h3><BrandStatus :status="brand.status" :error="brand.statusError" /></header>
      <div class="panel-body">
        <dl class="facts">
          <dt>Last opened</dt><dd :title="brand.lastOpenedAt ? dateTime(brand.lastOpenedAt) : undefined">{{ brand.lastOpenedAt ? capital(ago(brand.lastOpenedAt)) : 'Never' }}</dd>
          <dt>Window</dt><dd class="num">{{ brand.window.width }} × {{ brand.window.height }}</dd>
          <dt>Approval</dt><dd>{{ brand.approvalRequired ? 'Posts wait for approval' : 'Not required' }}</dd>
          <dt>Profile folder</dt><dd class="pd"><button type="button" class="link small path" :title="`${brand.profileDir} — show in ${isMac ? 'Finder' : 'Explorer'}`" @click="revealProfile"><span class="ph">{{ profileShort.head }}</span><span class="pt">{{ profileShort.tail }}</span></button></dd>
        </dl>
        <p v-if="brand.status === 'error'" class="err small mt-3"><Icon name="warn" :size="14" /><span>{{ brand.statusError || 'Chrome stopped unexpectedly.' }}</span></p>
      </div>
    </section>

    <section class="panel">
      <header class="panel-head"><h3 class="h3">Logins</h3><Btn size="sm" icon="refresh" :loading="checking" :disabled="!brand.accounts.length || binned" :title="binned ? 'Restore the brand to check its logins' : undefined" @click="check">Check now</Btn></header>
      <ul v-if="brand.accounts.length" class="logins">
        <li v-for="a in brand.accounts" :key="a.id">
          <PlatformIcon :platform="a.platform" :size="18" colored />
          <div class="grow">
            <div class="small one"><span class="strong">{{ PLATFORM_SPECS[a.platform].name }}</span><span class="muted ellipsis" :title="handleText(a.platform, a.handle)">{{ handleText(a.platform, a.handle) }}</span></div>
            <div class="tiny muted">{{ TIER_LABEL[a.ageTier] }}<template v-if="a.cookieExpiresAt"> · <span :title="dateTime(a.cookieExpiresAt)">session {{ isPast(a.cookieExpiresAt) ? 'expired' : 'until' }} {{ date(a.cookieExpiresAt) }}</span></template></div>
          </div>
          <Chip :tone="LOGIN_TONE[a.loginState]" size="sm">{{ LOGIN_LABEL[a.loginState] }}</Chip>
        </li>
      </ul>
      <EmptyState v-else compact icon="users" title="No accounts yet" body="Add the platforms this brand posts to."><Btn size="sm" icon="plus" @click="emit('tab', 'accounts')">Add account</Btn></EmptyState>
    </section>

    <section class="panel">
      <header class="panel-head"><h3 class="h3">Coming up</h3><Btn v-if="!binned" size="sm" icon="compose" :to="`/compose?brand=${brand.id}`">New post</Btn></header>
      <LoadError v-if="posts.error.value" compact :error="posts.error.value" title="Could not load posts" class="m" @retry="posts.reload()" />
      <div v-else-if="posts.loading.value" class="panel-body"><div class="skel-line" style="width: 70%" /><div class="skel-line mt-3" style="width: 50%" /></div>
      <ul v-else-if="upcoming.length" class="list">
        <li v-for="p in upcoming" :key="p.id">
          <RouterLink :to="`/compose?post=${p.id}`" class="li">
            <div class="grow"><div class="small ellipsis" :title="p.caption || undefined">{{ p.caption || KIND_LABEL[p.kind] }}</div><div class="tiny muted">{{ KIND_LABEL[p.kind] }} · {{ p.scheduledAt ? dateTime(p.scheduledAt) : 'Not scheduled' }}</div></div>
            <Chip :tone="postStatus(p.status).tone" size="sm">{{ postStatus(p.status).label }}</Chip>
          </RouterLink>
        </li>
      </ul>
      <EmptyState v-else compact icon="calendar" title="Nothing scheduled" body="Posts waiting for approval or queued to publish show here." />
    </section>

    <section class="panel">
      <header class="panel-head"><h3 class="h3">Recent activity</h3><Btn size="sm" icon="activity" @click="emit('tab', 'activity')">All activity</Btn></header>
      <LoadError v-if="activity.error.value" compact :error="activity.error.value" class="m" @retry="activity.reload()" />
      <div v-else-if="activity.loading.value" class="panel-body"><div class="skel-line" style="width: 60%" /><div class="skel-line mt-3" style="width: 40%" /></div>
      <ul v-else-if="activity.data.value?.length" class="list">
        <li v-for="a in activity.data.value" :key="a.id" class="li static">
          <span class="dot" :class="{ bad: humanAction(a).failed }" />
          <div class="grow">
            <div class="small one" :title="detailLine(a) ? `${humanAction(a).text} — ${detailLine(a)}` : humanAction(a).text"><span class="t" :class="{ bad: humanAction(a).failed }">{{ humanAction(a).text }}</span><span v-if="detailLine(a)" class="muted ellipsis">— {{ detailLine(a) }}</span></div>
            <div class="tiny muted" :title="dateTime(a.at)">{{ ago(a.at) }} · {{ ACTOR[a.actor] ?? a.actor }}</div>
          </div>
        </li>
      </ul>
      <EmptyState v-else compact icon="activity" title="Nothing yet" body="Opening the brand, posting and login checks show here." />
    </section>
  </div>
</template>

<style scoped>
.ov { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: stretch; }
/* cards in a row share one height; an empty state centres in the space left */
.ov > .panel { display: flex; flex-direction: column; }
.ov > .panel > :last-child:not(.panel-head) { flex: 1 1 auto; }
.ov > .panel > .ff-empty { justify-content: center; }
@media (max-width: 1180px) { .ov { grid-template-columns: minmax(0, 1fr); } }
/* every head the same height whether it holds a chip, a button or a link */
.panel-head { min-height: 64px; }
/* middle truncation: the start gives way, the last characters of the folder name stay */
.pd { display: flex; justify-content: flex-end; }
.path { display: inline-flex; max-width: 100%; min-width: 0; white-space: nowrap; }
.path .ph { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.path .pt { flex: none; }
.err { display: flex; align-items: flex-start; gap: 6px; color: var(--bad); }
.err :deep(svg) { flex: none; margin-top: 2px; }
.logins li, .li { display: flex; align-items: center; gap: 12px; padding: 12px 20px; border-top: 1px solid var(--line-soft); }
.logins li:first-child, .list li:first-child .li, .list li.li:first-child { border-top: 0; }
a.li { transition: background-color 160ms; }
a.li:hover { background: var(--panel-hover); }
a.li:active { background: var(--panel-2); }
.grow { min-width: 0; }
/* action + detail on one line: the action stays whole, the detail truncates */
.one { display: flex; align-items: baseline; gap: .3em; min-width: 0; }
.one > * { white-space: nowrap; }
.one .t, .one .strong { flex: none; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.t.bad { color: var(--bad); }
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--line-strong); flex: none; }
.dot.bad { background: var(--bad); }
.m { margin: 14px; }
</style>
