import type { Account, AgeTier, LoginState, Platform } from '@shared/types'
import { PLATFORM_SPECS } from '@shared/platforms'
import { b, db } from '../../core/db'
import { notFound } from '../../core/errors'
import { newId, nowIso } from '../../core/ids'
import { writeAccountSecret } from './secrets'

export interface AccountDbRow {
  id: string
  brand_id: string
  platform: string
  handle: string
  display_name: string
  profile_url: string
  age_tier: string
  login_state: string
  cookie_expires_at: string | null
  last_checked_at: string | null
  has_username: number
  has_password: number
  has_totp: number
  notes: string
  created_at: string
}

const COLS = 'id, brand_id, platform, handle, display_name, profile_url, age_tier, login_state, cookie_expires_at, last_checked_at, has_username, has_password, has_totp, notes, created_at'

export const mapAccount = (r: AccountDbRow): Account => ({
  id: r.id,
  brandId: r.brand_id,
  platform: r.platform as Platform,
  handle: r.handle,
  displayName: r.display_name,
  profileUrl: r.profile_url,
  ageTier: r.age_tier as AgeTier,
  loginState: r.login_state as LoginState,
  cookieExpiresAt: r.cookie_expires_at,
  lastCheckedAt: r.last_checked_at,
  hasUsername: b(r.has_username),
  hasPassword: b(r.has_password),
  hasTotp: b(r.has_totp),
  notes: r.notes,
  createdAt: r.created_at
})

export function getAccount(id: string): Account {
  const r = db.get<AccountDbRow>(`SELECT ${COLS} FROM accounts WHERE id = ?`, id)
  if (!r) throw notFound('Account')
  return mapAccount(r)
}

export function listAccounts(brandId: string): Account[] {
  return db.all<AccountDbRow>(`SELECT ${COLS} FROM accounts WHERE brand_id = ? ORDER BY created_at`, brandId).map(mapAccount)
}

export function listAllAccounts(): Account[] {
  return db.all<AccountDbRow>(`SELECT ${COLS} FROM accounts ORDER BY created_at`).map(mapAccount)
}

export interface NewAccount {
  platform: Platform
  handle: string
  displayName?: string
  profileUrl?: string
  ageTier?: AgeTier
  notes?: string
  username?: string
  password?: string
  totpSecret?: string
}

export function insertAccount(brandId: string, a: NewAccount): Account {
  const id = newId('acc_')
  const handle = a.handle.trim()
  db.run(
    'INSERT INTO accounts (id, brand_id, platform, handle, display_name, profile_url, age_tier, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    brandId,
    a.platform,
    handle,
    a.displayName ?? '',
    a.profileUrl || PLATFORM_SPECS[a.platform].profileUrl(handle),
    a.ageTier ?? 'new',
    a.notes ?? '',
    nowIso()
  )
  if (a.username || a.password || a.totpSecret) writeAccountSecret(id, { username: a.username, password: a.password, totpSecret: a.totpSecret })
  return getAccount(id)
}

export function setLoginState(id: string, state: LoginState, cookieExpiresAt: string | null): void {
  db.run('UPDATE accounts SET login_state = ?, cookie_expires_at = ?, last_checked_at = ? WHERE id = ?', state, cookieExpiresAt, nowIso(), id)
}
