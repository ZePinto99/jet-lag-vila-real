import { gameClockNow } from '@/lib/gameClock'
import { makeGame } from '../test-utils'

describe('gameClockNow', () => {
  it('freezes at paused_at and returns to wall time outside weather pause', () => {
    const pausedAt = '2026-08-27T12:00:00.000Z'
    const wallNow = new Date('2026-08-27T12:05:00.000Z').getTime()
    const paused = makeGame({
      status: 'paused',
      config: { weather_pause: { paused_at: pausedAt, prior_status: 'live' } },
    })

    expect(gameClockNow(paused, wallNow)).toBe(new Date(pausedAt).getTime())
    expect(gameClockNow(makeGame(), wallNow)).toBe(wallNow)
  })
})
