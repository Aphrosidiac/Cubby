// Paths to files in /resources. Packaged builds read the copies electron-builder places next to the
// app (extraResources) so the OS can open them (toasts, jump lists); dev reads the repo folder.
import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export function resourcePath(...parts: string[]): string {
  if (app.isPackaged) {
    const outside = join(process.resourcesPath, 'resources', ...parts)
    if (existsSync(outside)) return outside
  }
  return join(app.getAppPath(), 'resources', ...parts)
}

/** The app icon in the best format for the platform (ICO on Windows keeps every size crisp). */
export const appIconPath = (): string => resourcePath(process.platform === 'win32' ? 'icon.ico' : 'icon.png')
