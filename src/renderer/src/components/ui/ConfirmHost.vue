<script setup lang="ts">
import { ref, watch } from 'vue';
import { confirmState, settle } from '@/composables/confirm';
import Btn from './Btn.vue';
import Modal from './Modal.vue';

const value = ref('');
watch(() => confirmState.open, o => { if (o) value.value = confirmState.opts?.input?.value ?? ''; });
function yes() {
  const o = confirmState.opts;
  if (o?.input) { if (o.input.required !== false && !value.value.trim()) return; settle(o.input.password ? value.value : value.value.trim()); } // passphrases keep their spaces
  else settle(true);
}
const no = () => settle(confirmState.opts?.input ? null : false);
</script>

<template>
  <!-- layer 1000: a confirm opened from inside a modal (revoke from a token dialog, discard
       from an editor) must land above it, not behind it -->
  <Modal :open="confirmState.open" :title="confirmState.opts?.title" size="sm" :layer="1000" @update:open="v => !v && no()">
    <p v-if="confirmState.opts?.body" class="muted pre body">{{ confirmState.opts.body }}</p>
    <div v-if="confirmState.opts?.input" :class="{ 'mt-4': !!confirmState.opts?.body }">
      <label class="label" for="confirm-input">{{ confirmState.opts.input.label }}</label>
      <textarea v-if="confirmState.opts.input.multiline" id="confirm-input" v-model="value" class="textarea mt-2" :placeholder="confirmState.opts.input.placeholder" autofocus @keydown.meta.enter="yes" @keydown.ctrl.enter="yes" />
      <input v-else id="confirm-input" v-model="value" class="input mt-2" :type="confirmState.opts.input.password ? 'password' : 'text'" :autocomplete="confirmState.opts.input.password ? 'new-password' : 'off'" spellcheck="false" :placeholder="confirmState.opts.input.placeholder" autofocus @keydown.enter.prevent="yes" />
    </div>
    <template #footer>
      <!-- Without a field, the keyboard starts on the safe choice for a destructive confirm
           (Enter cancels) and on the action otherwise (Enter confirms). -->
      <Btn variant="subtle" :autofocus="!confirmState.opts?.input && confirmState.opts?.danger ? true : undefined" @click="no">{{ confirmState.opts?.cancel ?? 'Cancel' }}</Btn>
      <Btn :variant="confirmState.opts?.danger ? 'danger' : 'primary'" :autofocus="!confirmState.opts?.input && !confirmState.opts?.danger ? true : undefined" :disabled="!!confirmState.opts?.input && confirmState.opts.input.required !== false && !value.trim()" @click="yes">{{ confirmState.opts?.confirm ?? 'Confirm' }}</Btn>
    </template>
  </Modal>
</template>

<style scoped>
.body { overflow-wrap: anywhere; }
</style>
