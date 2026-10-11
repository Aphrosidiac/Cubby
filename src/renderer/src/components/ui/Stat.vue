<script setup lang="ts">
import { computed } from 'vue';
import Num from './Num.vue';
import Sparkline from './Sparkline.vue';
import Icon from './Icon.vue';

/**
 * A KPI. Every stat is a door: pass `to` and it links to the list behind the
 * number (dashboard triage over metrics).
 */
const props = withDefaults(defineProps<{ label: string; value: number | null | undefined; format?: 'money' | 'int' | 'pct'; delta?: number | null; deltaLabel?: string; spark?: number[]; to?: string; tone?: 'neutral' | 'bad' | 'good' | 'warn' | 'signal'; hint?: string; loading?: boolean }>(), { format: 'money', tone: 'neutral' });
const deltaTone = computed(() => (props.delta === null || props.delta === undefined ? '' : props.delta >= 0 ? 'up' : 'down'));
</script>

<template>
  <component :is="to ? 'RouterLink' : 'div'" :to="to" class="stat" :class="[`t-${tone}`, { 'is-link': !!to }]">
    <div class="top">
      <span class="label">{{ label }}</span>
      <Icon v-if="to" name="arrow-up-right" :size="14" class="go" />
    </div>
    <div class="val">
      <span v-if="loading" class="skel" style="display:inline-block;width:120px;height:30px" />
      <Num v-else :value="value" :format="format" :decimals="format === 'money' ? false : undefined" />
    </div>
    <div class="foot">
      <span v-if="delta !== null && delta !== undefined" class="delta" :class="deltaTone">{{ delta >= 0 ? '▲' : '▼' }} <Num :value="Math.abs(delta)" :format="format === 'pct' ? 'pct' : format" :decimals="false" /></span>
      <span v-if="deltaLabel || hint" class="hint">{{ deltaLabel ?? hint }}</span>
    </div>
    <Sparkline v-if="spark?.length" :values="spark" class="spark" />
  </component>
</template>

<style scoped>
.stat { position: relative; display: flex; flex-direction: column; gap: 10px; padding: 18px 20px 16px; border-radius: var(--r-lg); background: var(--panel); border: 1px solid var(--line); overflow: hidden; transition: border-color 240ms, transform 360ms var(--ease-out), box-shadow 360ms var(--ease-out); min-height: 128px; }
.is-link:hover { border-color: var(--fg); transform: translateY(-2px); box-shadow: var(--shadow-2); }
.top { display: flex; align-items: center; justify-content: space-between; }
.go { color: var(--muted); opacity: 0; transform: translate(-4px, 4px); transition: opacity 200ms, transform 360ms var(--ease-out); }
.is-link:hover .go { opacity: 1; transform: none; color: var(--fg); }
.val { font-size: var(--fs-3xl); font-weight: 600; letter-spacing: -.035em; line-height: 1; }
@media (max-width: 560px) { .val { font-size: var(--fs-fluid-sm); } }
.foot { display: flex; align-items: center; gap: 8px; font-size: var(--fs-xs); min-height: 16px; z-index: 1; }
.delta { font-weight: 600; font-size: var(--fs-xs); }
.delta.up { color: var(--good); } .delta.down { color: var(--bad); }
.hint { color: var(--muted); }
.spark { position: absolute; right: 12px; bottom: 12px; width: 44%; height: 38px; opacity: .9; }
.t-bad .val { color: var(--bad); }
.t-signal::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--lime); }
</style>
