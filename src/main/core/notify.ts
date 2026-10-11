// OS notifications (+ optional Telegram). Clicking one opens Cubby at `path`.
import { Notification } from 'electron'
import { resourcePath } from './resources'
import { getSettings } from './settings'

let showApp: (path?: string) => void = () => {}
export function setNotifyOpener(fn: (path?: string) => void): void {
  showApp = fn
}

export interface NotifyInput {
  title: string
  body: string
  /** renderer route to open on click, e.g. /approvals */
  path?: string
  urgent?: boolean
}

/** Send one Telegram message; throws a readable error (Telegram's own description) when it fails. */
export async function sendTelegram(token: string, chatId: string, text: string): Promise<{ chat: string }> {
  let r: Response
  try {
    r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(10_000)
    })
  } catch {
    throw new Error('Could not reach Telegram — check the internet connection')
  }
  const body = (await r.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: { chat?: { title?: string; username?: string; first_name?: string } } }
  if (!r.ok || !body.ok) throw new Error(`Telegram said: ${body.description ?? `HTTP ${r.status}`}`)
  const c = body.result?.chat
  return { chat: c?.title ?? (c?.username ? `@${c.username}` : (c?.first_name ?? chatId)) }
}

export function notify(n: NotifyInput): void {
  const s = getSettings()
  if (s.notifications.os && Notification.isSupported()) {
    const note = new Notification({ title: n.title, body: n.body, icon: resourcePath('icon.png'), urgency: n.urgent ? 'critical' : 'normal', silent: false })
    note.on('click', () => showApp(n.path))
    note.show()
  }
  const { telegramBotToken: tok, telegramChatId: chat } = s.notifications
  if (tok && chat) {
    fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: `${n.title}\n${n.body}` })
    }).catch(() => {})
  }
}
