// Process-wide runtime state that is not stored in SQLite.
import type { McpClientInfo } from '@shared/types'

export const runtime = {
  killSwitch: false,
  apiListening: false,
  mcpClients: new Map<string, McpClientInfo>()
}

const killHooks = new Set<() => void>()
/** Called when the kill switch turns on (run manager aborts everything, MCP drops work). */
export function onKill(fn: () => void): () => void {
  killHooks.add(fn)
  return () => killHooks.delete(fn)
}

export function setKillSwitch(on: boolean): void {
  runtime.killSwitch = on
  if (on) for (const f of killHooks) f()
  requestStatus()
}

// AppStatus is assembled by modules/app; anything that changes a status field calls requestStatus().
let statusEmitter: (() => void) | null = null
let pending: NodeJS.Timeout | null = null
export function setStatusEmitter(fn: () => void): void {
  statusEmitter = fn
}
export function requestStatus(): void {
  if (pending) return
  pending = setTimeout(() => {
    pending = null
    statusEmitter?.()
  }, 150)
}
