// API tokens for the Local API and MCP doors: the raw token is shown once (prefix cub_), only its
// sha256 is stored, with scopes, an optional brand list, revoke and lastUsedAt.
// Implements commands: tokens.list, tokens.create, tokens.revoke
import { TOKEN_SCOPES, type ApiToken, type TokenScope } from '@shared/types'
import { db, j, pj } from '../../core/db'
import { notFound } from '../../core/errors'
import { newId, nowIso } from '../../core/ids'
import { implement } from '../../core/registry'
import { getBrand } from '../brands/repo'
import { generateToken, hashToken, looksLikeToken, tokenPrefix } from './token'

interface TokenRow {
  id: string
  name: string
  prefix: string
  hash: string
  scopes: string
  brand_ids: string | null
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

const mapToken = (r: TokenRow): ApiToken => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  scopes: pj<string[]>(r.scopes, []).filter((s): s is TokenScope => (TOKEN_SCOPES as readonly string[]).includes(s)),
  brandIds: r.brand_ids == null ? null : pj<string[] | null>(r.brand_ids, null),
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
  revokedAt: r.revoked_at
})

export function listTokens(): ApiToken[] {
  return db.all<TokenRow>('SELECT * FROM api_tokens ORDER BY created_at DESC').map(mapToken)
}

export function createToken(name: string, scopes: readonly TokenScope[], brandIds?: readonly string[] | null): { token: string; record: ApiToken } {
  const ids = brandIds && brandIds.length ? [...new Set(brandIds)] : null
  for (const id of ids ?? []) getBrand(id) // throws "Brand not found" for a bad id
  const token = generateToken()
  const id = newId('tok_')
  const uniqueScopes = TOKEN_SCOPES.filter((s) => scopes.includes(s))
  db.run(
    'INSERT INTO api_tokens (id, name, prefix, hash, scopes, brand_ids, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, name.trim(), tokenPrefix(token), hashToken(token), j(uniqueScopes), ids ? j(ids) : null, nowIso()
  )
  return { token, record: mapToken(db.get<TokenRow>('SELECT * FROM api_tokens WHERE id = ?', id)!) }
}

const revokeHooks = new Set<(id: string) => void>()
/** The MCP door drops sessions of a revoked token. */
export function onTokenRevoked(fn: (id: string) => void): () => void {
  revokeHooks.add(fn)
  return () => revokeHooks.delete(fn)
}

export function revokeToken(id: string): void {
  const r = db.get<TokenRow>('SELECT * FROM api_tokens WHERE id = ?', id)
  if (!r) throw notFound('Token')
  if (!r.revoked_at) db.run('UPDATE api_tokens SET revoked_at = ? WHERE id = ?', nowIso(), id)
  for (const fn of revokeHooks) {
    try {
      fn(id)
    } catch (e) {
      console.warn('token revoke hook failed', e)
    }
  }
}

/**
 * The live, unrevoked token for a raw bearer value, or null. Hash lookup, so no timing-safe compare
 * is needed. lastUsedAt is written at most once a minute per token.
 */
export function verifyToken(raw: string): (ApiToken & { brandIds: string[] | null }) | null {
  if (!raw || !looksLikeToken(raw)) return null
  const r = db.get<TokenRow>('SELECT * FROM api_tokens WHERE hash = ?', hashToken(raw))
  if (!r || r.revoked_at) return null
  const now = Date.now()
  if (!r.last_used_at || now - Date.parse(r.last_used_at) > 60_000) {
    r.last_used_at = new Date(now).toISOString()
    db.run('UPDATE api_tokens SET last_used_at = ? WHERE id = ?', r.last_used_at, r.id)
  }
  return mapToken(r)
}

implement({
  'tokens.list': () => listTokens(),
  'tokens.create': ({ name, scopes, brandIds }) => createToken(name, scopes, brandIds),
  'tokens.revoke': ({ id }) => revokeToken(id)
})

export function start(): void {}
export async function stop(): Promise<void> {}
