<script setup lang="ts">
import type { BrandRow } from '@shared/types';
import ActivityFeed from '@/components/activity/ActivityFeed.vue';

/** Everything done in this brand, by anyone (you, Claude, the scheduler, flows, the API), with
 *  screenshots: the Activity page's own list with the brand filter preset. */
defineProps<{ brand: BrandRow }>();
</script>

<template>
  <div class="brand-activity">
    <ActivityFeed :brand-id="brand.id" export-in-bar empty-body="Opening, posting, logins and every Claude action in this brand show up here." />
  </div>
</template>

<style scoped>
/* the brand page's tab bar is sticky under the top bar too: the table header sticks under both */
.brand-activity { --table-top: calc(var(--topbar) + 49px); }
</style>
