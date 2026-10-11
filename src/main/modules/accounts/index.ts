// Account manager (PLAN §6.3 Accounts): CRUD over repo.ts + secrets.ts, live 2FA codes, Reveal
// (person only, behind Touch ID on a Mac or the unlock passphrase) and Fill login. Plaintext
// secrets never leave the main process except through Reveal.
import { PLATFORM_SPECS } from '@shared/platforms'
import { db } from '../../core/db'
import { UserError } from '../../core/errors'
import { emit } from '../../core/events'
import { implement } from '../../core/registry'
import { requestStatus } from '../../core/runtime'
import { getSecretSetting } from '../../core/settings'
import { verifyUnlock } from '../app'
import { getBrand } from '../brands/repo'
import { activePage, frontBrand, openBrand } from '../browser'
import { fillLoginOnPage } from './fill'
import { getAccount, insertAccount, listAccounts } from './repo'
import { readAccountSecret, writeAccountSecret } from './secrets'
import { isValidTotpSecret, totpNow } from './totp'

function changed(brandId: string): void {
  emit('accounts.changed', { brandId })
  emit('brands.changed', { ids: [brandId] })
  requestStatus()
}

function checkTotp(secret: string | null | undefined): void {
  if (secret && !isValidTotpSecret(secret)) throw new UserError('That 2FA secret is not valid — paste the setup key (letters A–Z and digits 2–7) or the otpauth:// link')
}

/** Mac: Touch ID when the machine has it. Otherwise the app unlock passphrase. */
async function unlock(passphrase: string | undefined): Promise<void> {
  if (process.platform === 'darwin') {
    try {
      const { systemPreferences } = await import('electron')
      if (systemPreferences.canPromptTouchID?.()) {
        await systemPreferences.promptTouchID('show a saved login').catch(() => {
          throw new UserError('Touch ID was cancelled')
        })
        return
      }
    } catch (e) {
      if (e instanceof UserError) throw e
    }
  }
  if (!getSecretSetting('secret.unlock')) throw new UserError('Set an unlock passphrase in Settings → Security first')
  if (!passphrase) throw new UserError('Enter your unlock passphrase to show this login')
  if (!verifyUnlock(passphrase)) throw new UserError('Wrong unlock passphrase')
}

/** Type the saved login into the brand's login page (opening the brand if needed). Returns nothing. */
export async function fillLogin(accountId: string): Promise<void> {
  const a = getAccount(accountId)
  const brand = getBrand(a.brandId)
  if (a.platform === 'custom') throw new UserError('Custom accounts have no known login page — open the site and log in by hand')
  const secret = readAccountSecret(accountId)
  if (!secret.username && !secret.password) throw new UserError('No saved login for this account — add the username and password first')
  await openBrand(brand.id, { actor: 'you' })
  const page = await activePage(brand.id)
  await fillLoginOnPage(page, a.platform, { username: secret.username, password: secret.password })
  await frontBrand(brand.id, page)
}

implement({
  'accounts.list': ({ brandId }) => {
    getBrand(brandId)
    return listAccounts(brandId)
  },

  'accounts.create': ({ brandId, ...a }) => {
    getBrand(brandId)
    checkTotp(a.totpSecret)
    const acc = insertAccount(brandId, a)
    changed(brandId)
    return acc
  },

  'accounts.update': ({ id, patch }) => {
    const a = getAccount(id)
    checkTotp(patch.totpSecret)
    const cols: Record<string, string> = { handle: 'handle', displayName: 'display_name', profileUrl: 'profile_url', ageTier: 'age_tier', notes: 'notes' }
    const sets: string[] = []
    const vals: string[] = []
    for (const [k, col] of Object.entries(cols)) {
      const v = patch[k as keyof typeof patch]
      if (typeof v !== 'string') continue
      sets.push(`${col} = ?`)
      vals.push(k === 'handle' ? v.trim() : v)
    }
    // a new handle with no explicit link gets the platform's profile URL
    if (typeof patch.handle === 'string' && patch.handle.trim() !== a.handle && patch.profileUrl === undefined) {
      sets.push('profile_url = ?')
      vals.push(PLATFORM_SPECS[a.platform].profileUrl(patch.handle.trim()))
    }
    db.tx(() => {
      if (sets.length) db.run(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`, ...vals, id)
      if (patch.username !== undefined || patch.password !== undefined || patch.totpSecret !== undefined)
        writeAccountSecret(id, { username: patch.username, password: patch.password, totpSecret: patch.totpSecret })
    })
    changed(a.brandId)
    return getAccount(id)
  },

  'accounts.delete': ({ id }) => {
    const a = getAccount(id)
    db.run('DELETE FROM accounts WHERE id = ?', id)
    changed(a.brandId)
  },

  'accounts.totp': ({ id }) => {
    getAccount(id)
    const { totpSecret } = readAccountSecret(id)
    if (!totpSecret) throw new UserError('No 2FA secret is saved for this account')
    try {
      return totpNow(totpSecret)
    } catch {
      throw new UserError('The saved 2FA secret is not valid — paste it again')
    }
  },

  'accounts.reveal': async ({ id, passphrase }) => {
    getAccount(id)
    await unlock(passphrase)
    const s = readAccountSecret(id)
    return { username: s.username, password: s.password }
  },

  'accounts.fillLogin': ({ id }) => fillLogin(id)
})

export function start(): void {}
export async function stop(): Promise<void> {}

