<script setup lang="ts">
/** Cubby mark: a 2×2 cubby grid with one compartment lit in Signal Lime. */
withDefaults(defineProps<{ size?: number }>(), { size: 24 })
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="2.75" y="2.75" width="18.5" height="18.5" rx="2.5" stroke="currentColor" stroke-width="1.5" />
    <path d="M12 2.75v18.5M2.75 12h18.5" stroke="currentColor" stroke-width="1.5" />
    <rect x="13.6" y="4.35" width="6.05" height="6.05" rx="1" fill="var(--lime)" />
  </svg>
</template>
