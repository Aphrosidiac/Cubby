<script setup lang="ts">
import { computed, ref } from 'vue';
import { PLATFORMS } from '@shared/types';
import { PLATFORM_SPECS } from '@shared/platforms';
import Field from '@/components/ui/Field.vue';
import Select from '@/components/ui/Select.vue';
import Segmented from '@/components/ui/Segmented.vue';
import Toggle from '@/components/ui/Toggle.vue';
import Icon from '@/components/ui/Icon.vue';
import PlatformIcon from '@/components/common/PlatformIcon.vue';
import { TIER_HELP } from '@/components/common/login';
import { cleanHandle, type AccountDraft } from './draft';
import { totpProblem } from './totp';

/**
 * The fields of one platform account: platform, handle, age tier (with what it means for pacing)
 * and an optional saved login. `existing` = editing a saved account: the platform is fixed and
 * stored secrets show as "saved" (leave blank to keep, or clear them).
 */
const props = defineProps<{ draft: AccountDraft; existing?: { hasUsername: boolean; hasPassword: boolean; hasTotp: boolean } | null; compact?: boolean; showMore?: boolean; handleError?: string | null }>();
const emit = defineEmits<{ clear: [field: 'username' | 'password' | 'totpSecret'] }>();
const d = computed(() => props.draft);
const platformOpts = PLATFORMS.map(p => ({ value: p, label: PLATFORM_SPECS[p].name }));
const tierOpts = [{ value: 'new', label: 'New' }, { value: 'warm', label: 'Warm' }, { value: 'established', label: 'Established' }];
const showPw = ref(false);
const preview = computed(() => {
  const h = cleanHandle(d.value.platform, d.value.handle);
  return h && d.value.platform !== 'custom' ? PLATFORM_SPECS[d.value.platform].profileUrl(h) : '';
});
const isCustom = computed(() => d.value.platform === 'custom');
const id = (f: string) => `${props.draft.key}-${f}`;
</script>

<template>
  <div class="af" :class="{ compact }">
    <div class="top">
      <Field label="Platform" class="f-plat">
        <div class="plat">
          <span class="pi-wrap"><PlatformIcon :platform="d.platform" :size="16" colored /></span>
          <Select v-model="d.platform" :options="platformOpts" :disabled="!!existing" aria-label="Platform" />
        </div>
      </Field>
      <Field :label="isCustom ? 'Site address' : 'Handle'" :for="id('handle')" :error="handleError" :hint="preview || (isCustom ? 'The site you log in to, e.g. https://business.example.com' : undefined)" class="f-handle">
        <div class="handle">
          <span v-if="!isCustom" class="at" aria-hidden="true">@</span>
          <input :id="id('handle')" v-model="d.handle" class="input" :class="{ pre: !isCustom }" :placeholder="isCustom ? 'https://…' : 'yourbrand'" spellcheck="false" autocomplete="off" @blur="d.handle = cleanHandle(d.platform, d.handle)" />
        </div>
      </Field>
    </div>

    <Field label="Account age">
      <div class="tier">
        <Segmented v-model="d.ageTier" size="sm" :options="tierOpts" />
        <p class="tiny muted">{{ TIER_HELP[d.ageTier] }}</p>
      </div>
    </Field>

    <div v-if="showMore" class="grid-2">
      <Field label="Display name" :for="id('display')" hint="Optional — how the account shows on the platform."><input :id="id('display')" v-model="d.displayName" class="input" /></Field>
      <Field label="Profile link" :for="id('profile')" :hint="preview ? `Leave blank for ${preview}` : undefined"><input :id="id('profile')" v-model="d.profileUrl" class="input" placeholder="https://…" spellcheck="false" /></Field>
    </div>
    <Field v-if="showMore" label="Notes" :for="id('notes')"><textarea :id="id('notes')" v-model="d.notes" v-autosize class="textarea" rows="2" placeholder="Recovery email, who manages it…" /></Field>

    <div class="login">
      <Toggle v-model="d.saveLogin" :label="existing && (existing.hasUsername || existing.hasPassword || existing.hasTotp) ? 'Saved login' : 'Save a login for Fill login'" hint="Encrypted with your Windows / macOS keychain. Never shown to Claude or the Local API." />
      <Transition name="slide-down">
        <div v-if="d.saveLogin">
          <div class="creds">
            <Field label="Username or email" :for="id('user')" :hint="existing?.hasUsername && !d.username ? 'Saved — leave blank to keep it' : undefined">
              <div class="row gap-2">
                <input :id="id('user')" v-model="d.username" class="input" autocomplete="off" spellcheck="false" :placeholder="existing?.hasUsername ? '•••••• (saved)' : ''" />
                <button v-if="existing?.hasUsername" type="button" class="mini" title="Remove the saved username" aria-label="Remove the saved username" @click="emit('clear', 'username')"><Icon name="trash" :size="14" /></button>
              </div>
            </Field>
            <Field label="Password" :for="id('pass')" :hint="existing?.hasPassword && !d.password ? 'Saved — leave blank to keep it' : undefined">
              <div class="row gap-2">
                <input :id="id('pass')" v-model="d.password" class="input" :type="showPw ? 'text' : 'password'" autocomplete="new-password" :placeholder="existing?.hasPassword ? '•••••• (saved)' : ''" />
                <button type="button" class="mini eye" :aria-label="showPw ? 'Hide password' : 'Show password'" :title="showPw ? 'Hide password' : 'Show password'" :aria-pressed="showPw" @click="showPw = !showPw"><Icon :name="showPw ? 'lock' : 'eye'" :size="14" /></button>
                <button v-if="existing?.hasPassword" type="button" class="mini" title="Remove the saved password" aria-label="Remove the saved password" @click="emit('clear', 'password')"><Icon name="trash" :size="14" /></button>
              </div>
            </Field>
            <Field label="2FA secret (optional)" :for="id('totp')" :error="totpProblem(d.totpSecret)" :hint="existing?.hasTotp && !d.totpSecret ? 'Saved — leave blank to keep it' : 'The setup key or otpauth:// link from “Use an authenticator app”. Cubby then shows the live code.'" class="span">
              <div class="row gap-2">
                <input :id="id('totp')" v-model="d.totpSecret" class="input code" autocomplete="off" spellcheck="false" :placeholder="existing?.hasTotp ? '•••••• (saved)' : 'JBSW Y3DP EHPK 3PXP'" />
                <button v-if="existing?.hasTotp" type="button" class="mini" title="Remove the saved 2FA secret" aria-label="Remove the saved 2FA secret" @click="emit('clear', 'totpSecret')"><Icon name="trash" :size="14" /></button>
              </div>
            </Field>
          </div>
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
.af { display: flex; flex-direction: column; gap: 16px; }
.top { display: grid; grid-template-columns: minmax(170px, 210px) minmax(0, 1fr); gap: 14px; }
.plat { position: relative; }
.pi-wrap { position: absolute; left: 12px; top: 50%; translate: 0 -50%; z-index: 1; pointer-events: none; display: grid; }
.plat :deep(.trigger.input) { padding-left: 38px; }
.handle { position: relative; }
.at { position: absolute; left: 12px; top: 50%; translate: 0 -50%; color: var(--muted); pointer-events: none; }
.input.pre { padding-left: 27px; }
.tier { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.tier p { flex: 1 1 240px; line-height: 1.45; }
.login { padding-top: 14px; border-top: 1px solid var(--line-soft); }
.creds { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; padding-top: 14px; }
.creds .row > .input { flex: 1; min-width: 0; }
.span { grid-column: 1 / -1; }
.mini { width: 40px; height: 40px; flex: none; display: grid; place-items: center; border-radius: var(--r); color: var(--muted); border: 1px solid var(--line); transition: color 160ms, border-color 160ms, background-color 160ms; }
.mini:hover { color: var(--bad); border-color: var(--bad); }
.mini:active { background: var(--panel-2); }
.mini.eye:hover { color: var(--fg); border-color: var(--line-strong); }
.mini.eye[aria-pressed='true'] { color: var(--fg); background: var(--panel-2); }
@media (max-width: 1100px) { .creds { grid-template-columns: minmax(0, 1fr); } }
</style>
