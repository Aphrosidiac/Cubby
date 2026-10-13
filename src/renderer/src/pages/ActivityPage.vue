<script setup lang="ts">
// Activity (PLAN 6.9): everything done by you / Claude / scheduler / flows / API. The list, filters,
// paging and export live in ActivityFeed (a brand's Activity tab uses the same one).
import { ref } from 'vue';
import PageHeader from '@/components/ui/PageHeader.vue';
import Btn from '@/components/ui/Btn.vue';
import ActivityFeed from '@/components/activity/ActivityFeed.vue';

const feed = ref<InstanceType<typeof ActivityFeed> | null>(null);
</script>

<template>
  <div class="page activity">
    <PageHeader eyebrow="Control" title="Activity" description="Everything done by you, Claude, the scheduler, flows and the API — append‑only.">
      <template #actions>
        <Btn icon="download" :loading="feed?.exporting" :disabled="feed ? !feed.canExport : true" :title="feed && !feed.canExport ? 'Nothing to export' : 'Export what the filters show as a CSV file'" @click="feed?.exportCsv()">Export CSV</Btn>
      </template>
    </PageHeader>
    <ActivityFeed ref="feed" />
  </div>
</template>
