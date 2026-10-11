import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { parseDevToolsActivePort } from './devtools'
import { shouldSkip } from './importProfile'
import { hexToArgbInt, mergeLocalState, mergePreferences, writeBrandPrefs } from './prefs'

const tmp = mkdtempSync(join(tmpdir(), 'cubby-prefs-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('Preferences', () => {
  it('converts a hex colour to Chrome signed ARGB', () => {
    expect(hexToArgbInt('#2c4f9c')).toBe((0xff2c4f9c | 0))
    expect(hexToArgbInt('#2c4f9c')).toBeLessThan(0)
    expect(hexToArgbInt('#000000')).toBe(-16777216)
    expect(hexToArgbInt('ffffff')).toBe(-1)
    expect(hexToArgbInt('red')).toBeNull()
  })

  it('merges into existing prefs without dropping what Chrome wrote', () => {
    const existing = { browser: { window_placement: { left: 10 }, theme: { other: 1 } }, profile: { content_settings: { a: 1 }, name: 'Old' }, extensions: { settings: { x: {} } }, download: 'weird' }
    const out = mergePreferences(existing, { name: 'FF', color: '#1d6b45', downloadsDir: 'D:\\dl' })
    expect(out.browser).toMatchObject({ window_placement: { left: 10 }, theme: { other: 1, user_color2: 0xff1d6b45 | 0, user_color: 0xff1d6b45 | 0, color_variant2: 1 }, has_seen_welcome_page: true })
    expect(out.profile).toMatchObject({ content_settings: { a: 1 }, name: 'FF', password_manager_enabled: false, exit_type: 'Normal' })
    expect(out.extensions).toEqual({ settings: { x: {} } })
    expect(out.session).toEqual({ restore_on_startup: 1 })
    expect(out.download).toEqual({ default_directory: 'D:\\dl', prompt_for_download: false })
    expect(out.credentials_enable_service).toBe(false)
  })

  it('leaves downloads alone when no folder is set', () => {
    const out = mergePreferences({}, { name: 'A', color: 'nope' })
    expect(out.download).toBeUndefined()
    expect((out.browser as Record<string, unknown>).theme).toBeUndefined()
  })

  it('names the profile in Local State and keeps os_crypt', () => {
    const ls = mergeLocalState({ os_crypt: { encrypted_key: 'k' }, profile: { info_cache: { Default: { avatar_icon: 'x' } } } }, { name: 'Ascend', color: '#000000' })
    expect(ls).toEqual({ os_crypt: { encrypted_key: 'k' }, profile: { info_cache: { Default: { avatar_icon: 'x', name: 'Ascend', is_using_default_name: false } } } })
  })

  it('writes Default/Preferences and Local State, creating Default/ when missing', () => {
    const prof = join(tmp, 'p1')
    writeBrandPrefs(prof, { name: 'FF', color: '#0b0b0a' })
    const prefs = JSON.parse(readFileSync(join(prof, 'Default', 'Preferences'), 'utf8'))
    expect(prefs.profile.name).toBe('FF')
    expect(JSON.parse(readFileSync(join(prof, 'Local State'), 'utf8')).profile.info_cache.Default.name).toBe('FF')
    // merge on a second write; a corrupt file is replaced rather than crashing the launch
    const prof2 = join(tmp, 'p2')
    mkdirSync(join(prof2, 'Default'), { recursive: true })
    writeFileSync(join(prof2, 'Default', 'Preferences'), '{not json')
    writeBrandPrefs(prof2, { name: 'B', color: '#ffffff' })
    expect(JSON.parse(readFileSync(join(prof2, 'Default', 'Preferences'), 'utf8')).browser.theme.user_color2).toBe(-1)
    expect(existsSync(join(prof2, 'Default', 'Preferences.cubby-tmp'))).toBe(false)
  })
})

describe('DevToolsActivePort', () => {
  it('parses port + browser path', () => {
    expect(parseDevToolsActivePort('53211\n/devtools/browser/0d6f-aa\n')).toEqual({ port: 53211, wsPath: '/devtools/browser/0d6f-aa' })
    expect(parseDevToolsActivePort('53211\r\n/devtools/browser/x')).toEqual({ port: 53211, wsPath: '/devtools/browser/x' })
  })
  it('rejects half-written or junk files', () => {
    expect(parseDevToolsActivePort('')).toBeNull()
    expect(parseDevToolsActivePort('53211')).toBeNull()
    expect(parseDevToolsActivePort('abc\n/devtools/browser/x')).toBeNull()
    expect(parseDevToolsActivePort('70000\n/devtools/browser/x')).toBeNull()
    expect(parseDevToolsActivePort('9222\n/json')).toBeNull()
  })
})

describe('profile import skip list', () => {
  it('skips caches and locks, keeps data', () => {
    for (const p of ['Cache', 'Code Cache', 'GPUCache', 'Service Worker/CacheStorage', 'Service Worker\\ScriptCache', 'optimization_guide_model_store', 'LOCK', 'Network/LOCK']) expect(shouldSkip(p)).toBe(true)
    for (const p of ['Cookies', 'Network/Cookies', 'Local Storage', 'IndexedDB', 'Service Worker/Database', 'Preferences', 'Login Data']) expect(shouldSkip(p)).toBe(false)
  })
})
