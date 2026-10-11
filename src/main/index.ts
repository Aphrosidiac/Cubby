import { app, ipcMain, nativeTheme } from 'electron'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import './protocol'
import { closeDb, openDb } from './core/db'
import { on } from './core/events'
import { startLogFile } from './core/log'
import { setNotifyOpener } from './core/notify'
import { initPaths, paths } from './core/paths'
import { missingCommands } from './core/registry'
import { getSettings } from './core/settings'
import { setupIpc } from './ipc'
import { startModules, stopModules } from './modules'
import { registerFileProtocol } from './protocol'
import { createTray } from './tray'
import { buildStatus } from './modules/app'
import { closeSwitcher, registerHotkey, setApprovalsBadge, setTitleBarColors, showMainWindow, toggleSwitcher, watchHotkeySetting } from './windows'

/** What a launch asks for: a page (`--cubby-route=/compose`, Jump List), the switcher, or a .brand file to import. */
function launchIntent(argv: string[]): { route?: string; switcher?: boolean } {
  const route = argv.find((a) => a.startsWith('--cubby-route='))?.slice('--cubby-route='.length)
  if (argv.includes('--cubby-switcher')) return { switcher: true }
  const file = argv.slice(1).find((a) => /\.brand$/i.test(a) && existsSync(a))
  if (file) return { route: `/?import=${encodeURIComponent(resolve(file))}` }
  return route && route.startsWith('/') ? { route } : {}
}

function act(intent: ReturnType<typeof launchIntent>): void {
  if (intent.switcher) toggleSwitcher()
  else showMainWindow(intent.route)
}

/** Windows taskbar right-click tasks (packaged builds only — dev runs through electron.exe). */
function setJumpList(): void {
  if (process.platform !== 'win32' || !app.isPackaged) return
  const task = (title: string, description: string, args: string) => ({ program: process.execPath, arguments: args, iconPath: process.execPath, iconIndex: 0, title, description })
  app.setUserTasks([
    task('New brand', 'Set up a new brand with its own Chrome', '--cubby-route=/brands/new'),
    task('Compose', 'Write and schedule a post', '--cubby-route=/compose'),
    task('Approvals', 'Posts waiting for your approval', '--cubby-route=/approvals'),
    task('Quick switch', 'Jump to a brand window', '--cubby-switcher')
  ])
}

// Dev builds keep their data apart from the installed app; CUBBY_DATA_DIR gives a fully separate
// instance (own data, own single-instance lock) for tests and e2e.
if (process.env.CUBBY_DATA_DIR) app.setPath('userData', process.env.CUBBY_DATA_DIR)
else if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'Cubby Dev'))
app.setAppUserModelId('studio.ffdev.cubby')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => act(launchIntent(argv)))
  // macOS: double-clicked .brand files arrive here (before or after ready)
  let pendingOpen: string | null = null
  app.on('open-file', (e, file) => {
    e.preventDefault()
    if (app.isReady()) showMainWindow(`/?import=${encodeURIComponent(file)}`)
    else pendingOpen = file
  })

  app.whenReady().then(async () => {
    initPaths(app.getPath('userData'))
    const logFile = startLogFile(paths.logs)
    openDb(paths.db)
    app.setAboutPanelOptions({ applicationName: 'Cubby', applicationVersion: app.getVersion(), copyright: '© 2026 FF Dev Studio', website: 'https://ffdev.studio', iconPath: join(app.getAppPath(), 'resources', 'icon.png') })
    registerFileProtocol()
    setupIpc()
    setNotifyOpener((p) => showMainWindow(p))
    ipcMain.on('cubby:titlebar', (_e, symbolColor: string) => setTitleBarColors(symbolColor))
    ipcMain.on('cubby:closeSwitcher', () => closeSwitcher())
    nativeTheme.themeSource = getSettings().theme

    await startModules()
    const missing = missingCommands()
    if (missing.length) console.warn(`[cubby] ${missing.length} commands not implemented:`, missing.join(', '))

    const intent = pendingOpen ? { route: `/?import=${encodeURIComponent(pendingOpen)}` } : launchIntent(process.argv)
    if (intent.switcher) showMainWindow()
    act(intent)
    createTray()
    setJumpList()
    setApprovalsBadge(buildStatus().approvalsCount)
    on('app.status', (st) => setApprovalsBadge(st.approvalsCount))
    registerHotkey()
    watchHotkeySetting()
    console.log(`[cubby] ${app.getVersion()} ready — data in ${paths.root}, log ${logFile}`)
  })

  // Closing the window keeps Cubby in the tray (scheduler, API, MCP keep running) unless turned off.
  app.on('window-all-closed', () => {
    if (!getSettings().closeToTray && process.platform !== 'darwin') app.quit()
  })
  app.on('activate', () => showMainWindow())

  let stopping = false
  app.on('before-quit', (e) => {
    if (stopping) return
    e.preventDefault()
    stopping = true
    // brand Chromes are detached and keep running; they are re-adopted on the next start
    stopModules()
      .catch(() => {})
      .finally(() => {
        closeDb()
        app.exit(0)
      })
  })
}
