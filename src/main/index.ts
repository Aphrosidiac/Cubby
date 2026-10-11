import { app, ipcMain, nativeTheme } from 'electron'
import { join } from 'node:path'
import './protocol'
import { closeDb, openDb } from './core/db'
import { setNotifyOpener } from './core/notify'
import { initPaths, paths } from './core/paths'
import { missingCommands } from './core/registry'
import { getSettings } from './core/settings'
import { setupIpc } from './ipc'
import { startModules, stopModules } from './modules'
import { registerFileProtocol } from './protocol'
import { createTray } from './tray'
import { closeSwitcher, registerHotkey, setTitleBarColors, showMainWindow, watchHotkeySetting } from './windows'

// Dev builds keep their data apart from the installed app; CUBBY_DATA_DIR gives a fully separate
// instance (own data, own single-instance lock) for tests and e2e.
if (process.env.CUBBY_DATA_DIR) app.setPath('userData', process.env.CUBBY_DATA_DIR)
else if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'Cubby Dev'))
app.setAppUserModelId('studio.ffdev.cubby')

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())

  app.whenReady().then(async () => {
    initPaths(app.getPath('userData'))
    openDb(paths.db)
    registerFileProtocol()
    setupIpc()
    setNotifyOpener((p) => showMainWindow(p))
    ipcMain.on('cubby:titlebar', (_e, symbolColor: string) => setTitleBarColors(symbolColor))
    ipcMain.on('cubby:closeSwitcher', () => closeSwitcher())
    nativeTheme.themeSource = getSettings().theme

    await startModules()
    const missing = missingCommands()
    if (missing.length) console.warn(`[cubby] ${missing.length} commands not implemented:`, missing.join(', '))

    showMainWindow()
    createTray()
    registerHotkey()
    watchHotkeySetting()
    console.log(`[cubby] ready — data in ${paths.root}`)
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
