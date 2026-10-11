<script setup lang="ts">
// OWNER: renderer builder A. Command palette (⌘/Ctrl K): fuzzy search brands (name, handle, tag,
// serial) → Enter opens/fronts the brand window, Shift+Enter shows it in Cubby; also pages and
// actions (New brand, Compose, Stop all…). Stub until built.
defineProps<{ open: boolean }>()
defineEmits<{ 'update:open': [v: boolean] }>()
</script>

<template>
  <span v-if="false" />
</template>
