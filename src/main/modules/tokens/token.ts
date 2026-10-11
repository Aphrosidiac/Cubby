// Token material, kept pure (node:crypto only) so it is unit-testable. A token is `cub_` + 32 random
// bytes in base64url; only its sha256 is stored, plus the first 8 characters to tell tokens apart.
import { createHash, randomBytes } from 'node:crypto'

export const TOKEN_PREFIX = 'cub_'
const TOKEN_RE = /^cub_[A-Za-z0-9_-]{43}$/

export function generateToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString('base64url')
}

export const hashToken = (raw: string): string => createHash('sha256').update(raw, 'utf8').digest('hex')

/** What the UI shows to identify a token ("cub_AbCd…"). */
export const tokenPrefix = (raw: string): string => raw.slice(0, 8)

/** Cheap shape check before touching the database. */
export const looksLikeToken = (raw: string): boolean => TOKEN_RE.test(raw)

/** Replace every Cubby token in a string with a mask (for commands shown in the UI / logs). */
export const maskTokens = (s: string): string => s.replace(/cub_[A-Za-z0-9_-]{8,}/g, 'cub_••••')
