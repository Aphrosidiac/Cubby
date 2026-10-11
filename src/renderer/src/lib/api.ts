// Typed client over the preload bridge. `api('brands.list', {...})` returns the contract's output type.
import type { CommandName, EventMap, EventName, In, Out } from '@shared/contract'

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public rule?: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function api<K extends CommandName>(name: K, ...args: {} extends In<K> ? [input?: In<K>] : [input: In<K>]): Promise<Out<K>> {
  const r = await window.cubby.invoke(name, args[0] ?? {})
  if (!r.ok) throw new ApiError(r.error.message, r.error.code, r.error.rule)
  return r.data as Out<K>
}

/** Subscribe to a main-process event. Returns an unsubscribe function. */
export function on<E extends EventName>(name: E, fn: (payload: EventMap[E]) => void): () => void {
  return window.cubby.onEvent((n, p) => {
    if (n === name) fn(p as EventMap[E])
  })
}

/** URL for a local file (thumbnail, screenshot, media) served by the cubby-file:// protocol. */
export function fileUrl(path: string | null | undefined): string {
  return path ? `cubby-file://local/?p=${encodeURIComponent(path)}` : ''
}

export const isMac = window.cubby?.platform === 'darwin'
export const modKey = isMac ? '⌘' : 'Ctrl'
