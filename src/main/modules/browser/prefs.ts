// Per-brand Chrome settings written into the profile's Preferences / Local State before launch
// (PLAN §5): theme colour, profile name, session restore, downloads folder, password manager off.
// Always a merge into whatever Chrome already wrote — never a replacement. Electron-free.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface BrandPrefs {
  name: string
  color: string
  downloadsDir?: string | null
}

type Json = Record<string, unknown>

/** "#2c4f9c" → signed 32-bit ARGB int (0xFF2C4F9C → -13873252), how Chrome stores user_color. */
export function hexToArgbInt(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  return (0xff000000 | parseInt(m[1], 16)) | 0
}

/** Set obj[a][b][c] = v, creating objects on the way (replacing non-objects). */
export function setPath(obj: Json, path: string[], v: unknown): void {
  let cur = obj
  for (const k of path.slice(0, -1)) {
    const next = cur[k]
    if (!next || typeof next !== 'object' || Array.isArray(next)) cur[k] = {}
    cur = cur[k] as Json
  }
  cur[path[path.length - 1]] = v
}

/** Apply the brand's settings onto an existing Preferences object (returns the same object). Pure. */
export function mergePreferences(prefs: Json, b: BrandPrefs): Json {
  const argb = hexToArgbInt(b.color)
  if (argb != null) {
    setPath(prefs, ['browser', 'theme', 'user_color2'], argb)
    setPath(prefs, ['browser', 'theme', 'user_color'], argb)
    setPath(prefs, ['browser', 'theme', 'color_variant2'], 1)
  }
  setPath(prefs, ['profile', 'name'], b.name)
  setPath(prefs, ['session', 'restore_on_startup'], 1)
  if (b.downloadsDir) {
    setPath(prefs, ['download', 'default_directory'], b.downloadsDir)
    setPath(prefs, ['download', 'prompt_for_download'], false)
    setPath(prefs, ['savefile', 'default_directory'], b.downloadsDir)
  }
  setPath(prefs, ['credentials_enable_service'], false)
  setPath(prefs, ['profile', 'password_manager_enabled'], false)
  setPath(prefs, ['browser', 'has_seen_welcome_page'], true)
  // a killed Chrome would otherwise greet the person with "Chrome didn't shut down correctly"
  setPath(prefs, ['profile', 'exit_type'], 'Normal')
  setPath(prefs, ['profile', 'exited_cleanly'], true)
  return prefs
}

/** Name the profile in Local State (what Chrome shows in its profile menu). Pure. */
export function mergeLocalState(ls: Json, b: BrandPrefs): Json {
  setPath(ls, ['profile', 'info_cache', 'Default', 'name'], b.name)
  setPath(ls, ['profile', 'info_cache', 'Default', 'is_using_default_name'], false)
  return ls
}

export function readJsonFile(file: string): Json {
  if (!existsSync(file)) return {}
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'))
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {}
  } catch {
    return {}
  }
}

/** Write JSON via a temp file + rename so a crash never leaves Chrome a half-written file. */
export function writeJsonFile(file: string, v: unknown): void {
  const tmp = file + '.cubby-tmp'
  writeFileSync(tmp, JSON.stringify(v))
  renameSync(tmp, file)
}

/** Write Preferences + Local State for a brand profile. Caller guarantees Chrome is not running on it. */
export function writeBrandPrefs(profileDir: string, b: BrandPrefs): void {
  const def = join(profileDir, 'Default')
  mkdirSync(def, { recursive: true })
  const pf = join(def, 'Preferences')
  writeJsonFile(pf, mergePreferences(readJsonFile(pf), b))
  const lf = join(profileDir, 'Local State')
  writeJsonFile(lf, mergeLocalState(readJsonFile(lf), b))
}
