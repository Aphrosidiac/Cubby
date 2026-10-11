<script setup lang="ts">
import { ref, watch } from 'vue';
import { confirmState, settle } from '@/composables/confirm';
import Btn from './Btn.vue';
import Modal from './Modal.vue';

const value = ref('');
watch(() => confirmState.open, o => { if (o) value.value = confirmState.opts?.input?.value ?? ''; });
function yes() {
  const o = confirmState.opts;
  if (o?.input) { if (o.input.required !== false && !value.value.trim()) return; settle(value.value.trim()); }
  else settle(true);
}
const no = () => settle(confirmState.opts?.input ? null : false);
</script>

<template>
  <Modal :open="confirmState.open" :title="confirmState.opts?.title" size="sm" @update:open="v => !v && no()">
    <p v-if="confirmState.opts?.body" class="muted pre">{{ confirmState.opts.body }}</p>
    <div v-if="confirmState.opts?.input" class="mt-4">
      <label class="label" for="confirm-input">{{ confirmState.opts.input.label }}</label>
      <textarea v-if="confirmState.opts.input.multiline" id="confirm-input" v-model="value" class="textarea mt-2" :placeholder="confirmState.opts.input.placeholder" autofocus @keydown.meta.enter="yes" />
      <input v-else id="confirm-input" v-model="value" class="input mt-2" :type="confirmState.opts.input.password ? 'password' : 'text'" :autocomplete="confirmState.opts.input.password ? 'off' : undefined" :placeholder="confirmState.opts.input.placeholder" autofocus @keydown.enter="yes" />
    </div>
    <template #footer>
      <Btn variant="subtle" @click="no">{{ confirmState.opts?.cancel ?? 'Cancel' }}</Btn>
      <Btn :variant="confirmState.opts?.danger ? 'danger' : 'primary'" :disabled="!!confirmState.opts?.input && confirmState.opts.input.required !== false && !value.trim()" @click="yes">{{ confirmState.opts?.confirm ?? 'Confirm' }}</Btn>
    </template>
  </Modal>
</template>
