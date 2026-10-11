// Pure guardrail helpers for the browser tools (no Electron / Playwright runtime imports, unit-tested).
import { isAbsolute, normalize, resolve, sep } from 'node:path'
import { isOffLimits } from '@shared/platforms'

const WIN = process.platform === 'win32'

/** Absolute, normalised, case-folded on Windows — the form paths are compared in. */
export function normPath(p: string, win = WIN): string {
  let out = normalize(resolve(p))
  if (out.length > 1 && (out.endsWith(sep) || out.endsWith('/'))) out = out.slice(0, -1)
  return win ? out.toLowerCase() : out
}

export function isInside(child: string, parent: string): boolean {
  if (child === parent) return true
  const p = parent.endsWith(sep) || parent.endsWith('/') ? parent : parent + sep
  return child.startsWith(p)
}

export interface UploadAllowList {
  /** normalised paths of indexed media files */
  mediaPaths: Set<string>
  /** normalised watch-folder paths */
  folders: string[]
}

/**
 * Split requested upload paths into allowed and refused. A path is allowed only when it (after
 * resolving symlinks with `real`) is an indexed media file or sits inside a watch folder — so Claude
 * cannot upload arbitrary local files to a website.
 */
export function checkUploadPaths(paths: string[], allow: UploadAllowList, real: (p: string) => string = (p) => p, win = WIN): { ok: string[]; bad: string[] } {
  const ok: string[] = []
  const bad: string[] = []
  for (const raw of paths) {
    if (!raw || !isAbsolute(raw)) {
      bad.push(raw)
      continue
    }
    let resolved: string
    try {
      resolved = normPath(real(raw), win)
    } catch {
      bad.push(raw)
      continue
    }
    const given = normPath(raw, win)
    const allowed = (p: string) => allow.mediaPaths.has(p) || allow.folders.some((f) => isInside(p, f))
    // both the path as given and its real target must be allowed (a symlink inside a watch folder
    // pointing elsewhere is refused)
    if (allowed(given) && allowed(resolved)) ok.push(raw)
    else bad.push(raw)
  }
  return { ok, bad }
}

export interface FieldInfo {
  tag: string
  type?: string | null
  autocomplete?: string | null
  name?: string | null
  id?: string | null
}

/** Runs inside the page (serialised by Playwright) — must stay self-contained. */
export const describeField = (el: Element): FieldInfo => ({
  tag: el.tagName,
  type: el.getAttribute('type'),
  autocomplete: el.getAttribute('autocomplete'),
  name: el.getAttribute('name'),
  id: el.getAttribute('id')
})

const SECRET_AUTOCOMPLETE = ['current-password', 'new-password', 'one-time-code']

/** Password, 2FA / one-time-code fields — Claude never types into these. */
export function isSecretField(f: FieldInfo | null | undefined): boolean {
  if (!f) return false
  const tag = (f.tag || '').toLowerCase()
  if (tag !== 'input' && tag !== 'textarea') return false
  if ((f.type || '').toLowerCase() === 'password') return true
  const ac = (f.autocomplete || '').toLowerCase().split(/\s+/)
  if (ac.some((t) => SECRET_AUTOCOMPLETE.includes(t))) return true
  const hint = `${f.name ?? ''} ${f.id ?? ''}`.toLowerCase()
  return /(^|[\s_-])(password|passwd|otp|totp|2fa|mfa|one[-_]?time[-_]?code|verification[-_]?code|security[-_]?code)($|[\s_-])/.test(hint)
}

/** Keys that would put a character into the focused field (vs. Enter, Tab, arrows, shortcuts). */
export function isTypingKey(key: string): boolean {
  const parts = key.split('+')
  const last = parts[parts.length - 1]
  const mods = parts.slice(0, -1).map((m) => m.toLowerCase())
  if (mods.some((m) => ['control', 'meta', 'alt', 'controlormeta'].includes(m))) return /^v$/i.test(last) // paste
  return last.length === 1 || /^(Digit\d|Key[A-Z]|Numpad\d|Space)$/.test(last)
}

/**
 * Pages Claude / API tokens may open: http(s) only (no file:, chrome:, javascript:, data:), and not
 * on the off-limits list. Returns the normalised URL or a reason it was refused.
 */
export function checkUrl(input: string): { url: string } | { refused: string } {
  let s = input.trim()
  if (s === 'about:blank') return { url: s }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(javascript|data|about|mailto|file|blob|view-source|chrome|chrome-extension|devtools|edge|vbscript):/i.test(s)
  if (!hasScheme) s = (/^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(s) ? 'http://' : 'https://') + s
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return { refused: `"${input}" is not a valid web address` }
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { refused: `only http(s) pages can be opened (got ${u.protocol})` }
  if (isOffLimits(u.href)) return { refused: `${u.href} is an off-limits page (account settings, security, passwords, 2FA, billing or deactivation)` }
  return { url: u.href }
}

/** Shorten a long text at a line boundary and say so. */
export function truncate(s: string, max: number, what = 'output'): string {
  if (s.length <= max) return s
  const cut = s.lastIndexOf('\n', max)
  const at = cut > max * 0.8 ? cut : max
  return s.slice(0, at) + `\n… [${what} truncated: ${s.length - at} more characters]`
}

/** Accept "e12", "ref=e12" or "[ref=e12]" from Claude. */
export function cleanRef(ref: string): string {
  return ref.trim().replace(/^\[/, '').replace(/\]$/, '').replace(/^ref=/, '').replace(/^aria-ref=/, '')
}
