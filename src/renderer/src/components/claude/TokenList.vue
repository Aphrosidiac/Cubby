<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ApiToken } from '@shared/types';
import Btn from '@/components/ui/Btn.vue';
import Chip from '@/components/ui/Chip.vue';
import Icon from '@/components/ui/Icon.vue';
import { brandName, useBrands } from '@/components/posts/meta';
import { ago, date, meta, plural } from '@/lib/format';

/**
 * The one token list (Claude page and Settings › Local API): active tokens with their scopes as
 * chips, the brands they may touch, "Created 11 Oct 2026 · Used 2 hours ago" and Revoke; revoked
 * tokens fold under "Show 1 revoked token" so "why did my script stop?" still has an answer.
 */
const props = defineProps<{ tokens: ApiToken[]; revoking?: string | null; framed?: boolean }>();
const emit = defineEmits<{ revoke: [t: ApiToken] }>();
const active = computed(() => props.tokens.filter(t => !t.revokedAt));
const revoked = computed(() => props.tokens.filter(t => t.revokedAt).sort((a, b) => String(b.revokedAt).localeCompare(String(a.revokedAt))));
const showRevoked = ref(false);
useBrands(); // brand names for the "may touch" line
const brandsText = (t: ApiToken) => (t.brandIds?.length ? t.brandIds.map(brandName).join(', ') : 'All brands');
</script>

<template>
  <div class="token-list" :class="{ framed }">
    <slot v-if="!active.length" name="empty" />
    <ul v-else class="tl">
      <li v-for="t in active" :key="t.id">
        <div class="info">
          <div class="tname"><span class="small strong ellipsis" :title="t.name">{{ t.name }}</span><span class="code muted nowrap">{{ t.prefix }}…</span></div>
          <div class="sc">
            <Chip v-for="s in t.scopes" :key="s" size="sm" :tone="s === 'cdp' ? 'warn' : 'neutral'" :dot="false">{{ s }}</Chip>
            <span class="tiny muted ellipsis" :title="brandsText(t)">{{ brandsText(t) }}</span>
          </div>
          <div class="tiny muted">{{ meta(`Created ${date(t.createdAt)}`, t.lastUsedAt ? `Used ${ago(t.lastUsedAt)}` : 'Never used') }}</div>
        </div>
        <Btn size="sm" variant="danger" :loading="revoking === t.id" @click="emit('revoke', t)">Revoke</Btn>
      </li>
    </ul>
    <div v-if="revoked.length" class="revoked">
      <button type="button" class="rv-t tiny muted" :aria-expanded="showRevoked" @click="showRevoked = !showRevoked">
        <Icon name="chevron-down" :size="12" class="chev" :class="{ rot: showRevoked }" />{{ showRevoked ? 'Hide' : 'Show' }} {{ plural(revoked.length, 'revoked token') }}
      </button>
      <Transition name="slide-down">
        <div v-if="showRevoked" class="rv-wrap">
          <ul class="tl rv">
            <li v-for="t in revoked" :key="t.id">
              <div class="info">
                <div class="tname"><span class="small ellipsis" :title="t.name">{{ t.name }}</span><span class="code muted nowrap">{{ t.prefix }}…</span></div>
                <div class="tiny muted">{{ meta(`Created ${date(t.createdAt)}`, `Revoked ${date(t.revokedAt)}`) }}</div>
              </div>
              <Chip size="sm" tone="muted" :dot="false">Revoked</Chip>
            </li>
          </ul>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.token-list { min-width: 0; }
.tl { display: flex; flex-direction: column; min-width: 0; }
.tl li { display: flex; align-items: center; gap: 12px; padding: 12px 0; min-width: 0; }
.tl li + li { border-top: 1px solid var(--line-soft); }
.tl:not(.rv) li:first-child { padding-top: 0; }
.framed .tl { border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--panel); }
.framed .tl li { padding: 12px 12px 12px 16px; }
.info { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.tname { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.sc { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; min-width: 0; }
.sc > .tiny { margin-left: 3px; max-width: 100%; }
.revoked { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--line-soft); }
.framed .revoked { border-top: 0; padding-top: 0; }
.rv-t { display: inline-flex; align-items: center; gap: 6px; padding: 2px 4px; margin-left: -4px; border-radius: var(--r); transition: color var(--t-micro); }
.rv-t:hover { color: var(--fg); }
.rv-t .chev { transition: transform 240ms var(--ease-out); }
.rot { transform: rotate(180deg); }
.rv-wrap { min-width: 0; }
.rv { margin-top: 8px; }
.rv li { padding: 10px 0; }
.token-list:not(.framed) .rv li:first-child { border-top: 1px solid var(--line-soft); }
.framed .rv { opacity: .8; }
</style>
