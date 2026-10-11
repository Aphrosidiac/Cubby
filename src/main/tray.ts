// Tray / menu-bar icon: brands with open/close, approvals, Claude status, Stop, open app.
import { app, Menu, nativeImage, Tray } from 'electron'
import { onEvent } from './core/events'
import { resourcePath } from './core/resources'
import { invoke } from './core/registry'
import { runtime, setKillSwitch } from './core/runtime'
import { buildStatus } from './modules/app'
import { listBrands } from './modules/brands'
import { showMainWindow, toggleSwitcher } from './windows'

let tray: Tray | null = null
let timer: NodeJS.Timeout | null = null

function rebuild(): void {
  if (!tray) return
  const status = buildStatus()
  const brands = listBrands().slice(0, 25)
  const brandItems: Electron.MenuItemConstructorOptions[] = brands.map((b) => ({
    label: `${b.status === 'open' ? '● ' : '○ '}${b.name}`,
    submenu: [
      b.status === 'open'
        ? { label: 'Bring to front', click: () => void invoke('brands.front', { id: b.id }, { actor: 'you' }).catch(() => {}) }
        : { label: 'Open', click: () => void invoke('brands.open', { id: b.id }, { actor: 'you' }).catch(() => {}) },
      { label: 'Close', enabled: b.status === 'open', click: () => void invoke('brands.close', { id: b.id }, { actor: 'you' }).catch(() => {}) },
      { label: 'Show in Cubby', click: () => showMainWindow(`/brands/${b.id}`) }
    ]
  }))
  const working = status.runs.length ? status.runs.map((r) => `${r.actor === 'claude' ? 'Claude' : r.actor} is working in ${r.brandName}`).join(' · ') : null
  const menu = Menu.buildFromTemplate([
    { label: 'Open Cubby', click: () => showMainWindow() },
    { label: 'Quick switch…', click: () => toggleSwitcher() },
    { type: 'separator' },
    { label: status.approvalsCount ? `Approvals (${status.approvalsCount})` : 'Approvals', click: () => showMainWindow('/approvals') },
    ...(working ? [{ label: working, enabled: false } as Electron.MenuItemConstructorOptions] : []),
    runtime.killSwitch
      ? { label: 'Resume automation (kill switch on)', click: () => setKillSwitch(false) }
      : { label: 'Stop all automation', click: () => setKillSwitch(true) },
    { type: 'separator' },
    ...(brandItems.length ? brandItems : [{ label: 'No brands yet', enabled: false }]),
    { type: 'separator' },
    { label: 'Quit Cubby', click: () => app.quit() }
  ])
  tray.setContextMenu(menu)
  tray.setToolTip(`Cubby — ${status.openBrands} open${status.approvalsCount ? ` · ${status.approvalsCount} to approve` : ''}${runtime.killSwitch ? ' · STOPPED' : ''}`)
}

function schedule(): void {
  if (timer) return
  timer = setTimeout(() => {
    timer = null
    rebuild()
  }, 400)
}

export function createTray(): void {
  // Windows: pixel-drawn 16 px mark (+ @2x picked up automatically); macOS: a template image the
  // menu bar tints for light/dark
  const icon = nativeImage.createFromPath(resourcePath(process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'))
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.on('click', () => showMainWindow())
  rebuild()
  onEvent((name) => {
    if (name === 'brands.changed' || name === 'brand.status' || name === 'app.status' || name === 'posts.changed') schedule()
  })
}
