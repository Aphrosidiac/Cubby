<script setup lang="ts">
defineProps<{ label?: string; hint?: string; error?: string | null; required?: boolean; for?: string; inline?: boolean }>();
</script>

<template>
  <div class="field" :class="{ inline, invalid: !!error }">
    <label v-if="label" class="flabel" :for="$props.for">{{ label }}<span v-if="required" class="req" aria-hidden="true">*</span></label>
    <div class="control"><slot /></div>
    <Transition name="slide-down">
      <div v-if="error" class="err"><div>{{ error }}</div></div>
      <div v-else-if="hint" class="hint"><div>{{ hint }}</div></div>
    </Transition>
  </div>
</template>

<style scoped>
.field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.field.inline { flex-direction: row; align-items: center; justify-content: space-between; gap: var(--s4); }
.flabel { font-size: var(--fs-sm); font-weight: 500; color: var(--fg-2); letter-spacing: .002em; }
.req { color: var(--muted); margin-left: 3px; }
.hint { font-size: var(--fs-xs); color: var(--muted); line-height: 1.45; }
.err { font-size: var(--fs-xs); color: var(--bad); line-height: 1.45; }
.invalid :deep(.input), .invalid :deep(.select), .invalid :deep(.textarea) { border-color: var(--bad); }
</style>
