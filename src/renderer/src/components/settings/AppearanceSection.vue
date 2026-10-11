<script setup lang="ts">
import type { Settings } from '@shared/types';
import Icon from '@/components/ui/Icon.vue';
import { app, setTheme } from '@/lib/store';
import { fail } from '@/composables/toast';

/** Light (Bone), dark (Ink) or follow the system. Applies at once. */
const OPTS: { value: Settings['theme']; label: string; icon: string; note: string }[] = [
  { value: 'light', label: 'Light', icon: 'sun', note: 'Bone' },
  { value: 'dark', label: 'Dark', icon: 'moon', note: 'Ink' },
  { value: 'system', label: 'Match system', icon: 'monitor', note: 'Follows your OS' }
];
const pick = (t: Settings['theme']) => setTheme(t).catch(e => fail(e));
</script>

<template>
  <div class="set-sec">
    <div class="set-row">
      <div class="set-l"><span class="t">Theme</span><span class="d">The Cubby window and the quick switcher. Brand Chrome windows keep their own colours.</span></div>
      <div class="set-c">
        <div class="themes" role="radiogroup" aria-label="Theme">
          <button v-for="o in OPTS" :key="o.value" type="button" role="radio" :aria-checked="app.settings?.theme === o.value" class="th" @click="pick(o.value)">
            <span class="pv" :class="`pv-${o.value}`"><span class="bar" /><span class="side" /><span class="l1" /><span class="l2" /></span>
            <span class="row gap-2 lbl"><Icon :name="o.icon" :size="15" /><span class="strong small">{{ o.label }}</span><span class="tiny muted">{{ o.note }}</span></span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.themes { display: flex; gap: 14px; flex-wrap: wrap; }
.th { display: flex; flex-direction: column; gap: 10px; padding: 8px; border-radius: 12px; border: 1px solid var(--line); background: var(--panel); transition: border-color 200ms, box-shadow 200ms; }
.th:hover { border-color: var(--line-strong); }
.th[aria-checked='true'] { border-color: var(--fg); box-shadow: 0 0 0 1px var(--fg); }
.lbl { padding: 0 4px 2px; }
.pv { position: relative; display: block; width: 168px; height: 104px; border-radius: 7px; overflow: hidden; box-shadow: inset 0 0 0 1px rgb(0 0 0 / .1); }
.pv-light { background: #f3efe4; }
.pv-dark { background: #0b0b0a; }
.pv-system { background: linear-gradient(105deg, #f3efe4 50%, #0b0b0a 50%); }
.side { position: absolute; left: 0; top: 0; bottom: 0; width: 34px; background: #0b0b0a; border-right: 1px solid #222; }
.pv-dark .side { background: #000; }
.bar { position: absolute; left: 42px; right: 10px; top: 12px; height: 8px; border-radius: 4px; background: #d7d2c6; }
.pv-dark .bar { background: #2a2a27; }
.l1, .l2 { position: absolute; left: 42px; height: 6px; border-radius: 3px; background: #b9b3a4; }
.l1 { top: 34px; width: 90px; } .l2 { top: 48px; width: 60px; background: #d9ff43; }
.pv-dark .l1 { background: #3d3c37; }
</style>
