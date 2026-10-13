<script setup lang="ts">
import { computed } from 'vue';

/**
 * A file name that truncates in the middle: the start, an ellipsis, then the end of the name and its
 * extension — so "carousel-01-portrait.jpg" and "carousel-02-portrait.jpg" stay tellable apart and the
 * type is never cut. Pure CSS (no measuring); the full name is in the tooltip.
 */
const props = defineProps<{ name: string; title?: string }>();
const parts = computed(() => {
  const n = props.name;
  const dot = n.lastIndexOf('.');
  const ext = dot > 0 && n.length - dot <= 6 ? n.slice(dot) : '';
  const stem = ext ? n.slice(0, dot) : n;
  // keep the stem's last word (after - _ or space, up to 12 chars) with the extension, else its last 5
  // characters, when the name is long enough to be cut — "carousel-03-…portrait.jpg", not "…trait.jpg"
  const word = stem.match(/[-_ ]([^-_ ]{1,12})$/)?.[1];
  const keep = stem.length > 14 ? (word ? word.length : 5) : 0;
  return { head: stem.slice(0, stem.length - keep), tail: stem.slice(stem.length - keep) + ext };
});
</script>

<template>
  <span class="fname" :title="title ?? name"><span class="head">{{ parts.head }}</span><span v-if="parts.tail" class="tail">{{ parts.tail }}</span></span>
</template>

<style scoped>
.fname { display: inline-flex; min-width: 0; max-width: 100%; white-space: nowrap; vertical-align: bottom; }
.head { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.tail { flex: none; }
</style>
