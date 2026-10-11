<script setup lang="ts">
import type { BrandRow } from '@shared/types';
import Btn from '@/components/ui/Btn.vue';
import Chip from '@/components/ui/Chip.vue';
import Icon from '@/components/ui/Icon.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import LoadError from '@/components/common/LoadError.vue';
import { api } from '@/lib/api';
import { useLoad } from '@/composables/useLoad';
import { fail } from '@/composables/toast';

/** Extensions installed in this brand's own Chrome profile; installs happen in the brand's window via the Web Store. */
const props = defineProps<{ brand: BrandRow }>();
const list = useLoad(() => api('brands.extensions', { id: props.brand.id }), { topics: ['brands.changed'] });
const openIn = (url: string) => api('brands.openUrl', { id: props.brand.id, url }).catch(e => fail(e, 'Could not open that in the brand'));
</script>

<template>
  <div>
    <div class="bar">
      <p class="small muted grow">Each brand has its own extensions — installing one here never touches your own Chrome or other brands.</p>
      <Btn size="sm" variant="subtle" icon="refresh" @click="list.reload(true)">Refresh</Btn>
      <Btn size="sm" icon="settings" @click="openIn('chrome://extensions/')">Manage in Chrome</Btn>
      <Btn size="sm" variant="primary" icon="external" @click="openIn('https://chromewebstore.google.com/')">Open Chrome Web Store in this brand</Btn>
    </div>
    <LoadError v-if="list.error.value" :error="list.error.value" title="Could not read extensions" @retry="list.reload()" />
    <div v-else-if="list.loading.value" class="panel"><div v-for="i in 3" :key="i" class="ext"><div class="skel-line" style="width: 40%" /></div></div>
    <EmptyState v-else-if="!list.data.value?.length" icon="puzzle" title="No extensions" body="Open the Chrome Web Store in this brand and add what it needs — a password manager, an ad blocker, a scheduling helper." />
    <ul v-else class="panel">
      <li v-for="x in list.data.value" :key="x.id" class="ext">
        <span class="ic"><Icon name="puzzle" :size="16" /></span>
        <div class="grow"><div class="strong small">{{ x.name }}</div><div class="tiny muted code">{{ x.id }}</div></div>
        <span class="tiny muted num">v{{ x.version }}</span>
        <Chip :tone="x.enabled ? 'good' : 'muted'" size="sm">{{ x.enabled ? 'On' : 'Off' }}</Chip>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.ext { display: flex; align-items: center; gap: 12px; padding: 12px 18px; }
.ext + .ext { border-top: 1px solid var(--line-soft); }
.ic { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 8px; background: var(--panel-2); color: var(--muted); }
</style>
