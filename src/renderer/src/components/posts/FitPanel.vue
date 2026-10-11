<script setup lang="ts">
import type { FitLevel, Platform } from '@shared/types';
import Chip from '@/components/ui/Chip.vue';
import PlatformIcon from '@/components/common/PlatformIcon.vue';

/** Live platform-fit results, one row per selected account. */
defineProps<{ rows: { accountId: string; platform: Platform; handle: string; level: FitLevel; notes: string[] }[]; checking?: boolean; local?: boolean; empty?: string }>();
const TONE: Record<FitLevel, string> = { ok: 'good', warn: 'warn', bad: 'bad' };
const WORD: Record<FitLevel, string> = { ok: 'Fits', warn: 'Check', bad: "Won't fit" };
</script>

<template>
  <div class="fit">
    <div class="head"><span class="label">Platform fit</span><span v-if="checking" class="spin" aria-label="Checking" /></div>
    <p v-if="!rows.length" class="small muted">{{ empty ?? 'Choose accounts to check the post against each platform.' }}</p>
    <ul v-else>
      <li v-for="r in rows" :key="r.accountId">
        <div class="row gap-2">
          <PlatformIcon :platform="r.platform" :size="14" colored />
          <span class="grow ellipsis small strong">{{ r.handle }}</span>
          <Chip size="sm" :tone="TONE[r.level]">{{ WORD[r.level] }}</Chip>
        </div>
        <ul v-if="r.notes.length" class="notes">
          <li v-for="(n, i) in r.notes" :key="i" class="tiny">{{ n }}</li>
        </ul>
      </li>
    </ul>
    <p v-if="local && rows.length" class="tiny faint mt-2">Checked here in the app — the full check runs when the posting module is available.</p>
  </div>
</template>

<style scoped>
.head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; min-height: 16px; }
.spin { width: 12px; height: 12px; border-radius: 50%; border: 1.5px solid var(--muted); border-right-color: transparent; animation: ff-spin .7s linear infinite; }
ul > li + li { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--line-soft); }
.notes { margin: 5px 0 0 22px; list-style: disc; color: var(--muted); }
.notes li { line-height: 1.4; }
.notes li + li { margin-top: 2px; padding: 0; border: 0; }
</style>
