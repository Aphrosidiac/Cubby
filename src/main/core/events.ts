// In-process event bus. The IPC door forwards every event to the renderer windows.
import type { EventMap, EventName } from '@shared/contract'

type Listener = <E extends EventName>(name: E, payload: EventMap[E]) => void
const listeners = new Set<Listener>()

export function emit<E extends EventName>(name: E, payload: EventMap[E]): void {
  for (const l of listeners) {
    try {
      l(name, payload)
    } catch (e) {
      console.error('event listener failed', name, e)
    }
  }
}

export function onEvent(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Subscribe to one event name. */
export function on<E extends EventName>(name: E, fn: (payload: EventMap[E]) => void): () => void {
  return onEvent((n: EventName, p: unknown) => {
    if (n === (name as EventName)) fn(p as EventMap[E])
  })
}

export function toast(kind: EventMap['toast']['kind'], message: string): void {
  emit('toast', { kind, message })
}
