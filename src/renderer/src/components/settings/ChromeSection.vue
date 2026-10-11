<script setup lang="ts">
import { computed, ref } from 'vue';
import Btn from '@/components/ui/Btn.vue';
import Segmented from '@/components/ui/Segmented.vue';
import SaveBar from '@/components/common/SaveBar.vue';
import { useSection } from './useSection';
import { api } from '@/lib/api';
import { app, refreshStatus } from '@/lib/store';
import { fail } from '@/composables/toast';

/** Which Google Chrome runs the brands, and the window size new brands start with. */
const { form, dirty, busy, save, discard } = useSection(['chromePath', 'defaultWindow']);
const PRESETS = [{ value: '1280x900', label: '1280 × 900' }, { value: '1440x900', label: '1440 × 900' }, { value: '1920x1080', label: '1920 × 1080' }, { value: 'custom', label: 'Custom' }];
const custom = ref(false);
const preset = computed({
  get: () => (!custom.value && PRESETS.some(p => p.value === `${form.defaultWindow.width}x${form.defaultWindow.height}`) ? `${form.defaultWindow.width}x${form.defaultWindow.height}` : 'custom'),
  set: v => { if (v === 'custom') custom.value = true; else { custom.value = false; const [w, h] = v.split('x').map(Number); form.defaultWindow = { ...form.defaultWindow, width: w, height: h }; } }
});
async function pick() {
  try { const [p] = await api('app.pickFiles', { filters: app.status?.platform === 'win32' ? [{ name: 'Chrome', extensions: ['exe'] }] : undefined }); if (p) form.chromePath = p; } catch (e) { fail(e); }
}
async function doSave() { if (await save('Chrome settings saved')) void refreshStatus().catch(() => {}); }
</script>

<template>
  <div class="set-sec">
    <div class="set-row">
      <div class="set-l"><span class="t">Detected Chrome</span><span class="d">Brands open in your installed Google Chrome — real Chrome, with its video codecs and updates.</span></div>
      <div class="set-c">
        <span class="set-status" :class="app.status?.chrome ? 'ok' : 'bad'"><span class="d" />{{ app.status?.chrome ? `Google Chrome ${app.status.chrome.version}` : 'Chrome was not found' }}</span>
        <code v-if="app.status?.chrome" class="code path">{{ app.status.chrome.path }}</code>
        <span v-else class="set-note">Install Google Chrome, or point Cubby at chrome.exe below.</span>
      </div>
    </div>
    <div class="set-row">
      <div class="set-l"><span class="t">Use a different Chrome</span><span class="d">Chrome Beta, Dev or a portable Chrome. A brand can also override this in its own settings.</span></div>
      <div class="set-c">
        <div class="set-pair"><input :value="form.chromePath ?? ''" class="input code wide" readonly placeholder="Detected Chrome" @click="pick" /><Btn size="sm" icon="chrome" @click="pick">Choose…</Btn><Btn v-if="form.chromePath" size="sm" variant="subtle" @click="form.chromePath = null">Use detected</Btn></div>
      </div>
    </div>
    <div class="set-row">
      <div class="set-l"><span class="t">Default window size</span><span class="d">What new brands start with. Existing brands keep theirs.</span></div>
      <div class="set-c">
        <Segmented v-model="preset" size="sm" :options="PRESETS" />
        <div v-if="preset === 'custom'" class="set-pair">
          <input v-model.number="form.defaultWindow.width" type="number" min="400" class="input num" aria-label="Width" /><span class="muted">×</span><input v-model.number="form.defaultWindow.height" type="number" min="300" class="input num" aria-label="Height" />
        </div>
      </div>
    </div>
    <SaveBar :show="dirty" :busy="busy" :disabled="form.defaultWindow.width < 400 || form.defaultWindow.height < 300" @save="doSave" @discard="discard" />
  </div>
</template>

<style scoped>
.path { padding: 8px 10px; border-radius: 6px; background: var(--panel-2); overflow-wrap: anywhere; max-width: 560px; }
.wide { width: 380px; max-width: 100%; cursor: pointer; }
</style>
