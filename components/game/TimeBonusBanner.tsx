'use client'

// Persistent strip counting down to the next rulebook time bonus. Every
// completed 30-minute interval credits +20 coins to both teams.

import {
  TIME_BONUS_INTERVAL_MINUTES,
  dueTimeBonusIntervals,
  maximumTimeBonusIntervals,
} from '@/lib/timeBonuses'

const TICK_INTERVAL_MS = TIME_BONUS_INTERVAL_MINUTES * 60 * 1000
const BONUS_COINS = 20

function fmtMSS(ms: number): string {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function TimeBonusBanner({
  startedAt,
  nowMs,
  durationMinutes = 180,
  t,
}: {
  startedAt: string | null
  nowMs: number
  durationMinutes?: number
  t: (key: string, tokens?: Record<string, string | number>) => string
}) {
  if (!startedAt) return null
  const startedMs = new Date(startedAt).getTime()
  if (Number.isNaN(startedMs)) return null

  const intervalsElapsed = dueTimeBonusIntervals(startedMs, nowMs, durationMinutes)
  if (intervalsElapsed >= maximumTimeBonusIntervals(durationMinutes)) return null
  const nextTickAtMs = startedMs + (intervalsElapsed + 1) * TICK_INTERVAL_MS

  return (
    <div className="border-b border-sky-800/60 bg-sky-950/40 px-4 py-1.5 text-center text-[11px] font-medium text-sky-200">
      {t('timebonus.next', {
        time: fmtMSS(nextTickAtMs - nowMs),
        amount: BONUS_COINS,
      })}
    </div>
  )
}
