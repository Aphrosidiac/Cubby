// Seed a brand from an existing Chrome profile on this machine (PLAN §6.2, decision L4): copy the
// profile folder (minus caches) into <brand>/Default and carry the source's os_crypt block into the
// brand's Local State — the cookie/password encryption key. Works only for the same OS user + Chrome.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { UserError } from '../../core/errors'
import { readJsonFile, writeJsonFile } from './prefs'

/** Folder names (relative to the profile dir) that are caches and are not worth copying. */
const SKIP_EXACT = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'GrShaderCache', 'GraphiteDawnCache', 'ShaderCache', 'Crashpad', 'component_crx_cache', 'Service Worker/CacheStorage', 'Service Worker/ScriptCache'])
const SKIP_FILES = new Set(['LOCK', 'lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort'])

export function shouldSkip(rel: string): boolean {
  const r = rel.replace(/\\/g, '/')
  if (SKIP_EXACT.has(r)) return true
  const top = r.split('/')[0]
  if (top.startsWith('optimization_guide_')) return true
  return SKIP_FILES.has(basename(r))
}

function busy(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException)?.code
  return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES'
}

const CLOSE_CHROME = 'Close Google Chrome completely (check the tray for a background Chrome), then import again'

function copyTree(src: string, dst: string, rel = ''): number {
  let n = 0
  mkdirSync(dst, { recursive: true })
  for (const e of readdirSync(src, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (shouldSkip(r)) continue
    const s = join(src, e.name)
    const d = join(dst, e.name)
    if (e.isDirectory()) n += copyTree(s, d, r)
    else if (e.isFile()) {
      try {
        copyFileSync(s, d)
        n++
      } catch (err) {
        if (busy(err)) throw new UserError(CLOSE_CHROME)
        throw err
      }
    }
  }
  return n
}

/** Copy `sourceProfilePath` (e.g. ".../User Data/Profile 1") into `<targetProfileDir>/Default`. */
export async function importChromeProfile(sourceProfilePath: string, targetProfileDir: string): Promise<void> {
  if (!existsSync(sourceProfilePath) || !statSync(sourceProfilePath).isDirectory()) throw new UserError('That Chrome profile folder was not found')
  const userData = dirname(sourceProfilePath)
  const srcLocalState = join(userData, 'Local State')
  if (!existsSync(srcLocalState)) throw new UserError('That folder is not inside a Chrome "User Data" folder (no Local State next to it)')
  const target = join(targetProfileDir, 'Default')
  if (existsSync(join(target, 'Cookies')) || existsSync(join(target, 'Network', 'Cookies'))) throw new UserError('This brand already has its own browser data — import into a new brand instead')
  // a running Chrome holds Cookies / History open (EBUSY on Windows) → the person gets CLOSE_CHROME
  try {
    copyTree(sourceProfilePath, target)
  } catch (e) {
    if (e instanceof UserError) throw e
    if (busy(e)) throw new UserError(CLOSE_CHROME)
    throw new UserError(`Could not copy the Chrome profile: ${e instanceof Error ? e.message : e}`)
  }
  const src = readJsonFile(srcLocalState)
  const lf = join(targetProfileDir, 'Local State')
  const ls = readJsonFile(lf)
  if (src.os_crypt) ls.os_crypt = src.os_crypt
  writeJsonFile(lf, ls)
}
