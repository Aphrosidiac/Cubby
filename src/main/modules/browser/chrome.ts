// Finding Google Chrome, reading its version, listing the person's own Chrome profiles and a brand's
// extensions. Electron-free (plain fs) so it is unit-tested; the db-backed Settings override is
// passed in by the caller.
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ChromeProfileInfo, ExtensionInfo } from '@shared/types'

export interface ChromeInstall {
  path: string
  version: string
}

type Env = Record<string, string | undefined>

/** Standard install locations for this OS, most likely first. */
export function chromeCandidates(platform: NodeJS.Platform = process.platform, env: Env = process.env): string[] {
  if (platform === 'win32') {
    const rel = join('Google', 'Chrome', 'Application', 'chrome.exe')
    return [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter((d): d is string => !!d).map((d) => join(d, rel))
  }
  if (platform === 'darwin') {
    return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', join(homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome')]
  }
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome']
}

/** Compare dotted versions numerically ("154.0.8037.98" > "99.1"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n) || 0)
  const pb = b.split('.').map((n) => Number(n) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}

/** Highest version-named folder (e.g. "154.0.8037.98") among a directory listing. */
export function pickVersionFolder(names: string[]): string | null {
  const v = names.filter((n) => /^\d+(\.\d+){2,3}$/.test(n)).sort(compareVersions)
  return v.length ? v[v.length - 1] : null
}

/** Chrome version for an executable path. Windows: version folder beside chrome.exe; Mac: Info.plist. */
export function chromeVersion(exe: string, platform: NodeJS.Platform = process.platform): string {
  try {
    if (platform === 'win32') {
      const v = pickVersionFolder(readdirSync(dirname(exe)))
      if (v) return v
    } else if (platform === 'darwin') {
      const plist = join(exe, '..', '..', 'Info.plist')
      if (existsSync(plist)) {
        const m = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(readFileSync(plist, 'utf8'))
        if (m) return m[1].trim()
      }
    }
    if (platform !== 'win32') {
      const out = execFileSync(exe, ['--version'], { encoding: 'utf8', timeout: 5000 })
      const m = /(\d+(\.\d+){2,3})/.exec(out)
      if (m) return m[1]
    }
  } catch {
    /* fall through */
  }
  return 'unknown'
}

/** First existing Chrome: the explicit override (if it exists), else the standard locations. */
export function findChrome(override?: string | null, platform: NodeJS.Platform = process.platform, env: Env = process.env): ChromeInstall | null {
  const list = override ? [override, ...chromeCandidates(platform, env)] : chromeCandidates(platform, env)
  for (const p of list) {
    if (p && existsSync(p)) return { path: p, version: chromeVersion(p, platform) }
  }
  return null
}

/** The person's own Chrome "User Data" folder. */
export function chromeUserDataDir(platform: NodeJS.Platform = process.platform, env: Env = process.env): string {
  if (platform === 'win32') return join(env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Google', 'Chrome', 'User Data')
  if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome')
  return join(homedir(), '.config', 'google-chrome')
}

/** Profiles from a parsed "Local State" (profile.info_cache). Pure. */
export function parseProfiles(localState: unknown, userDataDir: string): ChromeProfileInfo[] {
  const cache = (localState as { profile?: { info_cache?: Record<string, { name?: string; user_name?: string; gaia_name?: string }> } })?.profile?.info_cache
  if (!cache || typeof cache !== 'object') return []
  return Object.entries(cache)
    .map(([dir, p]) => ({ dir, name: p?.name || p?.gaia_name || dir, path: join(userDataDir, dir), email: p?.user_name || null }))
    .sort((a, b) => (a.dir === 'Default' ? -1 : b.dir === 'Default' ? 1 : a.dir.localeCompare(b.dir, undefined, { numeric: true })))
}

/** Read-only listing of the person's Chrome profiles. Never touches anything else in that folder. */
export function listOwnChromeProfiles(userDataDir = chromeUserDataDir()): ChromeProfileInfo[] {
  try {
    const ls = JSON.parse(readFileSync(join(userDataDir, 'Local State'), 'utf8'))
    return parseProfiles(ls, userDataDir).filter((p) => existsSync(p.path))
  } catch {
    return []
  }
}

// ── extensions ───────────────────────────────────────────────────────────────

interface ExtSetting {
  location?: number
  state?: number
  disable_reasons?: number | number[]
  manifest?: { name?: string; version?: string; default_locale?: string }
  path?: string
}

const COMPONENT_LOCATIONS = new Set([5, 10])

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Manifest (name/version) from the profile's Extensions folder when Preferences no longer carries it. */
function manifestFromDisk(profileDefault: string, id: string, setting: ExtSetting): { name?: string; version?: string } | null {
  const base = join(profileDefault, 'Extensions', id)
  let dir: string | null = null
  if (setting.path && !/^[a-z]:|^\//i.test(setting.path)) dir = join(profileDefault, 'Extensions', setting.path)
  if (!dir || !existsSync(dir)) {
    // folders are "<version>_<n>"; take the highest version
    let folders: string[] = []
    try {
      folders = readdirSync(base)
    } catch {
      return null
    }
    const best = folders.sort((a, b) => compareVersions(a.replace(/_\d+$/, ''), b.replace(/_\d+$/, ''))).pop()
    if (!best) return null
    dir = join(base, best)
  }
  const m = readJson(join(dir, 'manifest.json')) as { name?: string; version?: string; default_locale?: string } | null
  if (!m) return null
  let name = m.name
  const msg = name && /^__MSG_(.+)__$/.exec(name)
  if (msg) {
    const loc = readJson(join(dir, '_locales', m.default_locale ?? 'en', 'messages.json')) as Record<string, { message?: string }> | null
    const key = Object.keys(loc ?? {}).find((k) => k.toLowerCase() === msg[1].toLowerCase())
    name = (key && loc?.[key]?.message) || name
  }
  return { name, version: m.version }
}

/** Merge extensions.settings from Preferences + Secure Preferences into a list. Pure apart from the disk fallback. */
export function parseExtensions(prefs: unknown, securePrefs: unknown, profileDefault?: string): ExtensionInfo[] {
  const pick = (o: unknown) => ((o as { extensions?: { settings?: Record<string, ExtSetting> } })?.extensions?.settings ?? {}) as Record<string, ExtSetting>
  const merged: Record<string, ExtSetting> = {}
  for (const src of [pick(prefs), pick(securePrefs)]) {
    for (const [id, s] of Object.entries(src)) merged[id] = { ...(merged[id] ?? {}), ...(s ?? {}) }
  }
  const out: ExtensionInfo[] = []
  for (const [id, s] of Object.entries(merged)) {
    if (s.location != null && COMPONENT_LOCATIONS.has(s.location)) continue
    const m = s.manifest?.name ? s.manifest : profileDefault ? manifestFromDisk(profileDefault, id, s) : null
    if (!m?.name) continue
    const reasons = s.disable_reasons
    const disabled = Array.isArray(reasons) ? reasons.length > 0 : typeof reasons === 'number' ? reasons !== 0 : s.state != null ? s.state !== 1 : false
    out.push({ id, name: m.name, version: m.version ?? '', enabled: !disabled })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** Extensions installed in a brand profile (<profileDir>/Default). */
export function readExtensions(profileDir: string): ExtensionInfo[] {
  const def = join(profileDir, 'Default')
  return parseExtensions(readJson(join(def, 'Preferences')), readJson(join(def, 'Secure Preferences')), def)
}
