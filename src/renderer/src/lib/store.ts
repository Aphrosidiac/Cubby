// App-wide live state: AppStatus + Settings, kept current from main-process events.
import { reactive } from 'vue'
import type { AppStatus, Settings } from '@shared/types'
import { api, on } from './api'

export const app = reactive<{ status: AppStatus | null; settings: Settings | null; ready: boolean }>({ status: null, settings: null, ready: false })

let started = false
export async function startStore(): Promise<void> {
  if (started) return
  started = true
  on('app.status', (s) => (app.status = s))
  on('settings.changed', (s) => {
    app.settings = s
    applyTheme()
  })
  const [status, settings] = await Promise.all([api('app.status'), api('settings.get')])
  app.status = status
  app.settings = settings
  app.ready = true
  applyTheme()
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme)
}

export function isDark(): boolean {
  const t = app.settings?.theme ?? 'system'
  return t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
}

export function applyTheme(): void {
  const dark = isDark()
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  window.cubby?.setTitleBarSymbolColor(dark ? '#a19e94' : '#625f57')
}

export async function setTheme(theme: Settings['theme']): Promise<void> {
  app.settings = await api('settings.set', { patch: { theme } })
  applyTheme()
}

export async function refreshStatus(): Promise<void> {
  app.status = await api('app.status')
}
