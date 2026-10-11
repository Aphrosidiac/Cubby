<script setup lang="ts">
import { computed } from 'vue';
import Toggle from '@/components/ui/Toggle.vue';
import Select from '@/components/ui/Select.vue';
import Btn from '@/components/ui/Btn.vue';
import SaveBar from '@/components/common/SaveBar.vue';
import HotkeyInput from './HotkeyInput.vue';
import { useSection } from './useSection';
import { api, isMac } from '@/lib/api';
import { app } from '@/lib/store';
import { fail } from '@/composables/toast';

/** Start-up, tray, the quick-switch hotkey, time zone and the daily login check. */
const { form, dirty, busy, save, discard } = useSection(['launchAtLogin', 'closeToTray', 'quickSwitchHotkey', 'timezone', 'healthCheckHour']);
const zones = computed(() => {
  let list: string[] = [];
  try { list = (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone'); } catch { list = ['Asia/Kuala_Lumpur', 'Asia/Singapore', 'UTC']; }
  if (form.timezone && !list.includes(form.timezone)) list = [form.timezone, ...list];
  return list.map(z => ({ value: z, label: z.replace(/_/g, ' '), group: z.split('/')[0] }));
});
const hours = Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${String(h).padStart(2, '0')}:00` }));
const reveal = () => app.status && api('app.revealPath', { path: app.status.dataDir }).catch(e => fail(e));
</script>

<template>
  <div class="set-sec">
    <div class="set-row">
      <div class="set-l"><span class="t">Start with {{ isMac ? 'macOS' : 'Windows' }}</span><span class="d">Cubby starts hidden in the {{ isMac ? 'menu bar' : 'tray' }} so scheduled posts and the Local API are ready.</span></div>
      <div class="set-c"><Toggle v-model="form.launchAtLogin" label="Launch Cubby when I log in" /></div>
    </div>
    <div class="set-row">
      <div class="set-l"><span class="t">Closing the window</span><span class="d">The scheduler, Local API and MCP keep running in the {{ isMac ? 'menu bar' : 'tray' }}; the window is rebuilt when you open it.</span></div>
      <div class="set-c"><Toggle v-model="form.closeToTray" :label="`Keep running in the ${isMac ? 'menu bar' : 'tray'} when I close the window`" /></div>
    </div>
    <div class="set-row">
      <div class="set-l"><span class="t">Quick switcher</span><span class="d">A global shortcut: type a brand’s name, press Enter, its Chrome opens or comes to the front.</span></div>
      <div class="set-c"><HotkeyInput v-model="form.quickSwitchHotkey" /><span class="set-note">If another app already uses the shortcut, it won’t register — pick another.</span></div>
    </div>
    <div class="set-row">
      <div class="set-l"><span class="t">Time zone</span><span class="d">Used for schedules, posting slots and quiet hours.</span></div>
      <div class="set-c"><Select v-model="form.timezone" :options="zones" searchable aria-label="Time zone" /></div>
    </div>
    <div class="set-row">
      <div class="set-l"><span class="t">Daily login check</span><span class="d">Closed brands get their login health read once a day at this hour (open ones are checked live).</span></div>
      <div class="set-c"><Select v-model="form.healthCheckHour" :options="hours" aria-label="Hour" :min-width="140" style="max-width: 160px" /></div>
    </div>
    <div class="set-row">
      <div class="set-l"><span class="t">Data folder</span><span class="d">Database, brand profiles, screenshots and exports.</span></div>
      <div class="set-c"><code class="code path">{{ app.status?.dataDir ?? '…' }}</code><Btn size="sm" icon="folder" @click="reveal">Show in {{ isMac ? 'Finder' : 'Explorer' }}</Btn></div>
    </div>
    <SaveBar :show="dirty" :busy="busy" @save="save()" @discard="discard" />
  </div>
</template>

<style scoped>
.path { padding: 8px 10px; border-radius: 6px; background: var(--panel-2); overflow-wrap: anywhere; }
</style>
