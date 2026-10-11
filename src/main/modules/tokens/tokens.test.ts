import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, db, openDb } from '../../core/db'
import { initPaths } from '../../core/paths'
import { generateToken, hashToken, looksLikeToken, maskTokens, tokenPrefix } from './token'
import { createToken, listTokens, revokeToken, verifyToken } from './index'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('token material', () => {
  it('generates cub_ + 32 random bytes in base64url', () => {
    const t = generateToken()
    expect(t).toMatch(/^cub_[A-Za-z0-9_-]{43}$/)
    expect(looksLikeToken(t)).toBe(true)
    expect(generateToken()).not.toBe(t)
  })
  it('hashes with sha256 hex and keeps an 8-char prefix', () => {
    expect(hashToken('cub_x')).toMatch(/^[0-9a-f]{64}$/)
    expect(hashToken('cub_x')).toBe(hashToken('cub_x'))
    expect(tokenPrefix('cub_ABCDEFGH')).toBe('cub_ABCD')
  })
  it('rejects malformed tokens and masks tokens in text', () => {
    expect(looksLikeToken('cub_short')).toBe(false)
    expect(looksLikeToken('Bearer cub_' + 'a'.repeat(43))).toBe(false)
    const t = generateToken()
    expect(maskTokens(`claude mcp add --header "Authorization: Bearer ${t}"`)).toBe('claude mcp add --header "Authorization: Bearer cub_••••"')
  })
})

describe('token store', () => {
  beforeAll(() => {
    initPaths(mkdtempSync(join(tmpdir(), 'cubby-tok-')))
    openDb(':memory:')
    db.run("INSERT INTO brands (id, serial, name, slug, created_at) VALUES ('br_1', 1, 'FF', 'ff', '2026-10-11')")
  })
  afterAll(() => closeDb())

  it('stores only the hash, verifies, and revokes', () => {
    const { token, record } = createToken('Test', ['read', 'mcp', 'read'], ['br_1'])
    expect(record.scopes).toEqual(['read', 'mcp'])
    expect(record.brandIds).toEqual(['br_1'])
    expect(record.prefix).toBe(token.slice(0, 8))
    const row = db.get<{ hash: string }>('SELECT * FROM api_tokens WHERE id = ?', record.id)!
    expect(row.hash).toBe(hashToken(token))
    expect(JSON.stringify(row)).not.toContain(token)

    const v = verifyToken(token)
    expect(v?.id).toBe(record.id)
    expect(v?.lastUsedAt).toBeTruthy()
    expect(verifyToken(token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'))).toBeNull()
    expect(verifyToken('')).toBeNull()

    revokeToken(record.id)
    expect(verifyToken(token)).toBeNull()
    expect(listTokens()[0].revokedAt).toBeTruthy()
  })

  it('updates lastUsedAt at most once a minute', () => {
    const { token, record } = createToken('Throttle', ['read'])
    verifyToken(token)
    const first = db.get<{ last_used_at: string }>('SELECT last_used_at FROM api_tokens WHERE id = ?', record.id)!.last_used_at
    db.run('UPDATE api_tokens SET last_used_at = ? WHERE id = ?', new Date(Date.now() - 30_000).toISOString(), record.id)
    const set = db.get<{ last_used_at: string }>('SELECT last_used_at FROM api_tokens WHERE id = ?', record.id)!.last_used_at
    verifyToken(token)
    expect(db.get<{ last_used_at: string }>('SELECT last_used_at FROM api_tokens WHERE id = ?', record.id)!.last_used_at).toBe(set)
    db.run('UPDATE api_tokens SET last_used_at = ? WHERE id = ?', new Date(Date.now() - 120_000).toISOString(), record.id)
    verifyToken(token)
    expect(db.get<{ last_used_at: string }>('SELECT last_used_at FROM api_tokens WHERE id = ?', record.id)!.last_used_at).not.toBe(set)
    expect(first).toBeTruthy()
  })

  it('refuses unknown brands', () => {
    expect(() => createToken('Bad', ['read'], ['br_nope'])).toThrow(/not found/)
  })
})
