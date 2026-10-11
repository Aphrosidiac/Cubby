<script setup lang="ts">
import { computed } from 'vue';
import Icon from '@/components/ui/Icon.vue';

/** Brand colour: a short palette that reads on Bone and Ink, plus any custom hex. Tints the brand's Chrome window. */
const props = withDefaults(defineProps<{ modelValue: string; palette?: string[] }>(), {
  palette: () => ['#0b0b0a', '#2c4f9c', '#1d6b45', '#a3261d', '#8a5a00', '#6b3fa0', '#0f766e', '#be185d', '#475569', '#b45309', '#d9ff43', '#8b8981']
});
const emit = defineEmits<{ 'update:modelValue': [v: string] }>();
const valid = computed(() => /^#[0-9a-f]{6}$/i.test(props.modelValue));
/** Accept "#1d6b45", "1d6b45" or the short "#1d6"; anything else snaps back to the current colour. */
function hex(e: Event) {
  const el = e.target as HTMLInputElement;
  let s = el.value.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) s = s.split('').map(c => c + c).join('');
  if (/^[0-9a-f]{6}$/.test(s)) emit('update:modelValue', `#${s}`);
  else el.value = props.modelValue;
}
</script>

<template>
  <div class="cp">
    <div class="sw" role="radiogroup" aria-label="Brand colour">
      <button v-for="c in palette" :key="c" type="button" role="radio" :aria-checked="modelValue.toLowerCase() === c" :aria-label="c" class="s" :style="{ background: c }" @click="emit('update:modelValue', c)">
        <Icon v-if="modelValue.toLowerCase() === c" name="check" :size="13" :stroke="2.2" />
      </button>
    </div>
    <label class="custom">
      <input type="color" :value="valid ? modelValue : '#000000'" aria-label="Custom colour" @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)" />
      <input class="input hex code" :value="modelValue" maxlength="7" spellcheck="false" aria-label="Hex colour" title="Any colour as #rrggbb" @change="hex" @keydown.enter.prevent="hex" />
    </label>
  </div>
</template>

<style scoped>
.cp { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.sw { display: flex; flex-wrap: wrap; gap: 6px; }
.s { width: 26px; height: 26px; border-radius: 7px; display: grid; place-items: center; color: #fff; box-shadow: inset 0 0 0 1px rgb(0 0 0 / .14); transition: transform 240ms var(--ease-out); mix-blend-mode: normal; }
.s:hover { transform: scale(1.1); }
.s[aria-checked='true'] { box-shadow: 0 0 0 2px var(--bg), 0 0 0 3.5px var(--fg); }
.s[style*='#d9ff43'] { color: var(--ink); }
.custom { display: inline-flex; align-items: center; gap: 6px; }
input[type=color] { width: 30px; height: 30px; padding: 0; border: 1px solid var(--line); border-radius: 7px; background: none; cursor: pointer; }
input[type=color]::-webkit-color-swatch-wrapper { padding: 3px; }
input[type=color]::-webkit-color-swatch { border: 0; border-radius: 4px; }
.hex { width: 96px; min-height: 32px; padding: 5px 9px; }
</style>
