<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { NAV, NAV_FOOT, type NavItem } from '@/lib/nav'
import Icon from '../ui/Icon.vue'
import CubbyMark from './CubbyMark.vue'

/** Always Ink. The Signal Lime marker slides to the active item; collapsing keeps icons and badges. */
const props = defineProps<{ counts: Record<string, number>; collapsed: boolean }>()
defineEmits<{ toggle: [] }>()
const route = useRoute()
const nav = ref<HTMLElement | null>(null)
const marker = ref({ y: 0, h: 0, show: false })
const isActive = (it: NavItem) =>
  it.exact ? route.path === it.to || route.path.startsWith('/brands') : route.path === it.to || route.path.startsWith(`${it.to}/`) || (it.to === '/flows' && route.path.startsWith('/runs'))
function place() {
  const el = nav.value?.querySelector<HTMLElement>('a.active')
  if (!el || !nav.value) {
    marker.value.show = false
    return
  }
  marker.value = { y: el.offsetTop, h: el.offsetHeight, show: true }
}
watch(() => [route.path, props.collapsed], () => nextTick(place))
onMounted(() => {
  void nextTick(place)
  document.fonts?.ready.then(place)
})
</script>

<template>
  <aside class="side" :class="{ collapsed }">
    <div class="brand">
      <RouterLink to="/" class="logo" aria-label="Cubby — brands">
        <CubbyMark :size="collapsed ? 26 : 24" />
        <span v-if="!collapsed" class="name">Cubby</span>
      </RouterLink>
      <button v-if="!collapsed" type="button" class="collapse" aria-label="Collapse sidebar" title="Collapse sidebar" @click="$emit('toggle')"><Icon name="sidebar" :size="16" /></button>
    </div>
    <button v-if="collapsed" type="button" class="collapse expand" aria-label="Expand sidebar" title="Expand sidebar" @click="$emit('toggle')"><Icon name="sidebar" :size="16" /></button>
    <nav ref="nav" class="nav" aria-label="Main">
      <span class="marker" :class="{ show: marker.show }" :style="{ transform: `translateY(${marker.y}px)`, height: `${marker.h}px` }" />
      <template v-for="(g, gi) in NAV" :key="gi">
        <div v-if="g.group" class="group"><span v-if="!collapsed">{{ g.group }}</span><span v-else class="gline" /></div>
        <RouterLink v-for="(it, i) in g.items" :key="it.to" :to="it.to" :class="{ active: isActive(it) }" :title="collapsed ? it.label : undefined" :style="{ '--i': gi * 4 + i }">
          <Icon :name="it.icon" :size="18" />
          <span v-if="!collapsed" class="txt">{{ it.label }}</span>
          <Transition name="pop">
            <span v-if="it.badge && counts[it.badge]" :key="counts[it.badge]" class="badge num" :class="it.tone">{{ counts[it.badge] }}</span>
          </Transition>
        </RouterLink>
      </template>
    </nav>
    <div class="foot">
      <RouterLink v-for="it in NAV_FOOT" :key="it.to" :to="it.to" :class="{ active: route.path.startsWith(it.to) }" :title="collapsed ? it.label : undefined">
        <Icon :name="it.icon" :size="18" /><span v-if="!collapsed" class="txt">{{ it.label }}</span>
      </RouterLink>
    </div>
  </aside>
</template>

<style scoped>
.side { position: fixed; inset: 0 auto 0 0; z-index: 300; width: var(--sidebar); display: flex; flex-direction: column; background: var(--side-bg); color: var(--side-fg); border-right: 1px solid var(--side-line); transition: width 520ms var(--ease-out); -webkit-app-region: drag; }
.side a, .side button { -webkit-app-region: no-drag; }
.collapsed { width: var(--sidebar-rail); }
.brand { display: flex; align-items: center; justify-content: space-between; gap: 8px; height: var(--topbar); padding: 0 12px 0 20px; }
.mac .brand { padding-left: 86px; }
.collapsed .brand { padding: 0; justify-content: center; }
.mac .collapsed .brand { padding-top: 26px; }
.logo { display: flex; align-items: center; gap: 10px; color: var(--side-fg); }
.name { font-size: var(--fs-md); font-weight: 600; letter-spacing: -.01em; }
.collapse { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px; color: var(--side-muted); transition: background-color 200ms, color 200ms; }
.collapse:hover { background: var(--side-hover); color: var(--side-fg); }
.expand { margin: 0 auto 4px; }
.nav { position: relative; flex: 1; overflow-y: auto; overflow-x: hidden; padding: 6px 10px 28px; scrollbar-color: #2a2a27 transparent; }
.group { margin: 16px 12px 6px; font-family: var(--mono); font-size: var(--fs-2xs); letter-spacing: .12em; text-transform: uppercase; color: var(--side-muted); height: 12px; display: flex; align-items: center; }
.gline { display: block; width: 100%; height: 1px; background: var(--side-line); }
.collapsed .group { margin: 12px 8px 6px; }
.nav a, .foot a { position: relative; z-index: 1; display: flex; align-items: center; gap: 12px; height: 38px; padding: 0 12px; border-radius: 8px; font-size: var(--fs-base); font-weight: 500; color: rgba(243, 239, 228, .72); transition: color 220ms, background-color 220ms; white-space: nowrap; animation: ff-rise .6s var(--ease-out) backwards; animation-delay: calc(var(--i, 0) * 22ms + 120ms); }
.collapsed .nav a, .collapsed .foot a { justify-content: center; padding: 0; }
.nav a:hover, .foot a:hover { color: var(--side-fg); background: var(--side-hover); }
.nav a.active, .foot a.active { color: var(--side-fg); }
.foot a.active { background: #1b1b19; }
.txt { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.marker { position: absolute; left: 10px; right: 10px; top: 0; z-index: 0; border-radius: 8px; background: #1b1b19; opacity: 0; transition: transform 560ms var(--ease-toggle), height 400ms var(--ease-out), opacity 200ms; pointer-events: none; }
.marker::before { content: ''; position: absolute; left: -10px; top: 9px; bottom: 9px; width: 3px; border-radius: 0 3px 3px 0; background: var(--lime); }
.marker.show { opacity: 1; }
.badge { min-width: 20px; height: 18px; padding: 0 6px; border-radius: 99px; display: grid; place-items: center; font-family: var(--mono); font-size: var(--fs-2xs); background: rgba(243, 239, 228, .12); color: var(--side-fg); }
.badge.signal { background: var(--lime); color: var(--ink); }
.badge.bad { background: #ff8a80; color: var(--ink); }
.collapsed .badge { position: absolute; top: 3px; right: 6px; min-width: 16px; height: 15px; padding: 0 4px; }
.foot { padding: 10px; border-top: 1px solid var(--side-line); display: flex; flex-direction: column; gap: 2px; }
</style>
