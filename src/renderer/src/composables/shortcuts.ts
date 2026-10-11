import { onBeforeUnmount, onMounted } from 'vue';

const typing = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; return !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)); };

/** Keyboard shortcuts: 'mod+k', 'g i', 'n', 'Escape'. Sequences ("g i") within 900ms. */
export function useShortcuts(map: Record<string, (e: KeyboardEvent) => void>) {
  let prefix = '';
  let timer = 0;
  const on = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const combo = `${mod ? 'mod+' : ''}${e.shiftKey && key.length > 1 ? 'shift+' : ''}${key}`;
    if (map[combo] && (mod || combo === 'Escape' || !typing(e))) { e.preventDefault(); map[combo](e); prefix = ''; return; }
    if (mod || typing(e)) return;
    const seq = prefix ? `${prefix} ${key}` : key;
    if (map[seq]) { e.preventDefault(); map[seq](e); prefix = ''; return; }
    if (Object.keys(map).some(k => k.startsWith(`${key} `))) { prefix = key; clearTimeout(timer); timer = window.setTimeout(() => { prefix = ''; }, 900); }
  };
  onMounted(() => window.addEventListener('keydown', on));
  onBeforeUnmount(() => window.removeEventListener('keydown', on));
}
