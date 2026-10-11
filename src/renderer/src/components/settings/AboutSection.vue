<script setup lang="ts">
import Btn from '@/components/ui/Btn.vue';
import CubbyMark from '@/components/shell/CubbyMark.vue';
import { api, isMac } from '@/lib/api';
import { app } from '@/lib/store';
import { fail } from '@/composables/toast';

/** Version, where the data lives, which Chrome runs the brands. */
const reveal = (p?: string | null) => { if (p) api('app.revealPath', { path: p }).catch(e => fail(e)); };
const platform = (p?: string) => (p === 'win32' ? 'Windows' : p === 'darwin' ? 'macOS' : p ?? '');
</script>

<template>
  <div class="set-sec">
    <div class="hero">
      <CubbyMark :size="44" />
      <div>
        <div class="h2">Cubby <span class="muted num">{{ app.status?.version ?? '' }}</span></div>
        <p class="small muted">Every brand gets its own cubby — a sealed Chrome per brand, managed from one place. By FF Dev Studio.</p>
      </div>
    </div>
    <dl class="facts ab">
      <dt>Version</dt><dd class="num">{{ app.status?.version ?? '—' }} · {{ platform(app.status?.platform) }}</dd>
      <dt>Google Chrome</dt><dd>{{ app.status?.chrome ? app.status.chrome.version : 'Not found' }}<div v-if="app.status?.chrome" class="tiny muted code">{{ app.status.chrome.path }}</div></dd>
      <dt>Data folder</dt><dd><span class="code small">{{ app.status?.dataDir ?? '—' }}</span><div><Btn size="sm" variant="subtle" icon="folder" class="mt-2" @click="reveal(app.status?.dataDir)">Show in {{ isMac ? 'Finder' : 'Explorer' }}</Btn></div></dd>
      <dt>Local API</dt><dd class="code small">{{ app.status?.apiUrl ?? '—' }}</dd>
      <dt>MCP</dt><dd class="code small">{{ app.status?.mcpUrl ?? '—' }}</dd>
      <dt>Open brands</dt><dd class="num">{{ app.status?.openBrands ?? 0 }}</dd>
    </dl>
  </div>
</template>

<style scoped>
.hero { display: flex; align-items: center; gap: 18px; padding: 4px 0 24px; border-bottom: 1px solid var(--line); margin-bottom: 8px; }
.ab { max-width: none; }
.ab dd { overflow-wrap: anywhere; }
</style>
