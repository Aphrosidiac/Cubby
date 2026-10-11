// The Cubby window and the quick switcher. Closing the main window to the tray DESTROYS it (frees the
// renderer); the main process — scheduler, Local API, MCP — keeps running.
import { app, BrowserWindow, globalShortcut, nativeTheme, screen, shell } from 'electron'
import { join } from 'node:path'
import { emit, on } from './core/events'
import { getSettings } from './core/settings'

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
  main = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 980,
    minHeight: 620,
    show: false,
    title: 'Cubby',
    backgroundColor: bg(),
    titleBarStyle: 'hidden',
    ...(process.platform === 'win32' ? { titleBarOverlay: { color: '#00000000', symbolColor: '#8b8981', height: 44 } } : {}),
    ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 18, y: 16 } } : {}),
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: true }
  })
  hardenWebContents(main)
  main.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) main?.show()
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
  if (process.platform === 'win32' && main && !main.isDestroyed()) main.setTitleBarOverlay({ color: '#00000000', symbolColor, height: 44 })
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
