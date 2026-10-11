// Choosing the next free posting slot ("Add to queue"). Pure: candidates come from slotTimes()
// (scheduler/time.ts), `taken` are the brand's active posts, `allowed` asks pacing.
export const SLOT_WINDOW_MS = 30 * 60_000

/** First candidate not within ±30 min of a taken time and allowed by pacing; null if none. */
export function pickSlot(candidates: Date[], taken: Date[], allowed: (t: Date) => boolean, windowMs = SLOT_WINDOW_MS): Date | null {
  for (const c of candidates) {
    const t = c.getTime()
    if (taken.some((x) => Math.abs(x.getTime() - t) <= windowMs)) continue
    if (!allowed(c)) continue
    return c
  }
  return null
}
