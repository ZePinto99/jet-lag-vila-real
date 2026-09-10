import {
  dueTimeBonusIntervals,
  maximumTimeBonusIntervals,
} from '@/lib/timeBonuses'

describe('authoritative time-bonus interval cap', () => {
  const start = Date.UTC(2026, 7, 27, 12, 0, 0)

  it('caps a late three-hour finalization at six intervals', () => {
    expect(maximumTimeBonusIntervals(180)).toBe(6)
    expect(dueTimeBonusIntervals(start, start + 181 * 60_000, 180)).toBe(6)
    expect(dueTimeBonusIntervals(start, start + 24 * 60 * 60_000, 180)).toBe(6)
  })

  it('supports shorter and non-multiple configured durations', () => {
    expect(maximumTimeBonusIntervals(59)).toBe(1)
    expect(dueTimeBonusIntervals(start, start + 90 * 60_000, 59)).toBe(1)
    expect(maximumTimeBonusIntervals(20)).toBe(0)
  })

  it('does not award intervals before they are due', () => {
    expect(dueTimeBonusIntervals(start, start + 29 * 60_000, 180)).toBe(0)
    expect(dueTimeBonusIntervals(start, start + 30 * 60_000, 180)).toBe(1)
  })
})
