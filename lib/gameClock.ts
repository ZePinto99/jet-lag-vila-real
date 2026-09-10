import type { Game } from '@/lib/types'

/** Freeze client countdowns at the authoritative weather-pause timestamp. */
export function gameClockNow(game: Game, wallClockNowMs: number): number {
  if (game.status !== 'paused') return wallClockNowMs
  const pausedAt = game.config.weather_pause?.paused_at
  if (!pausedAt) return wallClockNowMs
  const pausedAtMs = new Date(pausedAt).getTime()
  return Number.isFinite(pausedAtMs) ? pausedAtMs : wallClockNowMs
}
