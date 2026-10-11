// Screens subscribe to main-process events ("topics") and refetch when something they show changed.
import type { EventName } from '@shared/contract'

type Handler = (topic: string) => void
const handlers = new Set<{ topics: string[]; fn: Handler }>()

if (typeof window !== 'undefined' && window.cubby)
  window.cubby.onEvent((name) => {
    for (const h of handlers) if (h.topics.includes(name)) h.fn(name)
  })

export function onTopics(topics: (EventName | string)[], fn: Handler): () => void {
  const h = { topics, fn }
  handlers.add(h)
  return () => handlers.delete(h)
}
