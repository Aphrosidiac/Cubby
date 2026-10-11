// The Cubby window and the quick switcher. Closing the main window to the tray DESTROYS it (frees the
// renderer); the main process — scheduler, Local API, MCP — keeps running.
import { app, BrowserWindow, clipboard, globalShortcut, Menu, nativeImage, nativeTheme, screen, shell, type MenuItemConstructorOptions } from 'electron'
import { join } from 'node:path'
import { db } from './core/db'
import { emit, on } from './core/events'
import { appIconPath, resourcePath } from './core/resources'
import { getSettings } from './core/settings'

/** Matches --topbar in the renderer so the Windows caption buttons sit centred in the top bar. */
const TITLEBAR_H = 56

let main: BrowserWindow | null = null
let switcher: BrowserWindow | null = null
let pendingPath: string | null = null

const isDev = !app.isPackaged && !!process.env['ELECTRON_RENDERER_URL']
const preload = join(__dirname, '../preload/index.js')

function load(win: BrowserWindow, route: string): void {
  if (isDev) win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${route}`)
  else win.loadFile(join(__dirname, '../renderer/index.html'), { hash: route })
}

function bg(): string {
  const t = getSettings().theme
  const dark = t === 'dark' || (t === 'system' && nativeTheme.shouldUseDarkColors)
  return dark ? '#0b0b0a' : '#f3efe4'
}

// ── window size/position memory ─────────────────────────────────────────────
interface SavedBounds { x: number; y: number; width: number; height: number; maximized: boolean }
const BOUNDS_KEY = 'window.main'

function savedBounds(): SavedBounds | null {
  try {
    const v = db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', BOUNDS_KEY)?.value
    const b = v ? (JSON.parse(v) as SavedBounds) : null
    if (!b) return null
    // only reuse it if it is still on a connected display
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea
      return b.x + 80 < a.x + a.width && b.x + b.width - 80 > a.x && b.y >= a.y - 8 && b.y + 40 < a.y + a.height
    })
    return visible ? b : null
  } catch {
    return null
  }
}

function rememberBounds(win: BrowserWindow): void {
  let t: NodeJS.Timeout | null = null
  const save = () => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
    const b = win.getNormalBounds()
    const v = JSON.stringify({ ...b, maximized: win.isMaximized() })
    db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', BOUNDS_KEY, v)
  }
  const later = () => {
    if (t) clearTimeout(t)
    t = setTimeout(save, 400)
  }
  win.on('resize', later)
  win.on('move', later)
  win.on('maximize', save)
  win.on('unmaximize', save)
  win.on('close', save)
}

// ── right-click menu (Electron has none by default) ─────────────────────────
function contextMenu(win: BrowserWindow): void {
  win.webContents.on('context-menu', (_e, p) => {
    const items: MenuItemConstructorOptions[] = []
    if (p.isEditable) {
      for (const w of p.dictionarySuggestions.slice(0, 5)) items.push({ label: w, click: () => win.webContents.replaceMisspelling(w) })
      if (p.misspelledWord) {
        items.push({ label: 'Add to dictionary', click: () => win.webContents.session.addWordToSpellCheckerDictionary(p.misspelledWord) })
        items.push({ type: 'separator' })
      }
      items.push(
        { role: 'undo', enabled: p.editFlags.canUndo },
        { role: 'redo', enabled: p.editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: p.editFlags.canCut },
        { role: 'copy', enabled: p.editFlags.canCopy },
        { role: 'paste', enabled: p.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: p.editFlags.canSelectAll }
      )
    } else {
      if (p.selectionText.trim()) items.push({ role: 'copy' })
      if (p.linkURL && /^https?:/.test(p.linkURL)) {
        items.push({ label: 'Open link in browser', click: () => void shell.openExternal(p.linkURL) }, { label: 'Copy link', click: () => clipboard.writeText(p.linkURL) })
      }
      if (p.mediaType === 'image' && p.srcURL) items.push({ label: 'Copy image', click: () => win.webContents.copyImageAt(p.x, p.y) })
    }
    if (!app.isPackaged) items.push({ type: 'separator' }, { label: 'Inspect element', click: () => win.webContents.inspectElement(p.x, p.y) })
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win })
  })
}

// ── taskbar / dock badge for posts waiting in Approvals ─────────────────────
let badgeCount = 0
export function setApprovalsBadge(n: number): void {
  badgeCount = n
  if (process.platform === 'darwin') {
    app.dock?.setBadge(n ? String(n) : '')
    return
  }
  if (process.platform !== 'win32' || !main || main.isDestroyed()) return
  if (!n) {
    main.setOverlayIcon(null, '')
    return
  }
  const name = n > 9 ? '9plus' : String(n)
  main.setOverlayIcon(nativeImage.createFromPath(resourcePath('badges', `${name}.png`)), `${n} post${n === 1 ? '' : 's'} waiting for approval`)
}

function hardenWebContents(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:') && !(isDev && url.startsWith(process.env['ELECTRON_RENDERER_URL']!))) e.preventDefault()
  })
}

export function showMainWindow(path?: string): BrowserWindow {
  if (main && !main.isDestroyed()) {
    if (main.isMinimized()) main.restore()
    main.show()
    main.focus()
    if (path) emit('navigate', { path })
    return main
  }
  pendingPath = path ?? null
  const saved = savedBounds()
  main = new BrowserWindow({
    width: saved?.width ?? 1380,
    height: saved?.height ?? 880,
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    minWidth: 980,
    minHeight: 620,
    show: false,
    title: 'Cubby',
    backgroundColor: bg(),
    titleBarStyle: 'hidden',
    ...(process.platform === 'win32' ? { titleBarOverlay: { color: '#00000000', symbolColor: '#8b8981', height: TITLEBAR_H } } : {}),
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 18, y: 16 } } : {}),
    icon: appIconPath(),
    webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: true }
  })
  hardenWebContents(main)
  contextMenu(main)
  rememberBounds(main)
  main.once('ready-to-show', () => {
    if (saved?.maximized) main?.maximize()
    if (!process.argv.includes('--hidden')) main?.show()
    setApprovalsBadge(badgeCount)
  })
  main.webContents.once('did-finish-load', () => {
    if (pendingPath) emit('navigate', { path: pendingPath })
    pendingPath = null
  })
  main.on('closed', () => {
    main = null
  })
  load(main, '/')
  return main
}

export function setTitleBarColors(symbolColor: string): void {
  if (process.platform === 'win32' && main && !main.isDestroyed()) main.setTitleBarOverlay({ color: '#00000000', symbolColor, height: TITLEBAR_H })
}

export function toggleSwitcher(): void {
  if (switcher && !switcher.isDestroyed()) {
    switcher.destroy()
    switcher = null
    return
  }
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const w = 600
  const h = 440
  switcher = new BrowserWindow({
    width: w,
    height: h,
    x: Math.round(d.workArea.x + (d.workArea.width - w) / 2),
    y: Math.round(d.workArea.y + d.workArea.height * 0.2),
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { preload, sandbox: true, contextIsolation: true }
  })
  hardenWebContents(switcher)
  contextMenu(switcher)
  switcher.once('ready-to-show', () => {
    switcher?.show()
    switcher?.focus()
  })
  switcher.on('blur', () => closeSwitcher())
  switcher.on('closed', () => {
    switcher = null
  })
  load(switcher, '/switcher')
}

export function closeSwitcher(): void {
  if (switcher && !switcher.isDestroyed()) switcher.destroy()
  switcher = null
}

let hotkey: string | null = null
export function registerHotkey(): void {
  const want = getSettings().quickSwitchHotkey
  if (hotkey === want) return
  if (hotkey) globalShortcut.unregister(hotkey)
  hotkey = null
  if (!want) return
  try {
    if (globalShortcut.register(want, toggleSwitcher)) hotkey = want
    else console.warn('hotkey taken:', want)
  } catch (e) {
    console.warn('bad hotkey', want, e)
  }
}

export function watchHotkeySetting(): void {
  on('settings.changed', () => registerHotkey())
}
