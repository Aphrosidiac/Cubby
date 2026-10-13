<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import Icon from './Icon.vue';

/**
 * Buttons are pills (as on ffdev.studio). primary = Ink (the main action), ghost = hairline,
 * subtle = text-weight, danger = red hairline. Lime is never a button surface: `signal` is kept
 * only so old call sites compile and renders exactly as primary.
 * Hover sweeps a fill in on the slash angle; press settles. Disabled = the same variant, faded
 * (opacity only — no grey fill), with no hover, sweep or press.
 */
const props = withDefaults(defineProps<{
  variant?: 'primary' | 'signal' | 'ghost' | 'subtle' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: string; iconRight?: string; loading?: boolean; disabled?: boolean;
  to?: string | Record<string, unknown>; href?: string; target?: string; download?: boolean | string; block?: boolean; type?: 'button' | 'submit'; square?: boolean; title?: string;
}>(), { variant: 'ghost', size: 'md', type: 'button' });

const tag = computed(() => (props.to ? RouterLink : props.href ? 'a' : 'button'));
// a disabled link can't take the disabled attribute: it leaves the tab order and ignores the pointer
const off = computed(() => (props.to || props.href) && props.disabled ? { 'aria-disabled': 'true', tabindex: -1 } : {});
const attrs = computed(() => ({ ...(props.to ? { to: props.to } : props.href ? { href: props.href, target: props.target, rel: props.target === '_blank' ? 'noopener' : undefined, download: props.download === true ? '' : props.download || undefined } : { type: props.type, disabled: props.disabled || props.loading }), ...off.value }));
</script>

<template>
  <component :is="tag" v-bind="attrs" class="btn" :class="[`v-${variant}`, `s-${size}`, { block, square, loading, disabled }]" :title="title" :aria-busy="loading || undefined">
    <span class="sweep" aria-hidden="true" />
    <span class="inner">
      <Transition name="swap" mode="out-in">
        <span v-if="loading" key="l" class="spin" aria-hidden="true" />
        <Icon v-else-if="icon" key="i" :name="icon" :size="size === 'sm' ? 15 : 17" />
      </Transition>
      <span v-if="$slots.default" class="btn-text"><slot /></span>
      <Icon v-if="iconRight" :name="iconRight" :size="size === 'sm' ? 14 : 16" class="ir" />
    </span>
  </component>
</template>

<style scoped>
.btn {
  position: relative; display: inline-flex; align-items: center; justify-content: center; overflow: hidden; isolation: isolate;
  flex-shrink: 0; border-radius: var(--r-pill); font-weight: 500; letter-spacing: -.005em; white-space: nowrap; user-select: none;
  border: 1px solid transparent; cursor: pointer; text-decoration: none;
  transition: transform 160ms var(--ease-out), background-color 240ms var(--ease-out), border-color 240ms var(--ease-out), color 240ms var(--ease-out), opacity 200ms;
}
.btn:active:not(.disabled):not(:disabled) { transform: scale(.965); }
.inner { position: relative; z-index: 1; display: inline-flex; align-items: center; gap: 8px; }
.s-sm { height: 32px; padding: 0 13px; font-size: var(--fs-sm); }
.s-md { height: 40px; padding: 0 17px; font-size: var(--fs-base); }
.s-lg { height: 50px; padding: 0 24px; font-size: var(--fs-md); }
.square.s-sm { width: 32px; padding: 0; } .square.s-md { width: 40px; padding: 0; } .square.s-lg { width: 50px; padding: 0; }
.block { display: flex; width: 100%; flex-shrink: 1; }
/* a full-width button may take two lines on a phone rather than clip its label */
@media (max-width: 560px) { .block { white-space: normal; text-align: center; line-height: 1.25; height: auto; padding-top: 10px; padding-bottom: 10px; } .block.s-sm { min-height: 36px; } .block.s-md { min-height: 42px; } .block.s-lg { min-height: 50px; padding-left: 18px; padding-right: 18px; } }
/* fingers: a little more height to hit */
@media (pointer: coarse) { .s-sm { height: 36px; } .s-md { height: 42px; } .square.s-sm { width: 36px; } .square.s-md { width: 42px; } }
.sweep { position: absolute; inset: -2px -30%; z-index: 0; transform: translateX(-102%) skewX(calc(var(--slash) * -1)); transition: transform 460ms var(--ease-out); pointer-events: none; }
.btn:hover:not(.disabled):not(:disabled) .sweep { transform: translateX(0) skewX(calc(var(--slash) * -1)); }

.v-primary, .v-signal { background: var(--fg); color: var(--bg); }
.v-primary .sweep, .v-signal .sweep { background: color-mix(in srgb, var(--bg) 16%, var(--fg)); }
.v-ghost { background: transparent; color: var(--fg); border-color: var(--line-strong); }
.v-ghost .sweep { background: var(--panel-2); }
.v-ghost:hover:not(.disabled):not(:disabled) { border-color: var(--fg); }
.v-subtle { background: transparent; color: var(--fg-2); }
.v-subtle .sweep { background: var(--panel-2); }
.v-subtle:hover:not(.disabled):not(:disabled) { color: var(--fg); }
.v-danger { background: transparent; color: var(--bad); border-color: color-mix(in srgb, var(--bad) 40%, transparent); }
.v-danger .sweep { background: var(--bad); }
/* text over the red sweep: the page colour reads in both themes (white on the dark theme's
   salmon red was 2:1); a disabled/loading button gets no sweep, so it keeps its red text */
.v-danger:hover:not(.disabled):not(:disabled) { color: var(--bg); border-color: var(--bad); }
/* one disabled look for every variant and theme: the real button at 40% — its own fill, border
   and text colour, never a grey slab — and nothing reacts to the pointer */
.disabled, .btn:disabled { opacity: .4; cursor: not-allowed; }
a.btn.disabled { pointer-events: none; }
/* busy is not disabled: the spinner stays at full strength */
.btn.loading:not(.disabled) { opacity: 1; cursor: progress; }
.spin { width: 15px; height: 15px; border-radius: 50%; border: 1.6px solid currentColor; border-right-color: transparent; animation: ff-spin .7s linear infinite; }
.ir { transition: transform 300ms var(--ease-out); }
.btn:hover:not(.disabled):not(:disabled) .ir { transform: translateX(3px); }
</style>
