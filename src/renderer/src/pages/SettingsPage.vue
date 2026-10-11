<script setup lang="ts">
// Settings (PLAN 6.11): tabs (?tab=) — General · Chrome · Posting · Notifications · Security ·
// Backups · Local API · Appearance · About. Each section saves through its own save bar.
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PageHeader from '@/components/ui/PageHeader.vue';
import Tabs from '@/components/ui/Tabs.vue';
import LoadError from '@/components/common/LoadError.vue';
import GeneralSection from '@/components/settings/GeneralSection.vue';
import ChromeSection from '@/components/settings/ChromeSection.vue';
import PostingSection from '@/components/settings/PostingSection.vue';
import NotificationsSection from '@/components/settings/NotificationsSection.vue';
import SecuritySection from '@/components/settings/SecuritySection.vue';
import BackupsSection from '@/components/settings/BackupsSection.vue';
import ApiSection from '@/components/settings/ApiSection.vue';
import AppearanceSection from '@/components/settings/AppearanceSection.vue';
import AboutSection from '@/components/settings/AboutSection.vue';
import '@/components/settings/settings.css';
import { app, startStore } from '@/lib/store';

const route = useRoute();
const router = useRouter();
const TABS = [
  { value: 'general', label: 'General' },
  { value: 'chrome', label: 'Chrome' },
  { value: 'posting', label: 'Posting' },
  { value: 'notifications', label: 'Notifications' },
  { value: 'security', label: 'Security' },
  { value: 'backups', label: 'Backups' },
  { value: 'api', label: 'Local API' },
  { value: 'appearance', label: 'Appearance' },
  { value: 'about', label: 'About' }
];
const tab = computed({
  get: () => (TABS.some(t => t.value === route.query.tab) ? String(route.query.tab) : 'general'),
  set: v => void router.replace({ query: { ...route.query, tab: v === 'general' ? undefined : v } })
});
const SECTIONS = { general: GeneralSection, chrome: ChromeSection, posting: PostingSection, notifications: NotificationsSection, security: SecuritySection, backups: BackupsSection, api: ApiSection, appearance: AppearanceSection, about: AboutSection } as const;
const current = computed(() => SECTIONS[tab.value as keyof typeof SECTIONS]);
</script>

<template>
  <div class="page">
    <PageHeader eyebrow="Cubby" title="Settings"><span>How Cubby runs on this computer.</span></PageHeader>
    <Tabs v-model="tab" :tabs="TABS" class="tabs" />
    <LoadError v-if="!app.settings" error="Settings did not load." title="Could not load settings" @retry="startStore()" />
    <Transition v-else name="fade" mode="out-in">
      <component :is="current" :key="tab" />
    </Transition>
  </div>
</template>

<style scoped>
.tabs { margin: -8px 0 26px; position: sticky; top: var(--topbar); z-index: 20; background: var(--bg); }
/* all nine tabs stay in view at the smallest window */
@media (max-width: 1100px) { .page .tabs { gap: 14px; } }
</style>
