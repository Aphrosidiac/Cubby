// OWNER: browser module builder (same agent as modules/browser + modules/accounts).
// PUBLIC interface — keep exports; replace stubs.
//
// Login health (PLAN §9): read each account's platform session cookies (PLATFORM_SPECS[p].sessionCookies)
// over CDP — context.cookies(spec.cookieUrl), no page loads. All present & unexpired → ok; any expiring
// within 7 days → expiring; missing/expired → expired. setLoginState() per account, emit accounts.changed
// + brands.changed, logActivity('health.relogin_needed') + notify() when an account flips to expired.
// Open brands are checked live (every 15 min while open + right after open); closed brands once a day
// at Settings.healthCheckHour by opening them in the background (no window focus), checking, and
// closing again (only brands that were closed before the check).
// Implements commands: health.check, cookies.list, cookies.export, cookies.import, cookies.clear.
import type { Account } from '@shared/types'

/** Check every account of one brand (opens the brand only if openIfClosed). */
export async function checkBrandHealth(brandId: string, openIfClosed = false): Promise<Account[]> {
  void openIfClosed
  void brandId
  return []
}

export function start(): void {}
export async function stop(): Promise<void> {}
