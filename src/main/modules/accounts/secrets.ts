// Account credentials. Encrypted with Electron safeStorage (Keychain on Mac, DPAPI on Windows) and
// stored as a blob in SQLite. Plaintext only ever exists in the main process: it is typed straight
// into a brand's login page (Fill login) or shown to the person after an unlock (Reveal).
import { safeStorage } from 'electron'
import { db } from '../../core/db'
import { UserError } from '../../core/errors'
import { normalizeTotpSecret } from './totp'

export interface AccountSecret {
  username: string | null
  password: string | null
  totpSecret: string | null
}

const EMPTY: AccountSecret = { username: null, password: null, totpSecret: null }

function canEncrypt(): boolean {
  try {
    return !!safeStorage?.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function encryptString(s: string): Buffer {
  if (canEncrypt()) return safeStorage.encryptString(s)
  if (process.env.VITEST) return Buffer.from('plain:' + s, 'utf8')
  throw new UserError('OS encryption (Keychain / DPAPI) is not available — cannot store secrets')
}

export function decryptString(buf: Uint8Array): string {
  const b = Buffer.from(buf)
  if (b.subarray(0, 6).toString('utf8') === 'plain:') return b.subarray(6).toString('utf8')
  return safeStorage.decryptString(b)
}

export function readAccountSecret(accountId: string): AccountSecret {
  const r = db.get<{ secret: Uint8Array | null }>('SELECT secret FROM accounts WHERE id = ?', accountId)
  if (!r?.secret) return { ...EMPTY }
  try {
    return { ...EMPTY, ...(JSON.parse(decryptString(r.secret)) as Partial<AccountSecret>) }
  } catch {
    return { ...EMPTY }
  }
}

/** Merge a patch into the stored secret. `undefined` keeps a field, `null`/'' clears it. */
export function writeAccountSecret(accountId: string, patch: Partial<AccountSecret>): void {
  const cur = readAccountSecret(accountId)
  const next: AccountSecret = { ...cur }
  for (const k of ['username', 'password', 'totpSecret'] as const) {
    if (patch[k] === undefined) continue
    const v = patch[k]
    next[k] = v == null || v === '' ? null : k === 'totpSecret' ? normalizeTotpSecret(v) : v
  }
  const empty = !next.username && !next.password && !next.totpSecret
  db.run(
    'UPDATE accounts SET secret = ?, has_username = ?, has_password = ?, has_totp = ? WHERE id = ?',
    empty ? null : encryptString(JSON.stringify(next)),
    !!next.username,
    !!next.password,
    !!next.totpSecret,
    accountId
  )
}
