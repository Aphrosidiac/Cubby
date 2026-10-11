import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseCsv, parseCsvObjects, toCsv } from '@shared/csv'
import { FIT_TARGETS, gradeMedia, isOffLimits, platformOfUrl } from '@shared/platforms'
import { decryptBuffer, decryptStream, encryptBuffer, encryptStream } from './crypto'
import { db, openDb } from './db'
import { GuardrailError } from './errors'
import { initPaths } from './paths'
import { implement, invoke, redact } from './registry'
import { setKillSwitch } from './runtime'

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'cubby-core-'))
  initPaths(dir)
  openDb(join(dir, 'app.sqlite'))
  db.run("INSERT INTO brands (id, serial, name, slug, created_at) VALUES ('b1', 1, 'FF', 'ff', '2026-10-11'), ('b2', 2, 'Ascend', 'ascend', '2026-10-11')")
  implement({
    'brands.get': ({ id }) => ({ id }) as never,
    'brands.update': ({ id }) => ({ id }) as never,
    'accounts.reveal': () => ({ username: 'u', password: 'p' })
  })
})

describe('registry', () => {
  it('validates input with the contract schema', async () => {
    await expect(invoke('brands.get', {}, { actor: 'you' })).rejects.toThrow(/invalid input for brands.get/)
  })

  it('enforces actor rules', async () => {
    await expect(invoke('accounts.reveal', { id: 'a' }, { actor: 'claude' })).rejects.toThrow(/only be done from the Cubby app/)
    await expect(invoke('accounts.reveal', { id: 'a' }, { actor: 'you' })).resolves.toEqual({ username: 'u', password: 'p' })
  })

  it('enforces token scopes and brand scoping', async () => {
    await expect(invoke('brands.get', { id: 'b1' }, { actor: 'api', scopes: ['brands'] })).rejects.toThrow(/lacks the "read" scope/)
    await expect(invoke('brands.get', { id: 'b1' }, { actor: 'api', scopes: ['read'], tokenBrandIds: ['b2'] })).rejects.toThrow(/not allowed to use this brand/)
    await expect(invoke('brands.get', { id: 'b2' }, { actor: 'api', scopes: ['read'], tokenBrandIds: ['b2'] })).resolves.toEqual({ id: 'b2' })
  })

  it('enforces the brand lock', async () => {
    const err = await invoke('brands.get', { id: 'b2' }, { actor: 'claude', brandLock: 'b1' }).catch((e) => e)
    expect(err).toBeInstanceOf(GuardrailError)
    expect((err as GuardrailError).rule).toBe('brand_lock')
  })

  it('kill switch blocks automation writes but not reads or the person', async () => {
    setKillSwitch(true)
    try {
      await expect(invoke('brands.update', { id: 'b1', patch: { notes: 'x' } }, { actor: 'claude' })).rejects.toThrow(/kill switch/)
      await expect(invoke('brands.get', { id: 'b1' }, { actor: 'claude' })).resolves.toEqual({ id: 'b1' })
      await expect(invoke('brands.update', { id: 'b1', patch: { notes: 'x' } }, { actor: 'you' })).resolves.toEqual({ id: 'b1' })
    } finally {
      setKillSwitch(false)
    }
  })

  it('logs mutations to Activity with secrets redacted', async () => {
    await invoke('accounts.reveal', { id: 'a', passphrase: 'hunter22' }, { actor: 'you' })
    const row = db.get<{ action: string; detail: string }>("SELECT action, detail FROM activity WHERE action = 'accounts.reveal' ORDER BY id DESC")
    expect(row?.detail).not.toContain('hunter22')
    expect(redact({ password: 'x', nested: { totpSecret: 'y' }, ok: 1 })).toEqual({ password: '••••', nested: { totpSecret: '••••' }, ok: 1 })
  })
})

describe('crypto', () => {
  it('round-trips buffers and rejects a wrong passphrase', () => {
    const enc = encryptBuffer(Buffer.from('hello cubby'), 'correct horse')
    expect(decryptBuffer(enc, 'correct horse').toString()).toBe('hello cubby')
    expect(() => decryptBuffer(enc, 'wrong')).toThrow(/Wrong passphrase/)
  })

  it('stream format equals buffer format', async () => {
    const plain = Buffer.alloc(300_000, 7)
    const chunks: Buffer[] = []
    await pipeline(Readable.from([plain.subarray(0, 1000), plain.subarray(1000)]), encryptStream('pw'), async function* (src) {
      for await (const c of src) chunks.push(c as Buffer)
      yield* []
    })
    const enc = Buffer.concat(chunks)
    expect(decryptBuffer(enc, 'pw').equals(plain)).toBe(true)
    const out: Buffer[] = []
    await pipeline(Readable.from([enc.subarray(0, 5), enc.subarray(5, 100), enc.subarray(100)]), decryptStream('pw'), async function* (src) {
      for await (const c of src) out.push(c as Buffer)
      yield* []
    })
    expect(Buffer.concat(out).equals(plain)).toBe(true)
  })
})

describe('csv', () => {
  it('parses quotes, commas, CRLF and BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']])
    expect(parseCsvObjects('Name,Instagram\nFF,@ffdev\n')).toEqual([{ name: 'FF', instagram: '@ffdev' }])
    expect(parseCsv(toCsv([['a,b', 'c"d', null]]))).toEqual([['a,b', 'c"d', '']])
  })
})

describe('platforms', () => {
  const reel = FIT_TARGETS.find((t) => t.id === 'instagram_reel')!
  it('grades media against a target', () => {
    expect(gradeMedia({ kind: 'video', width: 1080, height: 1920, durationMs: 15000, codec: 'h264', sizeBytes: 5e6 }, reel).level).toBe('ok')
    expect(gradeMedia({ kind: 'video', width: 1920, height: 1080, durationMs: 15000, codec: 'h264', sizeBytes: 5e6 }, reel).level).toBe('bad')
    expect(gradeMedia({ kind: 'image', width: 1080, height: 1920, durationMs: null, codec: null, sizeBytes: 1e5 }, reel).notes).toContain('needs a video')
  })
  it('knows off-limits pages and platforms', () => {
    expect(isOffLimits('https://www.instagram.com/accounts/password/change/')).toBe(true)
    expect(isOffLimits('https://accountscenter.instagram.com/personal_info/')).toBe(true)
    expect(isOffLimits('https://www.instagram.com/ffdev/')).toBe(false)
    expect(platformOfUrl('https://www.tiktok.com/@x')).toBe('tiktok')
    expect(platformOfUrl('https://x.com/home')).toBe('x')
  })
})
