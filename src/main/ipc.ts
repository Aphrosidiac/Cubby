// The IPC door: one invoke channel, one event channel. Every renderer call runs as actor "you".
import { BrowserWindow, ipcMain } from 'electron'
import { onEvent } from './core/events'
import { invoke, isCommand, serializeError } from './core/registry'
import { UserError } from './core/errors'

export function setupIpc(): void {
  ipcMain.handle('cubby:invoke', async (_e, name: string, input: unknown) => {
    try {
      if (!isCommand(name)) throw new UserError(`unknown command ${name}`, 'not_found')
      return { ok: true, data: await invoke(name, input, { actor: 'you' }) }
    } catch (e) {
      return { ok: false, error: serializeError(e) }
    }
  })

  onEvent((name, payload) => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('cubby:event', name, payload)
  })
}
