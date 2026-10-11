// OWNER: browser module builder.
// Account manager (PLAN 6.3 Accounts): CRUD over accounts/repo.ts + secrets.ts, live TOTP (otplib), Reveal (actor you; Mac: systemPreferences.promptTouchID, Windows: verifyUnlock(passphrase) from modules/app), Fill login (types username/password into the brand's login page; opens platform loginUrl if needed; never returns secrets).
// Implements commands: accounts.list, accounts.create, accounts.update, accounts.delete, accounts.totp, accounts.reveal, accounts.fillLogin
import { implement } from '../../core/registry'

implement({})

export function start(): void {}
export async function stop(): Promise<void> {}
