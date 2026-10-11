<script setup lang="ts">
import { computed, ref } from 'vue';
import Toggle from '@/components/ui/Toggle.vue';
import Btn from '@/components/ui/Btn.vue';
import Field from '@/components/ui/Field.vue';
import Icon from '@/components/ui/Icon.vue';
import SaveBar from '@/components/common/SaveBar.vue';
import { useSection } from './useSection';
import { ok, toast } from '@/composables/toast';
import { isMac } from '@/lib/api';

/** OS notifications, and an optional Telegram bot for when you're away from the computer. */
const { form, dirty, busy, save, discard } = useSection(['notifications']);
const showTok = ref(false);
const tokOk = computed(() => !form.notifications.telegramBotToken || /^\d{5,}:[\w-]{30,}$/.test(form.notifications.telegramBotToken.trim()));
const chatOk = computed(() => !form.notifications.telegramChatId || /^-?\d{3,}$|^@\w{4,}$/.test(form.notifications.telegramChatId.trim()));
const tgReady = computed(() => !!form.notifications.telegramBotToken?.trim() && !!form.notifications.telegramChatId?.trim() && tokOk.value && chatOk.value);
function test() {
  if (!tgReady.value) { toast('Add the bot token and chat id first', { tone: 'warn' }); return; }
  ok('Telegram details look right', dirty.value ? 'Save, then the next notification (a post needing you, a login expiring, a checkpoint) also goes to this chat.' : 'The next notification — a post needing you, a login expiring, a checkpoint — also goes to this chat.');
}
function setTok(v: string) { form.notifications.telegramBotToken = v.trim() || null; }
function setChat(v: string) { form.notifications.telegramChatId = v.trim() || null; }
</script>

<template>
  <div class="set-sec">
    <div class="set-row">
      <div class="set-l"><span class="t">{{ isMac ? 'macOS' : 'Windows' }} notifications</span><span class="d">Posts waiting for approval, posts that need you, logins that expired, checkpoints. Clicking one opens Cubby on the right screen.</span></div>
      <div class="set-c"><Toggle v-model="form.notifications.os" label="Show system notifications" /></div>
    </div>
    <div class="set-row">
      <div class="set-l"><span class="t">Telegram</span><span class="d">Optional. The same alerts as a Telegram message, for when you are away. Create a bot with @BotFather, send it a message, then paste its token and your chat id.</span></div>
      <div class="set-c">
        <Field label="Bot token" :error="tokOk ? null : 'Looks like 123456789:AA… from @BotFather'" class="w">
          <div class="tok">
            <input :value="form.notifications.telegramBotToken ?? ''" :type="showTok ? 'text' : 'password'" class="input code" autocomplete="off" spellcheck="false" placeholder="123456789:AAH…" @input="setTok(($event.target as HTMLInputElement).value)" />
            <button type="button" class="eye" :aria-label="showTok ? 'Hide token' : 'Show token'" @click="showTok = !showTok"><Icon :name="showTok ? 'lock' : 'eye'" :size="14" /></button>
          </div>
        </Field>
        <Field label="Chat id" :error="chatOk ? null : 'A number like 123456789 (or -100… for a group)'" class="w">
          <input :value="form.notifications.telegramChatId ?? ''" class="input code" autocomplete="off" spellcheck="false" placeholder="123456789" @input="setChat(($event.target as HTMLInputElement).value)" />
        </Field>
        <Btn size="sm" icon="send" :disabled="!tgReady" @click="test">Test</Btn>
      </div>
    </div>
    <SaveBar :show="dirty" :busy="busy" :disabled="!tokOk || !chatOk" @save="save('Notification settings saved')" @discard="discard" />
  </div>
</template>

<style scoped>
.w { width: 100%; max-width: 420px; }
.tok { position: relative; }
.tok .input { padding-right: 40px; }
.eye { position: absolute; right: 6px; top: 50%; translate: 0 -50%; width: 28px; height: 28px; display: grid; place-items: center; border-radius: 6px; color: var(--muted); }
.eye:hover { background: var(--panel-2); color: var(--fg); }
</style>
