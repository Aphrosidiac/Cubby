<script setup lang="ts">
// Claude (PLAN 6.10): MCP status, connected clients, live runs, kill switch, Connect Claude Code,
// tokens, the guardrails explained, and what Claude did recently.
import { computed, onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { Activity, ApiToken } from '@shared/types';
import PageHeader from '@/components/ui/PageHeader.vue';
import Btn from '@/components/ui/Btn.vue';
import Chip from '@/components/ui/Chip.vue';
import Icon from '@/components/ui/Icon.vue';
import Segmented from '@/components/ui/Segmented.vue';
import CopyField from '@/components/ui/CopyField.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ActorChip from '@/components/activity/ActorChip.vue';
import TokenModal from '@/components/claude/TokenModal.vue';
import BrandAvatar from '@/components/common/BrandAvatar.vue';
import { GUARDRAILS } from '@/components/claude/guardrails';
import { detailLine, humanAction } from '@/components/activity/humanize';
import { brandById, brandName, useBrands } from '@/components/posts/meta';
import { api, on } from '@/lib/api';
import { app } from '@/lib/store';
import { ago, dateTime, plural } from '@/lib/format';
import { useLoad } from '@/composables/useLoad';
import { fail, ok, toast } from '@/composables/toast';
import { confirm } from '@/composables/confirm';

const router = useRouter();
const brands = useBrands();
const now = ref(Date.now());
const tick = window.setInterval(() => (now.value = Date.now()), 1000);
onBeforeUnmount(() => clearInterval(tick));

const status = computed(() => app.status);
const killed = computed(() => !!status.value?.killSwitch);
const clients = computed(() => (status.value?.mcpClients ?? []).map(c => ({ ...c, working: !!c.lastCallAt && now.value - new Date(c.lastCallAt).getTime() < 30_000 })));
const working = computed(() => clients.value.some(c => c.working) || (status.value?.runs ?? []).some(r => r.actor === 'claude'));
const runs = computed(() => status.value?.runs ?? []);
/** app.status reports a session's brand lock by NAME (mcp touch()); an id is accepted too. */
const lockBrand = (v: string) => brandById(v) ?? brands.list.find(b => b.name === v) ?? { name: v, color: null, logo: null };
const agoNow =(iso: string | null) => { void now.value; return iso ? ago(iso) : 'never'; };

// ── kill switch ───────────────────────────────────────────────────────────────
const killing = ref(false);
async function kill(onOff: boolean) {
  if (onOff && !(await confirm({ title: 'Stop all automation?', body: 'Aborts every running recipe, flow and Claude action now. Nothing new runs until you resume.', confirm: 'Stop everything', danger: true }))) return;
  killing.value = true;
  try { app.status = await api('app.killSwitch', { on: onOff }); toast(onOff ? 'Everything stopped' : 'Automation resumed', { tone: onOff ? 'warn' : 'good' }); }
  catch (e) { fail(e); }
  finally { killing.value = false; }
}

// ── connect Claude Code ──────────────────────────────────────────────────────
const scope = ref<'user' | 'local'>('user');
const restrict = ref<string[]>([]);
const connecting = ref(false);
const result = ref<{ ok: boolean; command: string; output: string; scope: 'user' | 'local' } | null>(null);
const toggleBrand = (id: string) => { restrict.value = restrict.value.includes(id) ? restrict.value.filter(x => x !== id) : [...restrict.value, id]; };
async function connect() {
  connecting.value = true;
  result.value = null;
  try {
    const s = scope.value;
    result.value = { ...(await api('claude.connect', { scope: s, brandIds: restrict.value.length ? restrict.value : null })), scope: s };
    if (result.value.ok) ok('Claude Code is connected', 'Restart any open Claude Code session to pick it up.');
    else if (s === 'local') toast('Command ready', { tone: 'good', body: 'Copy it below and run it inside the project’s folder. The token is shown only now.' });
    else toast('Run the command yourself', { tone: 'warn', body: 'Cubby couldn’t run claude mcp add here — copy the command below.' });
    void tokens.reload(true);
  } catch (e) { fail(e, 'Could not connect Claude Code'); }
  finally { connecting.value = false; }
}

// ── tokens ───────────────────────────────────────────────────────────────────
const tokens = useLoad(() => api('tokens.list'));
const activeTokens = computed(() => (tokens.data.value ?? []).filter(t => !t.revokedAt));
const revokedTokens = computed(() => (tokens.data.value ?? []).filter(t => t.revokedAt).sort((a, b) => String(b.revokedAt).localeCompare(String(a.revokedAt))));
const showRevoked = ref(false);
const tokenOpen = ref(false);
const revoking = ref<string | null>(null);
async function revoke(t: ApiToken) {
  if (!(await confirm({ title: `Revoke “${t.name}”?`, body: 'Anything using it (Claude Code, scripts) stops working immediately.', confirm: 'Revoke', danger: true }))) return;
  revoking.value = t.id;
  try { await api('tokens.revoke', { id: t.id }); ok('Token revoked', `“${t.name}” no longer works.`); await tokens.reload(true); } catch (e) { fail(e, 'Could not revoke the token'); }
  finally { revoking.value = null; }
}

// ── recent Claude activity ───────────────────────────────────────────────────
const recent = useLoad(() => api('activity.list', { actor: 'claude', limit: 12 }));
const offAct = on('activity.new', (a: Activity) => { if (a.actor === 'claude' && recent.data.value) recent.data.value = [a, ...recent.data.value].slice(0, 12); });
onBeforeUnmount(offAct);
</script>

<template>
  <div class="page claude">
    <PageHeader eyebrow="Control" title="Claude">
      <span>Claude drives brand windows through Cubby’s MCP server — every call goes through the guardrails below.</span>
    </PageHeader>

    <section class="hero" :class="{ killed, working: working && !killed }">
      <div class="state">
        <span class="big-dot" />
        <div>
          <div class="h2">{{ killed ? 'Stopped' : working ? 'Claude is working' : clients.length ? 'Connected, idle' : 'Ready' }}</div>
          <div class="small muted">
            <template v-if="killed">The kill switch is on. Nothing automated runs until you resume.</template>
            <template v-else-if="runs.length">{{ plural(runs.length, 'run') }} in progress.</template>
            <template v-else-if="clients.length">{{ plural(clients.length, 'client') }} connected.</template>
            <template v-else>No Claude session connected right now.</template>
          </div>
        </div>
      </div>
      <div class="hero-act">
        <button v-if="!killed" type="button" class="stopbtn" :disabled="killing" @click="kill(true)"><Icon name="stop" :size="18" /><span>Stop everything</span></button>
        <Btn v-else variant="signal" size="lg" icon="play" :loading="killing" @click="kill(false)">Resume</Btn>
      </div>
    </section>

    <div class="grid2 mt-5">
      <section class="panel">
        <div class="panel-head"><h2 class="h3">Server</h2><Chip :tone="status?.apiListening ? 'good' : 'bad'">{{ status?.apiListening ? 'Listening' : 'Not listening' }}</Chip></div>
        <div class="panel-body col gap-4">
          <CopyField label="MCP URL" :value="status?.mcpUrl ?? '—'" mono />
          <CopyField label="Local API" :value="status?.apiUrl ?? '—'" mono />
          <p v-if="!status?.apiListening" class="tiny warnt row gap-2 top"><Icon name="warn" :size="13" class="ti" /><span>Claude can’t reach Cubby: the API isn’t listening on that port (another app may hold it). Pick a free port in <RouterLink to="/settings?tab=api" class="link">Settings → Local API</RouterLink>.</span></p>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2 class="h3">Connected clients</h2><span class="tiny muted num">{{ clients.length }}</span></div>
        <div class="panel-body">
          <p v-if="!clients.length" class="small muted">When Claude Code connects with a Cubby token it shows here, with the brand it is locked to.</p>
          <ul v-else class="clients">
            <li v-for="c in clients" :key="c.sessionId">
              <span class="cdot" :class="{ on: c.working }" />
              <div class="grow">
                <div class="cname"><span class="small strong ellipsis" :title="c.tokenName">{{ c.tokenName }}</span><Chip v-if="c.working" size="sm" tone="signal">Working</Chip></div>
                <div class="tiny muted">connected {{ agoNow(c.connectedAt) }} · {{ c.lastCallAt ? `last call ${agoNow(c.lastCallAt)}` : 'no calls yet' }}</div>
                <!-- the brand this session is locked to (guardrail 1) -->
                <span v-if="c.brandLock" class="lock small" :title="`Locked to ${lockBrand(c.brandLock).name}`"><Icon name="lock" :size="12" /><BrandAvatar :brand="lockBrand(c.brandLock)" :size="16" /><span class="ellipsis">{{ lockBrand(c.brandLock).name }}</span></span>
                <span v-else class="lock none tiny muted"><Icon name="unlock" :size="12" />Not locked to a brand yet</span>
              </div>
            </li>
          </ul>
        </div>
      </section>
    </div>

    <section v-if="runs.length" class="mt-5">
      <div class="section-title"><h2 class="h3">Live runs</h2></div>
      <ul class="runs">
        <li v-for="r in runs" :key="r.runId">
          <button type="button" class="run" @click="router.push(`/runs/${r.runId}`)">
            <span class="ld" /><ActorChip :actor="r.actor" />
            <span class="small ellipsis rl"><b>{{ r.brandName }}</b> — {{ r.label }}</span>
            <span class="grow tiny muted ellipsis">{{ r.step ?? '' }}</span>
            <span class="tiny muted">{{ agoNow(r.startedAt) }}</span>
            <Icon name="arrow" :size="14" />
          </button>
        </li>
      </ul>
    </section>

    <div class="grid2 mt-6">
      <section class="panel">
        <div class="panel-head"><h2 class="h3">Connect Claude Code</h2></div>
        <div class="panel-body">
          <p class="small muted">Adds Cubby’s MCP server to Claude Code (<span class="code">claude mcp add</span>) with a fresh token scoped to read, browser, posting and flows.</p>
          <div class="mt-4 row wrap gap-4">
            <div><div class="flabel">Where</div><Segmented v-model="scope" size="sm" :options="[{ value: 'user', label: 'All projects' }, { value: 'local', label: 'One project' }]" /></div>
          </div>
          <p class="tiny muted mt-2">{{ scope === 'user' ? 'Every Claude Code session on this computer can use Cubby.' : 'Cubby gives you the command to run inside that project’s folder.' }}</p>
          <div class="mt-4">
            <div class="flabel">Brands Claude may use <span class="muted tiny">(none = all)</span></div>
            <div class="chips">
              <button v-for="b in brands.list" :key="b.id" type="button" class="bchip" :class="{ on: restrict.includes(b.id) }" :aria-pressed="restrict.includes(b.id)" :title="b.name" @click="toggleBrand(b.id)"><BrandAvatar :brand="b" :size="16" /><span class="ellipsis">{{ b.name }}</span><Icon v-if="restrict.includes(b.id)" name="check" :size="12" class="bk" /></button>
              <span v-if="!brands.list.length" class="tiny muted">No brands yet.</span>
            </div>
          </div>
          <Btn variant="primary" icon="claude" class="mt-5" :loading="connecting" @click="connect">{{ scope === 'user' ? 'Connect Claude Code' : 'Make the command' }}</Btn>
          <Transition name="slide-down">
            <div v-if="result" class="result-wrap">
              <div class="result mt-4">
                <div class="row gap-2 small" :class="result.ok ? 'okt' : 'warnt'"><Icon :name="result.ok ? 'check' : 'warn'" :size="14" />{{ result.ok ? 'Done — the MCP entry is written.' : result.scope === 'local' ? 'Run this inside the project’s folder:' : 'Couldn’t run it here. Paste this into a terminal:' }}</div>
                <CopyField :value="result.command" mono class="mt-2" />
                <p v-if="!result.ok" class="tiny muted mt-2">The command carries a new token — it is shown only now.</p>
                <pre v-if="result.output && result.scope === 'user'" class="out code">{{ result.output }}</pre>
              </div>
            </div>
          </Transition>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2 class="h3">Tokens</h2><Btn size="sm" icon="plus" @click="tokenOpen = true">New token</Btn></div>
        <div class="panel-body">
          <div v-if="tokens.loading.value" class="col"><div v-for="i in 3" :key="i" class="skel-line" style="height: 36px" /></div>
          <p v-else-if="tokens.error.value" class="small muted">Tokens aren’t available yet — {{ tokens.error.value }}</p>
          <template v-else>
            <p v-if="!activeTokens.length" class="small muted">No active tokens. Connecting Claude Code creates one.</p>
            <ul v-else class="tokens">
              <li v-for="t in activeTokens" :key="t.id">
                <div class="grow">
                  <div class="tname"><span class="small strong ellipsis" :title="t.name">{{ t.name }}</span><span class="code muted nowrap">{{ t.prefix }}…</span></div>
                  <div class="tiny muted">{{ t.scopes.join(' · ') }} · {{ t.brandIds?.length ? t.brandIds.map(brandName).join(', ') : 'all brands' }}</div>
                  <div class="tiny muted">created {{ dateTime(t.createdAt) }} · {{ t.lastUsedAt ? `used ${agoNow(t.lastUsedAt)}` : 'never used' }}</div>
                </div>
                <Btn size="sm" variant="danger" :loading="revoking === t.id" @click="revoke(t)">Revoke</Btn>
              </li>
            </ul>
            <!-- revoked tokens stay listed (folded) so "why did my script stop?" has an answer -->
            <div v-if="revokedTokens.length" class="revoked mt-4">
              <button type="button" class="rv-t tiny muted" :aria-expanded="showRevoked" @click="showRevoked = !showRevoked">
                <Icon name="chevron-down" :size="12" class="chev" :class="{ rot: showRevoked }" />{{ plural(revokedTokens.length, 'revoked token') }}
              </button>
              <Transition name="slide-down">
                <div v-if="showRevoked" class="rv-wrap">
                  <ul class="tokens rv">
                    <li v-for="t in revokedTokens" :key="t.id">
                      <div class="grow">
                        <div class="tname"><span class="small ellipsis" :title="t.name">{{ t.name }}</span><span class="code muted nowrap">{{ t.prefix }}…</span></div>
                        <div class="tiny muted">created {{ dateTime(t.createdAt) }} · revoked {{ dateTime(t.revokedAt) }}</div>
                      </div>
                      <Chip size="sm" tone="muted">Revoked</Chip>
                    </li>
                  </ul>
                </div>
              </Transition>
            </div>
          </template>
          <p class="tiny muted mt-4">Full token settings live in <RouterLink to="/settings?tab=api" class="link">Settings → Local API</RouterLink>.</p>
        </div>
      </section>
    </div>

    <section class="mt-7">
      <div class="section-title"><h2 class="h3">Guardrails</h2><span class="tiny muted">Enforced by the app for every Claude call</span></div>
      <ul class="guards">
        <li v-for="(g, i) in GUARDRAILS" :key="g.title">
          <span class="gn num">{{ i + 1 }}</span>
          <div><div class="row gap-2"><Icon :name="g.icon" :size="15" /><span class="strong small">{{ g.title }}</span></div><p class="small muted mt-2">{{ g.body }}</p></div>
        </li>
      </ul>
    </section>

    <section class="mt-7">
      <div class="section-title"><h2 class="h3">What Claude did recently</h2><RouterLink to="/activity" class="tiny link muted">All activity</RouterLink></div>
      <div v-if="recent.loading.value" class="col"><div v-for="i in 4" :key="i" class="skel-line" style="height: 34px" /></div>
      <p v-else-if="recent.error.value" class="small muted">Could not load activity — {{ recent.error.value }}</p>
      <EmptyState v-else-if="!recent.data.value?.length" compact icon="claude" title="Nothing yet" body="Every tool call Claude makes through Cubby is recorded here." />
      <ul v-else class="recent">
        <li v-for="a in recent.data.value" :key="a.id" :class="{ failed: humanAction(a).failed, guard: humanAction(a).guard }">
          <span class="tiny muted num t" :title="dateTime(a.at)">{{ agoNow(a.at) }}</span>
          <span class="small b ellipsis" :class="{ muted: !a.brandName }" :title="a.brandName ?? undefined">{{ a.brandName ?? '—' }}</span>
          <span class="small strong a ellipsis" :title="humanAction(a).text"><Icon v-if="humanAction(a).guard" name="shield" :size="13" class="gi" />{{ humanAction(a).text }}</span>
          <span class="tiny muted grow ellipsis" :title="detailLine(a) || undefined">{{ detailLine(a) }}</span>
        </li>
      </ul>
    </section>

    <TokenModal v-model:open="tokenOpen" @created="tokens.reload(true)" />
  </div>
</template>

<style scoped>
.hero { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 22px 24px; border-radius: var(--r-lg); border: 1px solid var(--line); background: var(--panel); flex-wrap: wrap; }
.state { display: flex; align-items: center; gap: 16px; }
.big-dot { position: relative; width: 14px; height: 14px; border-radius: 50%; background: var(--faint); flex: none; }
.working .big-dot { background: var(--lime); box-shadow: 0 0 0 1.5px var(--ink); }
.working .big-dot::after { content: ''; position: absolute; inset: 0; border-radius: 50%; background: var(--lime); animation: ff-pulse 1.8s var(--ease-out) infinite; }
.killed { border-color: color-mix(in srgb, var(--bad) 45%, var(--line)); background: var(--bad-bg); }
.killed .big-dot { background: var(--bad); }
.stopbtn { display: inline-flex; align-items: center; gap: 10px; height: 52px; padding: 0 26px; border-radius: 99px; background: #b3261e; color: #fff; font-size: var(--fs-md); font-weight: 600; transition: transform 160ms var(--ease-out), filter 200ms; }
.stopbtn:hover { filter: brightness(1.08); }
.stopbtn:active { transform: scale(.97); }
.stopbtn:disabled { opacity: .6; cursor: progress; }
.stopbtn:focus-visible { outline-color: var(--lime); }
.hero .state { min-width: 0; }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: var(--s4); align-items: start; }
.clients li, .tokens li { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--line-soft); }
.clients li:first-child, .tokens li:first-child { border-top: 0; padding-top: 0; }
.cdot { width: 8px; height: 8px; border-radius: 50%; background: var(--good); flex: none; }
.cdot.on { background: var(--lime); box-shadow: 0 0 0 1px var(--ink); }
.lock { display: inline-flex; align-items: center; gap: 6px; margin-top: 8px; padding: 3px 9px 3px 7px; border-radius: 99px; background: var(--panel-2); max-width: 100%; min-width: 0; }
.lock.none { background: none; padding-left: 0; }
.cname { display: flex; align-items: center; gap: 8px; min-width: 0; }
.cname > .chip { flex: none; }
.clients li { align-items: flex-start; }
.clients .cdot { margin-top: 6px; }
.lock > .icon, .lock > .ba { flex: none; }
.tname { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.ti { margin-top: 2px; flex: none; }
.rl { min-width: 0; flex: 0 1 auto; }
.revoked { border-top: 1px solid var(--line-soft); padding-top: 10px; }
.rv-t { display: inline-flex; align-items: center; gap: 6px; padding: 2px 4px; margin-left: -4px; border-radius: var(--r); }
.rv-t:hover { color: var(--fg); }
.rv-t .chev { transition: transform 240ms var(--ease-out); }
.rot { transform: rotate(180deg); }
.rv { margin-top: 8px; }
.rv li { padding: 8px 0; }
.rv li:first-child { padding-top: 8px; border-top: 1px solid var(--line-soft); }
.runs { display: flex; flex-direction: column; gap: 6px; }
.run { width: 100%; display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: var(--r-lg); border: 1px solid var(--line); background: var(--panel); text-align: left; }
.run:hover { border-color: var(--fg); }
.ld { width: 8px; height: 8px; border-radius: 50%; background: var(--lime); box-shadow: 0 0 0 1px var(--ink); animation: ff-pulse 1.6s var(--ease-out) infinite; flex: none; }
.flabel { font-size: var(--fs-sm); font-weight: 500; color: var(--fg-2); margin-bottom: 8px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.bchip { display: inline-flex; align-items: center; gap: 6px; height: 30px; max-width: 220px; padding: 0 11px 0 7px; border-radius: 99px; border: 1px solid var(--line); font-size: var(--fs-sm); transition: border-color var(--t-micro), background-color var(--t-micro); }
.bchip:hover { border-color: var(--line-strong); }
.bchip.on { border-color: var(--fg); background: var(--panel-2); }
.bchip > .ba, .bchip > .bk { flex: none; }
.result-wrap { min-width: 0; }
.result { padding: 12px; border-radius: var(--r); background: var(--bg-elev); border: 1px solid var(--line-soft); }
.okt { color: var(--good); } .warnt { color: var(--warn); }
.out { margin: 10px 0 0; white-space: pre-wrap; max-height: 160px; overflow: auto; color: var(--fg-2); }
/* hairlines drawn by each cell (right + bottom, the outer ones clipped by the frame), so a
   half-filled last row never shows an empty grey cell */
.guards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); background: var(--panel); border: 1px solid var(--line); border-radius: var(--r-lg); overflow: hidden; }
.guards li { display: flex; gap: 12px; padding: 16px; box-shadow: 1px 0 0 var(--line), 0 1px 0 var(--line); }
.gn { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-family: var(--mono); font-size: var(--fs-2xs); background: var(--fg); color: var(--bg); flex: none; }
.recent li { display: grid; grid-template-columns: 90px 130px auto minmax(0, 1fr); gap: 12px; align-items: center; padding: 9px 4px; border-bottom: 1px solid var(--line-soft); }
.recent li.failed .a { color: var(--bad); }
.recent li.guard .a { color: var(--warn); }
.gi { display: inline; vertical-align: -2px; margin-right: 5px; }
</style>
