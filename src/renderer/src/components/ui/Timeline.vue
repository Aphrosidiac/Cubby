<script setup lang="ts">
import Icon from './Icon.vue';
import { ago, dateTime } from '@/lib/format';

/** Activity / history feed. Items rise in one after another. */
defineProps<{ items: { id: string; at: string; kind?: string; body: string; actor?: string | null; title?: string | null }[]; empty?: string }>();
const ICON: Record<string, string> = { NOTE: 'note', CALL: 'call', WHATSAPP: 'whatsapp', EMAIL: 'mail', MEETING: 'meeting', SYSTEM: 'bolt', AUDIT: 'pulse', STAGE: 'flag' };
</script>

<template>
  <ol v-if="items.length" class="ff-timeline">
    <li v-for="(it, i) in items" :key="it.id" :style="{ '--i': Math.min(i, 12) }" :class="`k-${(it.kind ?? 'NOTE').toLowerCase()}`">
      <span class="dot"><Icon :name="ICON[it.kind ?? 'NOTE'] ?? 'note'" :size="13" /></span>
      <div class="body">
        <div v-if="it.title" class="h3 t">{{ it.title }}</div>
        <div class="txt pre">{{ it.body }}</div>
        <div class="meta"><span :title="dateTime(it.at)">{{ ago(it.at) }}</span><span v-if="it.actor">· {{ it.actor }}</span></div>
      </div>
    </li>
  </ol>
  <p v-else class="muted small">{{ empty ?? 'Nothing yet.' }}</p>
</template>

<style scoped>
.ff-timeline { position: relative; }
.ff-timeline::before { content: ''; position: absolute; left: 13px; top: 8px; bottom: 8px; width: 1px; background: var(--line); transform-origin: top; animation: ff-grow-y .9s var(--ease-out) both; }
li { position: relative; display: flex; gap: 14px; padding: 6px 0 16px; animation: ff-rise .6s var(--ease-out) backwards; animation-delay: calc(var(--i) * 40ms + 80ms); }
.dot { position: relative; z-index: 1; width: 27px; height: 27px; flex: none; display: grid; place-items: center; border-radius: 50%; background: var(--bg); border: 1px solid var(--line); color: var(--muted); }
.k-system .dot, .k-audit .dot { color: var(--fg); }
.k-whatsapp .dot { color: var(--good); }
.body { min-width: 0; padding-top: 3px; }
.t { margin-bottom: 2px; }
.txt { font-size: var(--fs-base); line-height: 1.5; color: var(--fg-2); overflow-wrap: anywhere; }
.meta { margin-top: 4px; font-size: var(--fs-xs); color: var(--muted); display: flex; gap: 6px; }
</style>
