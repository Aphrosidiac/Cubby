<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

/**
 * Project stages as a rail. The rail fills to the current stage; the current
 * stage carries the Signal Lime marker. Clickable when `interactive`.
 */
const props = defineProps<{ stages: { key: string; label: string }[]; current: string; interactive?: boolean; compact?: boolean }>();
defineEmits<{ pick: [key: string] }>();
const idx = computed(() => Math.max(0, props.stages.findIndex(s => s.key === props.current)));
const mounted = ref(false);
onMounted(() => requestAnimationFrame(() => requestAnimationFrame(() => { mounted.value = true; })));
const fill = computed(() => (!mounted.value ? 0 : props.stages.length > 1 ? idx.value / (props.stages.length - 1) : 1));
</script>

<template>
  <div class="stepper" :class="{ compact }">
    <div class="st-rail" :style="{ left: `${50 / stages.length}%`, right: `${50 / stages.length}%` }"><span class="st-fill" :style="{ transform: `scaleX(${fill})` }" /></div>
    <ol>
      <li v-for="(s, i) in stages" :key="s.key" :class="{ done: i < idx, cur: i === idx }" :style="{ '--i': i }">
        <button type="button" :disabled="!interactive" :title="s.label" @click="$emit('pick', s.key)">
          <span class="node" />
          <span class="lbl">{{ s.label }}</span>
        </button>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.stepper { position: relative; padding-top: 4px; }
.st-rail { position: absolute; top: 11px; height: 2px; background: var(--line); }
.st-fill { position: absolute; inset: 0; background: var(--fg); transform-origin: left; transition: transform 1s var(--ease-out); }
ol { position: relative; display: flex; justify-content: space-between; }
li { flex: 1 1 0; min-width: 0; display: flex; justify-content: center; animation: ff-rise .6s var(--ease-out) backwards; animation-delay: calc(var(--i) * 40ms); }
button { display: flex; flex-direction: column; align-items: center; gap: 10px; min-width: 0; cursor: default; }
button:not(:disabled) { cursor: pointer; }
.node { width: 14px; height: 14px; margin-top: 1px; border-radius: 50%; background: var(--bg); border: 2px solid var(--line-strong); transition: background-color 400ms, border-color 400ms, transform 400ms var(--ease-out); }
.done .node { background: var(--fg); border-color: var(--fg); }
.cur .node { background: var(--lime); border-color: var(--ink); transform: scale(1.35); box-shadow: 0 0 0 5px color-mix(in srgb, var(--lime) 30%, transparent); }
button:not(:disabled):hover .node { transform: scale(1.3); border-color: var(--fg); }
.lbl { font-size: var(--fs-xs); color: var(--muted); text-align: center; line-height: 1.25; padding: 0 2px; }
.done .lbl { color: var(--fg-2); } .cur .lbl { color: var(--fg); font-weight: 600; }
.compact .lbl { display: none; }
/* Narrow: only the current stage is named, under its node — the rail reserves the
   room so it never sits on the text below, and the end labels hug the edges. */
@media (max-width: 820px) {
  .stepper:not(.compact) { padding-bottom: 24px; }
  .lbl { display: none; }
  li { position: relative; }
  .stepper:not(.compact) .cur .lbl { display: block; position: absolute; top: 30px; white-space: nowrap; }
  .stepper:not(.compact) li:first-child.cur .lbl { left: 0; }
  .stepper:not(.compact) li:last-child.cur .lbl { right: 0; }
}
</style>
