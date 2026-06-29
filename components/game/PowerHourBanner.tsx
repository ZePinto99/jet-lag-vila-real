'use client'

// PowerHourBanner — slim, persistent strip counting down to the next 30-min
// time-bonus tick (RULEBOOK §7.2, elevated). Every 2nd tick is a "Power Hour"
// worth +40 coins instead of the usual +20. When the upcoming tick is a Power
// Hour the strip is styled gold/amber; otherwise neutral/sky.
//
// Mirrors the thin protection-window banner in Live.tsx. Returns null when the
// game hasn't started (no startedAt). `nowMs` is passed in so the countdown
// re-renders off the same clock the parent already ticks.

import type { GameEvent } from '@/lib/types'

const TICK_INTERVAL_MS = 30 * 60 * 1000
const BONUS_REGULAR = 20
const BONUS_POWER_HOUR = 40

// A Power Hour is every 2nd tick (interval index even: 2, 4, 6, …).
function isPowerHourInterval(interval: number): boolean {
  return interval % 2 === 0
}

// m:ss — minutes are not zero-padded (e.g. "4:32"), seconds always two digits.
function fmtMSS(ms: number): string {
  const clamped = Math.max(0, ms)
  const totalSeconds = Math.ceil(clamped / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function PowerHourBanner({
  startedAt,
  nowMs,
  events,
  t,
}: {
  startedAt: string | null
  nowMs: number
  events: GameEvent[]
  t: (key: string, tokens?: Record<string, string | number>) => string
}) {
  if (!startedAt) return null

  const startedMs = new Date(startedAt).getTime()
  if (Number.isNaN(startedMs)) return null

  const elapsedMs = Math.max(0, nowMs - startedMs)
  // 0-based count of fully-elapsed intervals; the next tick is the one after.
  const intervalsElapsed = Math.floor(elapsedMs / TICK_INTERVAL_MS)
  const upcomingInterval = intervalsElapsed + 1 // 1-based, matches the route
  const nextTickAtMs = startedMs + upcomingInterval * TICK_INTERVAL_MS
  const msUntilNext = nextTickAtMs - nowMs

  const upcomingIsPowerHour = isPowerHourInterval(upcomingInterval)
  const upcomingAmount = upcomingIsPowerHour ? BONUS_POWER_HOUR : BONUS_REGULAR
  const time = fmtMSS(msUntilNext)

  // `events` is accepted so the parent can pass the live event feed (e.g. for
  // future "Power Hour just hit" flashes); the countdown itself derives purely
  // from startedAt + nowMs, which is robust to missed polls.
  void events

  if (upcomingIsPowerHour) {
    return (
      <div className="border-b border-amber-700/60 bg-amber-950/40 px-4 py-1.5 text-center text-[11px] font-medium text-amber-200">
        {t('powerhour.next_power', { time, amount: upcomingAmount })}
      </div>
    )
  }

  return (
    <div className="border-b border-sky-800/60 bg-sky-950/40 px-4 py-1.5 text-center text-[11px] font-medium text-sky-200">
      {t('powerhour.next', { time, amount: upcomingAmount })}
    </div>
  )
}
