// Shared words and tones for login health and brand status, so every screen agrees.
import type { AccountSummary, BrandStatus, LoginState } from '@shared/types';
import { PLATFORM_SPECS } from '@shared/platforms';
import { ago, dateTime } from '@/lib/format';

export const LOGIN_LABEL: Record<LoginState, string> = { ok: 'Logged in', expiring: 'Expiring soon', expired: 'Needs relogin', unknown: 'Not checked' };
export const LOGIN_TONE: Record<LoginState, string> = { ok: 'good', expiring: 'warn', expired: 'bad', unknown: 'muted' };
export const STATUS_LABEL: Record<BrandStatus, string> = { open: 'Open', opening: 'Opening…', closed: 'Closed', error: 'Error' };
export const TIER_LABEL: Record<string, string> = { new: 'New', warm: 'Warm', established: 'Established' };
export const TIER_HELP: Record<string, string> = {
  new: 'Under ~3 months or recently flagged. Slowest pacing: 60 min between posts, at most 3 a day.',
  warm: 'A few months of normal use. 40 min between posts, at most 6 a day.',
  established: 'Long-lived, trusted account. 20 min between posts, at most 10 a day.'
};

/** "Instagram @ffdev · Logged in · cookie expires in 3 months" */
export function accountTip(a: Pick<AccountSummary, 'platform' | 'handle' | 'loginState' | 'cookieExpiresAt'>): string {
  const p = PLATFORM_SPECS[a.platform]?.name ?? a.platform;
  const exp = a.cookieExpiresAt ? ` · session ${new Date(a.cookieExpiresAt).getTime() < Date.now() ? 'expired' : 'expires'} ${ago(a.cookieExpiresAt)} (${dateTime(a.cookieExpiresAt)})` : '';
  return `${p} ${a.handle.startsWith('@') || a.platform === 'custom' ? a.handle : '@' + a.handle} · ${LOGIN_LABEL[a.loginState] ?? a.loginState}${exp}`;
}

export const handleText = (platform: string, handle: string) => (platform === 'custom' || handle.startsWith('@') ? handle : `@${handle}`);
export const serialText = (n: number) => `#${String(n).padStart(3, '0')}`;
