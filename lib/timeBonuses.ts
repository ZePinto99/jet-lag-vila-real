export const TIME_BONUS_INTERVAL_MINUTES = 30

export function maximumTimeBonusIntervals(durationMinutes: number): number {
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return 0
  return Math.floor(durationMinutes / TIME_BONUS_INTERVAL_MINUTES)
}

export function dueTimeBonusIntervals(
  startedAtMs: number,
  nowMs: number,
  durationMinutes: number,
): number {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs)) return 0
  const elapsedMinutes = Math.max(0, nowMs - startedAtMs) / 60_000
  return Math.min(
    maximumTimeBonusIntervals(durationMinutes),
    Math.floor(elapsedMinutes / TIME_BONUS_INTERVAL_MINUTES),
  )
}
