import { renderHook } from '@testing-library/react'
import { translate } from '@/lib/i18n/messages'
import { useCurseEnforcement } from '@/lib/hooks/useCurseEnforcement'
import { makeCurse } from '../test-utils'

const t = (key: string, tokens?: Record<string, string | number>) =>
  translate(key, 'en', tokens)

describe('useCurseEnforcement', () => {
  it('locks actions while Full Stop is active and ignores expired curses', () => {
    const nowMs = Date.parse('2026-06-18T12:01:00.000Z')
    const { result } = renderHook(() =>
      useCurseEnforcement({
        activeCurses: [
          makeCurse({ curse_ref: 'curse.full-stop', expires_at: '2026-06-18T12:02:00.000Z' }),
          makeCurse({ id: 'expired', curse_ref: 'curse.full-stop', expires_at: '2026-06-18T12:00:00.000Z' }),
        ],
        myGps: null,
        myTeamId: 'west',
        presence: {},
        nowMs,
        gameId: null,
        t,
      }),
    )

    expect(result.current.actionsLocked).toBe(true)
  })

  it('shows timed check-in prompts during the submission window', () => {
    const nowMs = Date.parse('2026-06-18T12:00:10.000Z')
    const { result } = renderHook(() =>
      useCurseEnforcement({
        activeCurses: [
          makeCurse({
            curse_ref: 'curse.check-in',
            started_at: '2026-06-18T12:00:00.000Z',
            expires_at: null,
            params: { interval_seconds: 60, submission_window_seconds: 30 },
          }),
        ],
        myGps: null,
        myTeamId: 'west',
        presence: {},
        nowMs,
        gameId: null,
        t,
      }),
    )

    expect(result.current.byCurseId['curse-1'].prompt).toEqual({
      label: 'Check in now',
      secondsLeft: 20,
    })
  })

  it('computes team spread readouts for buddy-up curses', () => {
    const { result } = renderHook(() =>
      useCurseEnforcement({
        activeCurses: [
          makeCurse({
            curse_ref: 'curse.buddy-up',
            params: { max_pairwise_distance_m: 10 },
            expires_at: null,
          }),
        ],
        myGps: null,
        myTeamId: 'west',
        presence: {
          a: { player_id: 'a', team_id: 'west', lat: 41.295, lng: -7.746, accuracy: 5, updated_at: 1 },
          b: { player_id: 'b', team_id: 'west', lat: 41.2952, lng: -7.746, accuracy: 5, updated_at: 1 },
        },
        nowMs: Date.parse('2026-06-18T12:00:10.000Z'),
        gameId: null,
        t,
      }),
    )

    expect(result.current.byCurseId['curse-1'].readout?.text).toMatch(/^Team spread \d+ m$/)
    expect(result.current.byCurseId['curse-1'].readout?.ok).toBe(false)
  })
})
