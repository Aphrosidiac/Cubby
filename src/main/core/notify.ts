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
