// Settings: defaults merged with stored overrides (one row per top-level key).
// Secret material (unlock hash, backup passphrase) lives under `secret.*` keys and never appears in Settings.
import type { Settings } from '@shared/types'
import { db, j, pj } from './db'
import { emit } from './events'

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  launchAtLogin: false,
  closeToTray: true,
  quickSwitchHotkey: 'CommandOrControl+Shift+Space',
  chromePath: null,
  apiPort: 7820,
  approvalDefault: true,
  timezone: 'Asia/Kuala_Lumpur',
  quietHours: { enabled: false, start: '00:00', end: '07:00' },
  catchUp: 'run',
  notifications: { os: true, telegramBotToken: null, telegramChatId: null },
  backup: { enabled: false, folder: null, cron: '0 3 * * *', keep: 7 },
  healthCheckHour: 9,
  defaultWindow: { width: 1280, height: 900 },
  unlockPassphraseSet: false,
  backupPassphraseSet: false
}

const DERIVED = new Set<keyof Settings>(['unlockPassphraseSet', 'backupPassphraseSet'])

export function getSettings(): Settings {
  const rows = db.all<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key NOT LIKE 'secret.%'")
  const s = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>
  for (const r of rows) if (r.key in s) s[r.key] = pj(r.value, s[r.key])
  const out = s as unknown as Settings
  out.unlockPassphraseSet = !!getSecretSetting('secret.unlock')
  out.backupPassphraseSet = !!getSecretSetting('secret.backupPassphrase')
  return out
}

export function setSettings(patch: Partial<Settings>): Settings {
  const cur = getSettings() as unknown as Record<string, unknown>
  db.tx(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in DEFAULT_SETTINGS) || DERIVED.has(k as keyof Settings)) continue
      const merged = v && typeof v === 'object' && !Array.isArray(v) && cur[k] && typeof cur[k] === 'object' ? { ...(cur[k] as object), ...(v as object) } : v
      db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, j(merged))
    }
  })
  const next = getSettings()
  emit('settings.changed', next)
  return next
}

export function getSecretSetting(key: `secret.${string}`): string | null {
  return db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)?.value ?? null
}

export function setSecretSetting(key: `secret.${string}`, value: string | null): void {
  if (value == null) db.run('DELETE FROM settings WHERE key = ?', key)
  else db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value)
}
