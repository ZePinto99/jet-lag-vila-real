// Position timestamps are part of every GPS/presence payload. A player whose
// browser stopped publishing must disappear from proximity/radar decisions;
// otherwise a ghost position can remain taggable after the phone goes offline.

export const POSITION_MAX_AGE_MS = 30_000
export const POSITION_MAX_FUTURE_SKEW_MS = 10_000

export function isPositionFresh(updatedAt: number, nowMs: number): boolean {
  if (!Number.isFinite(updatedAt) || !Number.isFinite(nowMs)) return false
  return (
    updatedAt >= nowMs - POSITION_MAX_AGE_MS &&
    updatedAt <= nowMs + POSITION_MAX_FUTURE_SKEW_MS
  )
}
