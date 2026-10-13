<script setup lang="ts">
/** On/off switch. A toggle without a visible label must get `aria-label` (it lands on the switch). */
defineProps<{ modelValue: boolean; label?: string; disabled?: boolean; hint?: string; ariaLabel?: string }>();
defineEmits<{ 'update:modelValue': [v: boolean] }>();
</script>

<template>
  <label class="toggle" :class="{ on: modelValue, disabled }">
    <button type="button" role="switch" :aria-checked="modelValue" :aria-label="ariaLabel ?? label" :title="!label ? ariaLabel : undefined" :disabled="disabled" class="track" @click="$emit('update:modelValue', !modelValue)"><span class="knob" /></button>
    <span v-if="label || hint" class="txt"><span v-if="label" class="lbl">{{ label }}</span><span v-if="hint" class="hint">{{ hint }}</span></span>
  </label>
</template>

<style scoped>
/* the off track reads as a control (3:1 edge) in both themes */
.toggle { --track-line: color-mix(in srgb, var(--fg) 42%, var(--bg)); display: inline-flex; align-items: flex-start; gap: 12px; cursor: pointer; }
.track { position: relative; flex: none; width: 38px; height: 22px; border-radius: 99px; background: var(--panel-2); box-shadow: inset 0 0 0 1px var(--track-line); transition: background-color 300ms var(--ease-out), box-shadow 300ms var(--ease-out); margin-top: 1px; }
.knob { position: absolute; top: 4px; left: 4px; width: 14px; height: 14px; border-radius: 50%; background: var(--muted); transition: transform 460ms var(--ease-toggle), background-color 300ms; }
/* On: lime track, ink knob — reads at a glance in both themes. */
.on .track { background: var(--lime); box-shadow: inset 0 0 0 1px rgba(11, 11, 10, .18); }
.on .knob { transform: translateX(16px); background: var(--ink); }
.toggle:not(.disabled):hover .track { box-shadow: inset 0 0 0 1px var(--fg); }
.on.toggle:not(.disabled):hover .track { box-shadow: inset 0 0 0 1px rgba(11, 11, 10, .35); }
/* the keyboard ring sits outside the track and keeps the track's own hairline */
.track:focus-visible { outline: 2px solid var(--fg); outline-offset: 2px; border-radius: 99px; box-shadow: inset 0 0 0 1px var(--track-line); }
.on .track:focus-visible { box-shadow: inset 0 0 0 1px rgba(11, 11, 10, .18); }
.txt { display: flex; flex-direction: column; gap: 2px; }
.lbl { font-size: var(--fs-base); font-weight: 500; }
.hint { font-size: var(--fs-xs); color: var(--muted); text-wrap: pretty; }
.disabled { opacity: .5; cursor: not-allowed; }
.disabled .track { cursor: not-allowed; }
</style>
