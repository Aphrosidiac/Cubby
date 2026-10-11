// Client-side check of a 2FA secret, the same rule as main's isValidTotpSecret (accounts/totp.ts):
// a base32 setup key (A–Z, 2–7, 8+ characters, spaces and dashes ignored) or an otpauth:// link carrying one.
export function totpProblem(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (/^otpauth:\/\//i.test(s)) {
    try { s = new URL(s).searchParams.get('secret') ?? ''; } catch { s = ''; }
  }
  s = s.replace(/[\s-]+/g, '').replace(/=+$/, '').toUpperCase();
  return /^[A-Z2-7]{8,}$/.test(s) ? null : 'Not a 2FA setup key — paste the letters A–Z and digits 2–7, or the otpauth:// link';
}
