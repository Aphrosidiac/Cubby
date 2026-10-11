// Editable account draft used by the New brand wizard and the account drawer.
import type { AgeTier, Platform } from '@shared/types';

export interface AccountDraft {
  key: string;
  platform: Platform;
  handle: string;
  displayName: string;
  profileUrl: string;
  ageTier: AgeTier;
  notes: string;
  /** show the saved-login fields */
  saveLogin: boolean;
  username: string;
  password: string;
  totpSecret: string;
}

let n = 0;
export function newDraft(platform: Platform = 'instagram'): AccountDraft {
  return { key: `d${++n}`, platform, handle: '', displayName: '', profileUrl: '', ageTier: 'new', notes: '', saveLogin: false, username: '', password: '', totpSecret: '' };
}

/** "@ffdev" / "instagram.com/ffdev" / full URL → bare handle */
export function cleanHandle(platform: Platform, raw: string): string {
  const s = raw.trim();
  if (platform === 'custom') return s;
  const m = /^(?:https?:\/\/)?(?:www\.|m\.)?[a-z.]+\.(?:com|net)\/(?:@|in\/)?([^/?#]+(?:\/[^/?#]+)?)/i.exec(s);
  const h = m ? m[1].replace(/\/$/, '') : s;
  return h.replace(/^@/, '');
}

export function draftToInput(d: AccountDraft) {
  const handle = cleanHandle(d.platform, d.handle);
  return {
    platform: d.platform, handle, ageTier: d.ageTier,
    displayName: d.displayName.trim() || undefined, profileUrl: d.profileUrl.trim() || undefined, notes: d.notes.trim() || undefined,
    username: d.saveLogin && d.username.trim() ? d.username.trim() : undefined,
    password: d.saveLogin && d.password ? d.password : undefined,
    totpSecret: d.saveLogin && d.totpSecret.trim() ? d.totpSecret.replace(/\s+/g, '') : undefined
  };
}
