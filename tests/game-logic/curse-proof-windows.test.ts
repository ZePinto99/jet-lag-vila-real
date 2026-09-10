import { getCurseProofWindow } from '@/lib/curses/proofWindows'
import { makeCurse } from '../test-utils'

describe('curse proof windows', () => {
  const started = Date.parse('2026-08-27T12:00:00.000Z')

  it('opens and closes each Photo Tax interval deterministically', () => {
    const curse = makeCurse({
      curse_ref: 'curse.photo-tax',
      started_at: new Date(started).toISOString(),
      expires_at: new Date(started + 8 * 60_000).toISOString(),
      params: { interval_seconds: 90, submission_window_seconds: 30 },
    })
    expect(getCurseProofWindow(curse, started + 10_000)).toEqual({
      promptIndex: 0,
      secondsLeft: 20,
    })
    expect(getCurseProofWindow(curse, started + 40_000)).toBeNull()
    expect(getCurseProofWindow(curse, started + 95_000)).toEqual({
      promptIndex: 1,
      secondsLeft: 25,
    })
  })

  it('schedules exactly two Single File prompts', () => {
    const curse = makeCurse({
      curse_ref: 'curse.single-file',
      started_at: new Date(started).toISOString(),
      expires_at: new Date(started + 5 * 60_000).toISOString(),
      params: { prompts_per_curse: 2 },
    })
    expect(getCurseProofWindow(curse, started + 5_000)?.promptIndex).toBe(0)
    expect(getCurseProofWindow(curse, started + 155_000)?.promptIndex).toBe(1)
    expect(getCurseProofWindow(curse, started + 200_000)).toBeNull()
  })

  it('uses opening and closing windows for Outfit Swap before/after proof', () => {
    const curse = makeCurse({
      curse_ref: 'curse.outfit-swap',
      started_at: new Date(started).toISOString(),
      expires_at: new Date(started + 20 * 60_000).toISOString(),
      params: { before_after_required: true, dispute_window_seconds: 60 },
    })
    expect(getCurseProofWindow(curse, started + 30_000)?.promptIndex).toBe(0)
    expect(getCurseProofWindow(curse, started + 10 * 60_000)).toBeNull()
    expect(getCurseProofWindow(curse, started + 19 * 60_000 + 10_000)?.promptIndex).toBe(1)
  })
})
