// Brand actions shared by Home, Brand detail, the command palette and the switcher, so every door
// opens, closes and deletes a brand the same way (same confirms, same toasts, same undo).
import { reactive } from 'vue';
import { useRouter } from 'vue-router';
import type { BrandRow } from '@shared/types';
import { PLATFORM_SPECS } from '@shared/platforms';
import type { MenuItem } from '@/components/ui/types';
import { api } from '@/lib/api';
import { confirm } from '@/composables/confirm';
import { fail, ok, toast } from '@/composables/toast';
import { LOGIN_LABEL } from '@/components/common/login';

type B = Pick<BrandRow, 'id' | 'name' | 'status'> & Partial<Pick<BrandRow, 'accounts'>>;

/** ids with an open/close/front in flight (buttons spin; double clicks are ignored) */
export const pendingBrands = reactive(new Set<string>());

export function normalizeUrl(u: string): string {
  const s = u.trim();
  if (!s) return s;
  return /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
}

export const loginUrls = (b: Pick<BrandRow, 'accounts'>) =>
  [...new Set((b.accounts ?? []).map(a => PLATFORM_SPECS[a.platform]?.loginUrl).filter((u): u is string => !!u && u !== 'about:blank'))];

export function useBrandActions() {
  const router = useRouter();

  async function guard(id: string, fn: () => Promise<unknown>, title?: string): Promise<boolean> {
    if (pendingBrands.has(id)) return false;
    pendingBrands.add(id);
    try { await fn(); return true; } catch (e) { fail(e, title); return false; } finally { pendingBrands.delete(id); }
  }

  const open = (b: B, urls?: string[]) => guard(b.id, () => api('brands.open', { id: b.id, urls }), `Could not open ${b.name}`);
  const close = (b: B) => guard(b.id, () => api('brands.close', { id: b.id }), `Could not close ${b.name}`);
  const front = (b: B) => guard(b.id, () => api('brands.front', { id: b.id }), `Could not bring ${b.name} to front`);
  /** Open if closed, bring to front if already open. */
  const openOrFront = (b: B) => (b.status === 'open' ? front(b) : open(b));
  const toggle = (b: B) => (b.status === 'open' || b.status === 'opening' ? close(b) : open(b));

  async function health(b: B) {
    try {
      const accts = await api('health.check', { brandId: b.id });
      const bad = accts.filter(a => a.loginState === 'expired' || a.loginState === 'expiring');
      if (!accts.length) toast(`${b.name} has no accounts to check`);
      else if (!bad.length) ok(`${b.name}: all ${accts.length} logins fine`);
      else toast(`${b.name}: ${bad.length} need attention`, { tone: 'warn', body: bad.map(a => `${PLATFORM_SPECS[a.platform]?.name} ${a.handle} — ${LOGIN_LABEL[a.loginState]}`).join(' · ') });
    } catch (e) { fail(e, 'Health check failed'); }
  }

  async function openUrl(b: B) {
    const url = await confirm({ title: `Open a page in ${b.name}`, body: 'Opens in this brand’s own Chrome window (opening the brand first if it is closed).', confirm: 'Open', input: { label: 'Address', placeholder: 'instagram.com/accounts/edit' } });
    if (!url) return;
    await guard(b.id, () => api('brands.openUrl', { id: b.id, url: normalizeUrl(url) }), 'Could not open that page');
  }

  /** Move to the recycle bin, with Undo. */
  async function remove(bs: B[], after?: () => void) {
    if (!bs.length) return false;
    const one = bs.length === 1;
    const anyOpen = bs.some(b => b.status === 'open' || b.status === 'opening');
    const yes = await confirm({
      title: one ? `Delete ${bs[0].name}?` : `Delete ${bs.length} brands?`,
      body: `${anyOpen ? 'Open windows are closed first. ' : ''}${one ? 'It goes' : 'They go'} to the recycle bin with ${one ? 'its' : 'their'} logins and settings for 30 days, then ${one ? 'is' : 'are'} deleted for good.`,
      confirm: 'Move to recycle bin', danger: true
    });
    if (!yes) return false;
    try {
      const ids = bs.map(b => b.id);
      await api('brands.delete', { ids });
      toast(one ? `${bs[0].name} moved to the recycle bin` : `${bs.length} brands moved to the recycle bin`, {
        action: { label: 'Undo', run: () => void api('brands.restore', { ids }).then(() => ok('Restored')).catch(e => fail(e)) }, ms: 7000
      });
      after?.();
      return true;
    } catch (e) { fail(e, 'Could not delete'); return false; }
  }

  function detail(b: Pick<BrandRow, 'id'>, tab?: string) { void router.push(tab ? `/brands/${b.id}?tab=${tab}` : `/brands/${b.id}`); }

  /** The ⋯ menu for one brand. `extra` slots page-specific items (e.g. Move to group) before Delete. */
  function menu(b: B, extra: MenuItem[] = [], opts: { detail?: boolean } = {}): MenuItem[] {
    const isOpen = b.status === 'open' || b.status === 'opening';
    return [
      { label: isOpen ? 'Close' : b.status === 'error' ? 'Reopen' : 'Open', icon: isOpen ? 'close' : 'open', run: () => void toggle(b) },
      { label: 'Bring to front', icon: 'front', disabled: b.status !== 'open', run: () => void front(b) },
      { label: 'Open URL…', icon: 'globe', run: () => void openUrl(b) },
      ...(b.accounts?.length ? [{ label: 'Open login pages', icon: 'key', run: () => void open(b, loginUrls(b as BrandRow)) }] : []),
      { divider: true, label: '' },
      ...(opts.detail === false ? [] : [{ label: 'Edit', icon: 'edit', run: () => detail(b, 'settings') }]),
      { label: 'Health check', icon: 'pulse', run: () => void health(b) },
      ...extra,
      { divider: true, label: '' },
      { label: 'Delete', icon: 'trash', danger: true, run: () => void remove([b]) }
    ];
  }

  return { open, close, front, openOrFront, toggle, health, openUrl, remove, detail, menu, pending: pendingBrands };
}
