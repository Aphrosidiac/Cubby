<script setup lang="ts">
import { onMounted, ref } from 'vue';
import Btn from '@/components/ui/Btn.vue';
import Icon from '@/components/ui/Icon.vue';
import BrandAvatar from '@/components/common/BrandAvatar.vue';
import { lightLogo } from '@/components/common/logoTone';
import { api } from '@/lib/api';
import { fail } from '@/composables/toast';

/**
 * Logo: pick one from the brand kits found on disk, upload any image, or none (initials on the
 * brand colour). The value is a small data: URL, so it travels with exports.
 */
const props = defineProps<{ modelValue: string | null; name: string; color: string }>();
const emit = defineEmits<{ 'update:modelValue': [v: string | null] }>();
const kits = ref<{ name: string; path: string; dataUrl: string }[] | null>(null);
const kitErr = ref<string | null>(null);
const showKits = ref(false);
const busy = ref(false);
async function loadKits() {
  if (kits.value) return;
  try { kits.value = await api('app.brandKits'); } catch (e) { kitErr.value = (e as Error).message; kits.value = []; }
}
onMounted(() => { void loadKits(); });
async function upload() {
  busy.value = true;
  try {
    const [p] = await api('app.pickFiles', { filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg', 'ico'] }] });
    if (p) emit('update:modelValue', await api('app.readImageDataUrl', { path: p, maxPx: 256 }));
  } catch (e) { fail(e, 'Could not use that image'); } finally { busy.value = false; }
}
void props;
</script>

<template>
  <div class="lp">
    <div class="row gap-4">
      <BrandAvatar :brand="{ name: name || '?', color, logo: modelValue }" :size="56" />
      <div class="row wrap gap-2">
        <Btn size="sm" icon="grid" :disabled="!kits?.length" @click="showKits = !showKits"><template v-if="kits === null">Looking for brand kits…</template><template v-else-if="kits.length">Brand kits<span class="count num">{{ kits.length }}</span></template><template v-else>No brand kits found</template></Btn>
        <Btn size="sm" icon="upload" :loading="busy" @click="upload">Upload image</Btn>
        <Btn v-if="modelValue" size="sm" variant="subtle" icon="close" @click="emit('update:modelValue', null)">Use initials</Btn>
      </div>
    </div>
    <div v-if="kitErr" class="tiny muted mt-2">Could not scan for brand kits: {{ kitErr }}</div>
    <Transition name="slide-down">
      <div v-if="showKits && kits?.length">
        <div class="kits mt-3">
          <button v-for="k in kits" :key="k.path" type="button" class="kit" :class="{ sel: modelValue === k.dataUrl, ink: lightLogo(k.dataUrl) === true }" :title="k.name" :aria-label="`Use ${k.name.split(/[\\/]/).pop()}`" :aria-pressed="modelValue === k.dataUrl" @click="emit('update:modelValue', k.dataUrl); showKits = false">
            <img :src="k.dataUrl" alt="" />
            <Icon v-if="modelValue === k.dataUrl" name="check" :size="12" class="tick" />
          </button>
        </div>
        <p class="tiny muted mt-2">From brand folders under your dev directories. Hover a logo to see where it came from.</p>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.kits { display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 8px; max-height: 236px; overflow-y: auto; padding: 2px; }
.kit { position: relative; aspect-ratio: 1; border-radius: 8px; background: #fff; border: 1px solid var(--line); display: grid; place-items: center; padding: 10px; transition: border-color 200ms, transform 240ms var(--ease-out); }
.kit.ink { background: #0b0b0a; border-color: #2a2a27; }
.kit:hover, .kit:focus-visible { border-color: var(--fg); transform: translateY(-1px); }
.kit.sel { border-color: var(--fg); box-shadow: 0 0 0 2px var(--fg); }
.kit img { max-width: 100%; max-height: 100%; object-fit: contain; }
/* the same count chip as tabs and segmented controls */
.count { display: inline-grid; place-items: center; min-width: 18px; height: 18px; margin-left: 6px; padding: 0 5px; border-radius: 99px; font-family: var(--mono); font-size: var(--fs-2xs); background: color-mix(in srgb, currentColor 14%, transparent); }
.tick { position: absolute; top: 4px; right: 4px; color: var(--ink); background: var(--lime); border-radius: 50%; padding: 1px; }
</style>
