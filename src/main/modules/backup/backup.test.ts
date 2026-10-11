import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { UserError } from '../../core/errors'
import { createArchive, extractArchive } from './archive'
import { backupFileName, exportFileName, safeEntryName, skipProfilePath, toPrune, uniqueName } from './names'

const root = mkdtempSync(join(tmpdir(), 'cubby-b-media-test-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('skipProfilePath', () => {
  it('skips caches, locks and logs', () => {
    for (const p of [
      'Default/Cache/Cache_Data/f_000001',
      'Default/Code Cache/js/index',
      'GPUCache/data_0',
      'Default/DawnCache/data_0',
      'GrShaderCache/data_1',
      'ShaderCache/index',
      'Default/Service Worker/CacheStorage/abc/index',
      'Default/Service Worker/ScriptCache/1',
      'Crashpad/reports/x.dmp',
      'component_crx_cache/abc',
      'optimization_guide_model_store/1/model.tflite',
      'Default/optimization_guide_hint_cache_store/LOG',
      'SingletonLock',
      'SingletonCookie',
      'SingletonSocket',
      'DevToolsActivePort',
      'Default/Local Storage/leveldb/LOCK',
      'Default/Local Storage/leveldb/LOG',
      'Default/Local Storage/leveldb/LOG.old',
      'chrome_debug.log',
      'Default\\Cache\\index'
    ])
      expect(skipProfilePath(p), p).toBe(true)
  })
  it('keeps the data that matters', () => {
    for (const p of [
      'Local State',
      'Default/Preferences',
      'Default/Network/Cookies',
      'Default/Cookies',
      'Default/Login Data',
      'Default/Local Storage/leveldb/000003.log',
      'Default/Local Storage/leveldb/000005.ldb',
      'Default/IndexedDB/https_www.instagram.com_0.indexeddb.leveldb/000004.log',
      'Default/Service Worker/Database/000001.log',
      'Default/Extensions/abc/1.0/manifest.json'
    ])
      expect(skipProfilePath(p), p).toBe(false)
  })
})

describe('names', () => {
  it('builds backup and export names', () => {
    const d = new Date(2026, 9, 11, 7, 5)
    expect(backupFileName(d)).toBe('Cubby-backup-2026-10-11-0705.cubbybak')
    expect(exportFileName(['FF: Dev/Studio'], d)).toBe('FF Dev Studio-2026-10-11.brand')
    expect(exportFileName(['A', 'B'], d)).toBe('brands-2026-10-11.brand')
  })
  it('resolves name collisions', () => {
    expect(uniqueName('Ascend', [])).toBe('Ascend')
    expect(uniqueName('Ascend', ['ascend'])).toBe('Ascend (2)')
    expect(uniqueName('Ascend', ['Ascend', 'Ascend (2)', 'ascend (3)'])).toBe('Ascend (4)')
    expect(uniqueName('Ascend (2)', ['Ascend', 'Ascend (2)'])).toBe('Ascend (3)')
  })
  it('prunes to the newest N archives only', () => {
    const files = [1, 5, 3, 2, 4].map((n) => ({ name: `Cubby-backup-2026-10-0${n}-0300.cubbybak`, mtimeMs: n }))
    files.push({ name: 'notes.txt', mtimeMs: 0 })
    expect(toPrune(files, 3).map((f) => f.mtimeMs)).toEqual([2, 1])
    expect(toPrune(files, 0).length).toBe(4) // keep at least one
    expect(toPrune(files, 10)).toEqual([])
  })
  it('rejects unsafe tar entry names', () => {
    expect(safeEntryName('profiles/ff/Default/Preferences')).toBe('profiles/ff/Default/Preferences')
    expect(safeEntryName('../evil')).toBeNull()
    expect(safeEntryName('profiles/../../evil')).toBeNull()
    expect(safeEntryName('C:/Windows/x')).toBeNull()
    expect(safeEntryName('/abs/ok')).toBe('abs/ok')
  })
})

describe('archive round trip', () => {
  it('tar + gzip + encrypt and back, skipping caches', async () => {
    const src = join(root, 'src')
    const prof = join(src, 'ff')
    mkdirSync(join(prof, 'Default', 'Cache'), { recursive: true })
    mkdirSync(join(prof, 'Default', 'Local Storage', 'leveldb'), { recursive: true })
    writeFileSync(join(prof, 'Local State'), '{"os_crypt":{}}')
    writeFileSync(join(prof, 'Default', 'Cache', 'big'), randomBytes(1000))
    writeFileSync(join(prof, 'Default', 'Local Storage', 'leveldb', '000003.log'), 'kv')
    writeFileSync(join(prof, 'Default', 'Local Storage', 'leveldb', 'LOCK'), '')
    writeFileSync(join(prof, 'SingletonLock'), '')
    const big = randomBytes(70 * 1024 * 1024 + 123) // over the in-memory limit → streamed path
    writeFileSync(join(prof, 'Default', 'History'), big)

    const out = join(root, 'Cubby-backup-test.cubbybak')
    const w = createArchive(out, 'correct horse')
    await w.addBuffer('manifest.json', Buffer.from('{"version":1}'))
    await w.addDir('profiles/ff', prof, skipProfilePath)
    expect(await w.addFile('missing.bin', join(root, 'nope'))).toBe(false)
    const { files } = await w.finish()
    expect(files).toBe(4)
    expect(w.warnings.some((x) => x.includes('missing.bin'))).toBe(true)
    expect(existsSync(out + '.partial')).toBe(false)
    expect(readFileSync(out).subarray(0, 8).toString()).toBe('CUBBYEN1')

    const dest = join(root, 'dest')
    await extractArchive(out, 'correct horse', dest)
    expect(readFileSync(join(dest, 'manifest.json'), 'utf8')).toBe('{"version":1}')
    expect(readFileSync(join(dest, 'profiles/ff/Local State'), 'utf8')).toBe('{"os_crypt":{}}')
    expect(readFileSync(join(dest, 'profiles/ff/Default/Local Storage/leveldb/000003.log'), 'utf8')).toBe('kv')
    expect(readFileSync(join(dest, 'profiles/ff/Default/History')).equals(big)).toBe(true)
    expect(existsSync(join(dest, 'profiles/ff/Default/Cache'))).toBe(false)
    expect(existsSync(join(dest, 'profiles/ff/SingletonLock'))).toBe(false)
    expect(existsSync(join(dest, 'profiles/ff/Default/Local Storage/leveldb/LOCK'))).toBe(false)
  }, 60_000)

  it('wrong passphrase → UserError', async () => {
    const out = join(root, 'small.cubbybak')
    const w = createArchive(out, 'right one')
    await w.addBuffer('a.txt', Buffer.from('hello '.repeat(1000)))
    await w.finish()
    const err = await extractArchive(out, 'wrong one', join(root, 'bad')).catch((e) => e)
    expect(err).toBeInstanceOf(UserError)
    expect(err.message).toMatch(/Wrong passphrase/)
  })

  it('not an archive → UserError', async () => {
    const f = join(root, 'junk.cubbybak')
    writeFileSync(f, randomBytes(4096))
    const err = await extractArchive(f, 'x', join(root, 'junk')).catch((e) => e)
    expect(err).toBeInstanceOf(UserError)
    expect(statSync(f).size).toBe(4096)
  })
})
