// The only bridge into the renderer: invoke(command, input), on(event, fn), and two helpers.
import { contextBridge, ipcRenderer, webUtils } from 'electron'

type Listener = (name: string, payload: unknown) => void
const listeners = new Set<Listener>()
ipcRenderer.on('cubby:event', (_e, name: string, payload: unknown) => {
  for (const l of listeners) l(name, payload)
})

const bridge = {
  platform: process.platform,
  invoke: (name: string, input?: unknown) => ipcRenderer.invoke('cubby:invoke', name, input ?? {}),
  onEvent: (fn: Listener) => {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  /** absolute path of a file dropped from Explorer / Finder */
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  setTitleBarSymbolColor: (color: string) => ipcRenderer.send('cubby:titlebar', color),
  closeSwitcher: () => ipcRenderer.send('cubby:closeSwitcher')
}

contextBridge.exposeInMainWorld('cubby', bridge)

export type CubbyBridge = typeof bridge
