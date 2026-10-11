import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { chromeCandidates, chromeVersion, compareVersions, findChrome, parseExtensions, parseProfiles, pickVersionFolder, readExtensions } from './chrome'

const tmp = mkdtempSync(join(tmpdir(), 'cubby-chrome-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('chrome detection', () => {
  it('lists the Windows install locations in order', () => {
    const c = chromeCandidates('win32', { ProgramFiles: 'C:\\PF', 'ProgramFiles(x86)': 'C:\\PF86', LOCALAPPDATA: 'C:\\LA' })
    expect(c).toEqual([join('C:\\PF', 'Google', 'Chrome', 'Application', 'chrome.exe'), join('C:\\PF86', 'Google', 'Chrome', 'Application', 'chrome.exe'), join('C:\\LA', 'Google', 'Chrome', 'Application', 'chrome.exe')])
    expect(chromeCandidates('darwin', {})[0]).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  })

  it('compares versions numerically and picks the highest version folder', () => {
    expect(compareVersions('154.0.8037.98', '99.0.1.1')).toBeGreaterThan(0)
    expect(compareVersions('154.0.8037.98', '154.0.8037.100')).toBeLessThan(0)
    expect(pickVersionFolder(['SetupMetrics', '153.0.7000.1', '154.0.8037.98', 'chrome.exe', '154.0.800.200'])).toBe('154.0.8037.98')
    expect(pickVersionFolder(['chrome.exe'])).toBeNull()
  })

  it('reads the version from the folder next to chrome.exe (Windows layout)', () => {
    const app = join(tmp, 'win', 'Application')
    mkdirSync(join(app, '120.0.1.2'), { recursive: true })
    mkdirSync(join(app, '121.0.0.9'), { recursive: true })
    writeFileSync(join(app, 'chrome.exe'), '')
    expect(chromeVersion(join(app, 'chrome.exe'), 'win32')).toBe('121.0.0.9')
    // the explicit override wins when it exists
    expect(findChrome(join(app, 'chrome.exe'), 'win32', {})).toEqual({ path: join(app, 'chrome.exe'), version: '121.0.0.9' })
    expect(findChrome(join(tmp, 'nope.exe'), 'win32', {})).toBeNull()
  })

  it('reads CFBundleShortVersionString on a Mac layout', () => {
    const macos = join(tmp, 'Google Chrome.app', 'Contents', 'MacOS')
    mkdirSync(macos, { recursive: true })
    writeFileSync(join(macos, 'Google Chrome'), '')
    writeFileSync(join(macos, '..', 'Info.plist'), '<plist><dict><key>CFBundleName</key><string>Chrome</string><key>CFBundleShortVersionString</key>\n\t<string>154.0.8037.98</string></dict></plist>')
    expect(chromeVersion(join(macos, 'Google Chrome'), 'darwin')).toBe('154.0.8037.98')
  })

  it('finds the real Chrome on this machine when installed', () => {
    const c = findChrome()
    if (!c) return
    expect(c.version).toMatch(/^\d+\.\d+\.\d+\.\d+$/)
  })
})

describe('chrome profiles', () => {
  it('parses Local State info_cache, Default first', () => {
    const ls = { profile: { info_cache: { 'Profile 2': { name: 'Work', user_name: 'me@work.com' }, Default: { name: 'Person 1', user_name: '' }, 'Profile 10': { name: 'X' } } } }
    const out = parseProfiles(ls, 'C:\\UD')
    expect(out.map((p) => p.dir)).toEqual(['Default', 'Profile 2', 'Profile 10'])
    expect(out[1]).toEqual({ dir: 'Profile 2', name: 'Work', path: join('C:\\UD', 'Profile 2'), email: 'me@work.com' })
    expect(out[0].email).toBeNull()
    expect(parseProfiles({}, 'x')).toEqual([])
  })
})

describe('extensions', () => {
  it('skips component extensions and reads enabled state', () => {
    const prefs = {
      extensions: {
        settings: {
          comp: { location: 5, manifest: { name: 'Component', version: '1' } },
          ext10: { location: 10, manifest: { name: 'Ext component', version: '1' } },
          a: { location: 1, state: 1, manifest: { name: 'Alpha', version: '2.0' } },
          b: { location: 1, state: 0, manifest: { name: 'Beta', version: '1.1' } },
          noname: { location: 1 }
        }
      }
    }
    const secure = { extensions: { settings: { c: { location: 1, disable_reasons: [1], manifest: { name: 'Gamma', version: '3' } }, d: { location: 1, disable_reasons: [], manifest: { name: 'Delta', version: '4' } } } } }
    expect(parseExtensions(prefs, secure)).toEqual([
      { id: 'a', name: 'Alpha', version: '2.0', enabled: true },
      { id: 'b', name: 'Beta', version: '1.1', enabled: false },
      { id: 'd', name: 'Delta', version: '4', enabled: true },
      { id: 'c', name: 'Gamma', version: '3', enabled: false }
    ])
  })

  it('falls back to the manifest on disk, resolving __MSG_ names', () => {
    const prof = join(tmp, 'brand')
    const def = join(prof, 'Default')
    const ext = join(def, 'Extensions', 'abc', '1.2.3_0')
    mkdirSync(join(ext, '_locales', 'en'), { recursive: true })
    writeFileSync(join(ext, 'manifest.json'), JSON.stringify({ name: '__MSG_appName__', version: '1.2.3', default_locale: 'en' }))
    writeFileSync(join(ext, '_locales', 'en', 'messages.json'), JSON.stringify({ appName: { message: 'Grammar Helper' } }))
    writeFileSync(join(def, 'Preferences'), JSON.stringify({ extensions: { settings: { abc: { location: 1, path: 'abc\\1.2.3_0' } } } }))
    writeFileSync(join(def, 'Secure Preferences'), JSON.stringify({ extensions: { settings: { abc: { disable_reasons: 0 } } } }))
    expect(readExtensions(prof)).toEqual([{ id: 'abc', name: 'Grammar Helper', version: '1.2.3', enabled: true }])
  })

  it('returns [] for a profile that never ran', () => {
    expect(readExtensions(join(tmp, 'empty'))).toEqual([])
  })
})
