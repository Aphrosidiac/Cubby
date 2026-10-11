// One settings section = a copy of some Settings keys + dirty tracking + save through settings.set.
// Live changes from elsewhere refresh the copy only while there is nothing unsaved.
import { computed, reactive, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import type { Settings } from '@shared/types';
import { api } from '@/lib/api';
import { app } from '@/lib/store';
import { confirm } from '@/composables/confirm';
import { fail, ok } from '@/composables/toast';

/** Ask before a tab switch or navigation throws away unsaved edits (the form unmounts with them). */
export function guardUnsaved(isDirty: () => boolean) {
  const ask = async () => !isDirty() || (await confirm({ title: 'Leave without saving?', body: 'Your changes here are not saved yet.', confirm: 'Discard changes', cancel: 'Keep editing', danger: true }));
  onBeforeRouteUpdate((to, from) => (to.path === from.path && to.query.tab === from.query.tab ? true : ask()));
  onBeforeRouteLeave(() => ask());
}

export function useSection<K extends keyof Settings>(keys: K[], opts: { alsoDirty?: () => boolean } = {}) {
  const pick = () => JSON.parse(JSON.stringify(Object.fromEntries(keys.map(k => [k, app.settings?.[k] ?? null])))) as Pick<Settings, K>;
  const form = reactive(pick()) as Pick<Settings, K>;
  const base = ref(JSON.stringify(pick()));
  const dirty = computed(() => JSON.stringify(form) !== base.value);
  watch(() => app.settings, () => {
    if (dirty.value) return;
    Object.assign(form, pick());
    base.value = JSON.stringify(pick());
  }, { deep: true });
  guardUnsaved(() => dirty.value || !!opts.alsoDirty?.());
  const busy = ref(false);
  /** msg = the toast on success; null saves quietly (the caller toasts once for several saves) */
  async function save(msg: string | null = 'Settings saved') {
    busy.value = true;
    try {
      app.settings = await api('settings.set', { patch: JSON.parse(JSON.stringify(form)) });
      Object.assign(form, pick());
      base.value = JSON.stringify(pick());
      if (msg) ok(msg);
      return true;
    } catch (e) { fail(e, 'Could not save settings'); return false; } finally { busy.value = false; }
  }
  function discard() { Object.assign(form, JSON.parse(base.value)); }
  return { form, dirty, busy, save, discard };
}
