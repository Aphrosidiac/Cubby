// app.*, settings.*, activity.* commands and the AppStatus assembly.
import { app, dialog, nativeImage, shell, BrowserWindow, safeStorage } from 'electron'
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { homedir } from 'node:os'
import { toCsv } from '@shared/csv'
import type { AppStatus, Settings } from '@shared/types'
import { mapActivity, type ActivityRow } from '../../core/activity'
import { db } from '../../core/db'
import { UserError } from '../../core/errors'
import { emit } from '../../core/events'
import { paths } from '../../core/paths'
import { sendTelegram } from '../../core/notify'
import { implement } from '../../core/registry'
import { requestStatus, runtime, setKillSwitch, setStatusEmitter } from '../../core/runtime'
import { getSecretSetting, getSettings, setSecretSetting, setSettings } from '../../core/settings'
import { chromeInfo } from '../browser'
import { liveRuns } from '../runs'
import { closeSwitcher, showMainWindow } from '../../windows'

export function buildStatus(): AppStatus {
  const s = getSettings()
  const q = (sql: string) => db.get<{ n: number }>(sql)?.n ?? 0
  return {
    version: app.getVersion(),
    platform: process.platform,
    chrome: chromeInfo(),
    dataDir: paths.root,
    apiUrl: `http://127.0.0.1:${s.apiPort}`,
    mcpUrl: `http://127.0.0.1:${s.apiPort}/mcp`,
    apiListening: runtime.apiListening,
    killSwitch: runtime.killSwitch,
    runs: liveRuns(),
    mcpClients: [...runtime.mcpClients.values()],
    approvalsCount: q("SELECT count(*) n FROM posts WHERE status = 'ready_for_approval'"),
    openBrands: q("SELECT count(*) n FROM brands WHERE status IN ('open','opening') AND deleted_at IS NULL"),
    needsRelogin: q("SELECT count(DISTINCT a.brand_id) n FROM accounts a JOIN brands b ON b.id = a.brand_id WHERE a.login_state = 'expired' AND b.deleted_at IS NULL")
  }
}

// ── unlock passphrase (Windows stand-in for Touch ID) ────────────────────────
function hashPass(p: string, salt = randomBytes(16)): string {
  return salt.toString('hex') + ':' + scryptSync(p, salt, 32).toString('hex')
}

export function verifyUnlock(passphrase: string | undefined): boolean {
  const stored = getSecretSetting('secret.unlock')
  if (!stored) return false
  if (!passphrase) return false
  const [salt, hash] = stored.split(':')
  const got = scryptSync(passphrase, Buffer.from(salt, 'hex'), 32)
  return timingSafeEqual(got, Buffer.from(hash, 'hex'))
}

/** The stored backup passphrase (scheduled backups), or null. */
export function getBackupPassphrase(): string | null {
  const v = getSecretSetting('secret.backupPassphrase')
  if (!v) return null
  try {
    return safeStorage.decryptString(Buffer.from(v, 'base64'))
  } catch {
    return null
  }
}

function mainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes('#/') && !w.webContents.getURL().includes('switcher'))
}

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico'])

function imageDataUrl(p: string, maxPx = 256): string {
  const ext = extname(p).toLowerCase()
  if (ext === '.svg') return 'data:image/svg+xml;base64,' + readFileSync(p).toString('base64')
  let img = nativeImage.createFromPath(p)
  if (img.isEmpty()) throw new UserError('Not a readable image')
  const { width, height } = img.getSize()
  if (Math.max(width, height) > maxPx) img = img.resize(width >= height ? { width: maxPx } : { height: maxPx })
  return img.toDataURL()
}

/** Logo candidates from brand kits on disk (dev folders), small files only. */
function scanBrandKits(): { name: string; path: string; dataUrl: string }[] {
  const roots = [join(homedir(), 'Desktop', 'dev'), 'C:/Dev', 'C:/dev'].filter((r, i, a) => existsSync(r) && a.indexOf(r) === i)
  const out: { name: string; path: string; dataUrl: string }[] = []
  const seen = new Set<string>()
  const walk = (dir: string, depth: number, inKit: boolean) => {
    if (out.length >= 60 || depth > 4) return
    let entries: import('node:fs').Dirent[] = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '.git') continue
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        const kit = inKit || /^(brand|brand-kit|brand-system|brandkit|logos?|marks?)$/i.test(e.name)
        if (kit || depth < 1) walk(p, depth + 1, kit)
      } else if (inKit && IMAGE_EXT.has(extname(e.name).toLowerCase()) && /(logo|mark|icon|lockup|symbol)/i.test(e.name)) {
        try {
          if (statSync(p).size > 400_000 || seen.has(e.name)) continue
          seen.add(e.name)
          out.push({ name: `${dir.split(/[\\/]/).slice(-3).join('/')}/${e.name}`, path: p, dataUrl: imageDataUrl(p, 160) })
        } catch {
          /* skip */
        }
      }
    }
  }
  for (const r of roots) walk(r, 0, false)
  return out
}

implement({
  'app.status': () => buildStatus(),
  'app.killSwitch': ({ on }) => {
    setKillSwitch(on)
    return buildStatus()
  },
  'app.openPath': async ({ path }) => {
    const err = await shell.openPath(path)
    if (err) throw new UserError(err)
  },
  'app.revealPath': ({ path }) => shell.showItemInFolder(path),
  'app.openExternal': async ({ url }) => {
    if (!/^https?:\/\//.test(url)) throw new UserError('Only web links can be opened')
    await shell.openExternal(url)
  },
  'app.pickFiles': async ({ directory, multi, filters, save, defaultPath }) => {
    const win = mainWindow()
    if (save) {
      const r = win ? await dialog.showSaveDialog(win, { defaultPath, filters }) : await dialog.showSaveDialog({ defaultPath, filters })
      return r.canceled || !r.filePath ? [] : [r.filePath]
    }
    const props: ('openFile' | 'openDirectory' | 'multiSelections')[] = [directory ? 'openDirectory' : 'openFile']
    if (multi) props.push('multiSelections')
    const r = win ? await dialog.showOpenDialog(win, { properties: props, filters, defaultPath }) : await dialog.showOpenDialog({ properties: props, filters, defaultPath })
    return r.canceled ? [] : r.filePaths
  },
  'app.readImageDataUrl': ({ path, maxPx }) => imageDataUrl(path, maxPx ?? 256),
  'app.brandKits': () => scanBrandKits(),
  'app.showInMain': ({ path }) => {
    showMainWindow(path)
    closeSwitcher()
  },

  'settings.get': () => getSettings(),
  'settings.set': ({ patch }) => {
    const next = setSettings(patch as Partial<Settings>)
    if ('launchAtLogin' in patch) app.setLoginItemSettings({ openAtLogin: !!patch.launchAtLogin, args: ['--hidden'] })
    requestStatus()
    return next
  },
  'settings.setUnlockPassphrase': ({ passphrase, current }) => {
    if (getSecretSetting('secret.unlock') && !verifyUnlock(current)) throw new UserError('Current passphrase is wrong')
    setSecretSetting('secret.unlock', hashPass(passphrase))
    const s = getSettings()
    emit('settings.changed', s)
    return s
  },
  'settings.testTelegram': async ({ botToken, chatId }) => {
    const s = getSettings().notifications
    const tok = (botToken ?? s.telegramBotToken ?? '').trim()
    const chat = (chatId ?? s.telegramChatId ?? '').trim()
    if (!tok || !chat) throw new UserError('Add the bot token and chat id first')
    try {
      return await sendTelegram(tok, chat, 'Cubby test message — notifications will arrive in this chat.')
    } catch (e) {
      throw new UserError((e as Error).message)
    }
  },
  'settings.setBackupPassphrase': ({ passphrase }) => {
    if (!safeStorage.isEncryptionAvailable()) throw new UserError('OS encryption is not available')
    setSecretSetting('secret.backupPassphrase', safeStorage.encryptString(passphrase).toString('base64'))
    const s = getSettings()
    emit('settings.changed', s)
    return s
  },

  'activity.list': ({ brandId, actor, action, q, limit, before }) => {
    const { where, vals } = activityWhere({ brandId, actor, action, q })
    if (before) { where.push('a.id < ?'); vals.push(before) }
    return db
      .all<ActivityRow>(
        `SELECT a.*, b.name brand_name FROM activity a LEFT JOIN brands b ON b.id = a.brand_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.id DESC LIMIT ?`,
        ...vals,
        limit ?? 200
      )
      .map(mapActivity)
  },
  // exports exactly what the Activity screen shows: the same four filters
  'activity.exportCsv': ({ brandId, actor, action, q, path }) => {
    const { where, vals } = activityWhere({ brandId, actor, action, q })
    const rows = db.all<ActivityRow>(`SELECT a.*, b.name brand_name FROM activity a LEFT JOIN brands b ON b.id = a.brand_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.id`, ...vals)
    const file = path ?? join(paths.exports, `activity-${new Date().toISOString().slice(0, 10)}.csv`)
    writeFileSync(file, toCsv([['time', 'actor', 'brand', 'action', 'detail', 'screenshot'], ...rows.map((r) => [r.at, r.actor, r.brand_name ?? '', r.action, r.detail, r.screen ?? ''])]))
    return { path: file, count: rows.length }
  }
})

/** WHERE clause shared by activity.list and activity.exportCsv. `action` is a prefix (or a * pattern). */
function activityWhere(f: { brandId?: string; actor?: string; action?: string; q?: string }): { where: string[]; vals: (string | number)[] } {
  const where: string[] = []
  const vals: (string | number)[] = []
  if (f.brandId) { where.push('a.brand_id = ?'); vals.push(f.brandId) }
  if (f.actor) { where.push('a.actor = ?'); vals.push(f.actor) }
  if (f.action) { where.push('a.action LIKE ?'); vals.push(f.action.replace(/\*/g, '%') + (f.action.includes('*') ? '' : '%')) }
  if (f.q) { where.push('(a.action LIKE ? OR a.detail LIKE ? OR b.name LIKE ?)'); vals.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`) }
  return { where, vals }
}

export function start(): void {
  setStatusEmitter(() => emit('app.status', buildStatus()))
}
export async function stop(): Promise<void> {}
