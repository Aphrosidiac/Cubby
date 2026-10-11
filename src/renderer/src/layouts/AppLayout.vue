<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Sidebar from '@/components/shell/Sidebar.vue'
import CommandPalette from '@/components/shell/CommandPalette.vue'
import Icon from '@/components/ui/Icon.vue'
import Menu from '@/components/ui/Menu.vue'
import Btn from '@/components/ui/Btn.vue'
import { api, isMac, modKey, on } from '@/lib/api'
import { NAV, NAV_FOOT } from '@/lib/nav'
import { app, setTheme } from '@/lib/store'
import { toast, fail } from '@/composables/toast'
import { useShortcuts } from '@/composables/shortcuts'
import { confirm } from '@/composables/confirm'

const router = useRouter()
const collapsed = ref(localStorage.getItem('cubby-side') === 'rail')
const palette = ref(false)
const toggleSide = () => {
  collapsed.value = !collapsed.value
  try {
    localStorage.setItem('cubby-side', collapsed.value ? 'rail' : 'full')
  } catch {
    /* ignore */
  }
}

const counts = computed(() => ({
  needsRelogin: app.status?.needsRelogin ?? 0,
  approvals: app.status?.approvalsCount ?? 0,
  runs: app.status?.runs.length ?? 0
}))
const claudeRun = computed(() => app.status?.runs.find((r) => r.actor === 'claude') ?? app.status?.runs[0] ?? null)

async function kill(onOff: boolean) {
  try {
    if (onOff && !(await confirm({ title: 'Stop all automation?', body: 'Aborts every running recipe, flow and Claude action now. Nothing new runs until you resume.', confirm: 'Stop everything', danger: true }))) return
    app.status = await api('app.killSwitch', { on: onOff })
    toast(onOff ? 'Everything stopped' : 'Automation resumed', { tone: onOff ? 'warn' : 'good' })
  } catch (e) {
    fail(e)
  }
}

const offs: (() => void)[] = []
onMounted(() => {
  offs.push(on('navigate', ({ path }) => void router.push(path)))
  offs.push(
    on('toast', ({ kind, message }) => {
      toast(message, { tone: kind === 'info' ? 'neutral' : kind })
    })
  )
})
onBeforeUnmount(() => offs.forEach((f) => f()))

const shortcuts: Record<string, () => void> = {
  'mod+k': () => (palette.value = !palette.value),
  '/': () => (palette.value = true),
  'n b': () => void router.push('/brands/new'),
  'n p': () => void router.push('/compose')
}
for (const it of [...NAV.flatMap((g) => g.items), ...NAV_FOOT]) if (it.shortcut) shortcuts[it.shortcut] = () => void router.push(it.to)
useShortcuts(shortcuts)

const THEME = [
  { label: 'Light', icon: 'sun', run: () => void setTheme('light') },
  { label: 'Dark', icon: 'moon', run: () => void setTheme('dark') },
  { label: 'Match system', icon: 'monitor', run: () => void setTheme('system') }
]
const themeIcon = computed(() => (app.settings?.theme === 'dark' ? 'moon' : app.settings?.theme === 'light' ? 'sun' : 'monitor'))
</script>

<template>
  <div class="shell" :class="{ rail: collapsed, mac: isMac }">
    <Sidebar :counts="counts" :collapsed="collapsed" @toggle="toggleSide" />
    <div class="main">
      <header class="top">
        <button class="search" aria-label="Search or jump to" @click="palette = true">
          <Icon name="search" :size="16" /><span class="grow search-t">Search brands, handles, pages…</span><kbd>{{ modKey }} K</kbd>
        </button>
        <div class="grow" />
        <Transition name="fade">
          <button v-if="app.status?.killSwitch" class="pill stopped" title="Kill switch is on — click to resume" @click="kill(false)"><span class="dot" />Stopped · Resume</button>
          <RouterLink v-else-if="claudeRun" to="/claude" class="pill working" :title="claudeRun.step ?? claudeRun.label">
            <span class="dot" />{{ claudeRun.actor === 'claude' ? 'Claude' : claudeRun.actor === 'scheduler' ? 'Scheduler' : 'Flow' }} · {{ claudeRun.brandName }}
          </RouterLink>
        </Transition>
        <button v-if="!app.status?.killSwitch" class="stop" title="Stop all automation (kill switch)" @click="kill(true)"><Icon name="stop" :size="14" /><span>Stop</span></button>
        <Btn variant="primary" size="sm" icon="plus" to="/brands/new">New brand</Btn>
        <Menu :items="THEME" :width="190">
          <button class="theme" :aria-label="`Theme`"><Icon :name="themeIcon" :size="17" /></button>
        </Menu>
        <div class="wc-space" />
      </header>
      <main class="content">
        <RouterView v-slot="{ Component, route: r }">
          <Transition name="route" mode="out-in">
            <div :key="(r.meta.key as string) ?? r.path" class="route-wrap"><component :is="Component" /></div>
          </Transition>
        </RouterView>
      </main>
    </div>
    <CommandPalette v-model:open="palette" />
  </div>
</template>

<style scoped>
.shell { min-height: 100vh; }
.main { margin-left: var(--sidebar); transition: margin-left 520ms var(--ease-out); min-width: 0; overflow-x: clip; }
.rail .main { margin-left: var(--sidebar-rail); }
.top { position: sticky; top: 0; z-index: 200; height: var(--topbar); display: flex; align-items: center; gap: 10px; padding: 0 0 0 28px; background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(12px); border-bottom: 1px solid var(--line-soft); -webkit-app-region: drag; }
.top > * { -webkit-app-region: no-drag; }
.top .grow { -webkit-app-region: drag; }
.wc-space { width: 140px; flex: none; -webkit-app-region: drag; }
.mac .wc-space { width: 16px; }
.search { display: flex; align-items: center; gap: 10px; width: min(420px, 38vw); height: 36px; padding: 0 8px 0 14px; border-radius: var(--r-pill); border: 1px solid var(--line); background: var(--panel); color: var(--muted); font-size: var(--fs-base); text-align: left; transition: border-color 200ms, box-shadow 300ms var(--ease-out); }
.search:hover { border-color: var(--line-strong); box-shadow: var(--shadow-1); }
.search-t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.search kbd { white-space: nowrap; flex: none; }
.pill { display: inline-flex; align-items: center; gap: 8px; height: 30px; padding: 0 12px; border-radius: 99px; font-size: var(--fs-sm); font-weight: 500; white-space: nowrap; }
.pill .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; position: relative; }
.pill .dot::after { content: ''; position: absolute; inset: 0; border-radius: 50%; background: currentColor; animation: ff-pulse 2.4s var(--ease-out) infinite; }
.working { background: var(--info-bg); color: var(--info); }
.stopped { background: var(--bad-bg); color: var(--bad); }
.stop { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border-radius: 99px; border: 1px solid color-mix(in srgb, var(--bad) 35%, transparent); color: var(--bad); font-size: var(--fs-sm); font-weight: 500; transition: background-color 200ms, color 200ms; }
.stop:hover { background: var(--bad); color: #fff; }
.theme { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 50%; color: var(--fg-2); transition: background-color 200ms, color 200ms; }
.theme:hover { background: var(--panel-2); color: var(--fg); }
.content { padding: 32px 40px 96px; max-width: 1560px; margin: 0 auto; }
.route-wrap { position: relative; }
</style>
