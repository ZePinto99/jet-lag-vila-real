import { act, renderHook, waitFor } from '@testing-library/react'
import { translate } from '@/lib/i18n/messages'
import { useCurseEnforcement } from '@/lib/hooks/useCurseEnforcement'
import { apiPost } from '@/lib/api'
import { makeCurse } from '../test-utils'

jest.mock('@/lib/api', () => ({ apiPost: jest.fn() }))
const mockApiPost = apiPost as jest.MockedFunction<typeof apiPost>

const t = (key: string, tokens?: Record<string, string | number>) => translate(key, 'en', tokens)

describe('useCurseEnforcement', () => {
  it('locks actions while Full Stop is active and ignores expired curses', () => {
    const nowMs = Date.parse('2026-06-18T12:01:00.000Z')
    const { result } = renderHook(() =>
      useCurseEnforcement({
        activeCurses: [
          makeCurse({ curse_ref: 'curse.full-stop', expires_at: '2026-06-18T12:02:00.000Z' }),
          makeCurse({
            id: 'expired',
            curse_ref: 'curse.full-stop',
            expires_at: '2026-06-18T12:00:00.000Z',
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

  it('marks Photo Tax prompts as durable proof-photo slots', () => {
    const nowMs = Date.parse('2026-06-18T12:00:10.000Z')
    const { result } = renderHook(() =>
      useCurseEnforcement({
        activeCurses: [
          makeCurse({
            curse_ref: 'curse.photo-tax',
            started_at: '2026-06-18T12:00:00.000Z',
            expires_at: '2026-06-18T12:08:00.000Z',
            params: { interval_seconds: 90, submission_window_seconds: 30 },
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
      label: 'Selfie at any sign',
      secondsLeft: 20,
      proofRequired: true,
      promptIndex: 0,
    })
  })

  it('freezes prompt countdowns on game clock while wall time advances during pause', () => {
    const clockNow = Date.parse('2026-06-18T12:00:10.000Z')
    const curse = makeCurse({
      curse_ref: 'curse.check-in',
      started_at: '2026-06-18T12:00:00.000Z',
      expires_at: null,
      params: { interval_seconds: 60, submission_window_seconds: 30 },
    })
    const { result, rerender } = renderHook(
      ({ wallNow }) =>
        useCurseEnforcement({
          activeCurses: [curse],
          myGps: null,
          myTeamId: 'west',
          presence: {},
          nowMs: clockNow,
          wallNowMs: wallNow,
          gameplayActive: false,
          gameId: null,
          t,
        }),
      { initialProps: { wallNow: clockNow } },
    )
    expect(result.current.byCurseId[curse.id].prompt?.secondsLeft).toBe(20)
    rerender({ wallNow: clockNow + 30_000 })
    expect(result.current.byCurseId[curse.id].prompt?.secondsLeft).toBe(20)
  })

  it('computes team spread readouts for buddy-up curses', () => {
    const nowMs = Date.parse('2026-06-18T12:00:10.000Z')
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
          a: {
            player_id: 'a',
            team_id: 'west',
            lat: 41.295,
            lng: -7.746,
            accuracy: 5,
            updated_at: nowMs,
          },
          b: {
            player_id: 'b',
            team_id: 'west',
            lat: 41.2952,
            lng: -7.746,
            accuracy: 5,
            updated_at: nowMs,
          },
        },
        nowMs,
        gameId: null,
        t,
      }),
    )

    expect(result.current.byCurseId['curse-1'].readout?.text).toMatch(/^Team spread \d+ m$/)
    expect(result.current.byCurseId['curse-1'].readout?.ok).toBe(false)
  })

  it('uses the maximum team spread for Team Quarantine', () => {
    const nowMs = Date.parse('2026-06-18T12:00:10.000Z')
    const { result } = renderHook(() =>
      useCurseEnforcement({
        activeCurses: [
          makeCurse({
            curse_ref: 'curse.solo-quarantine',
            params: { max_pairwise_distance_m: 50 },
            expires_at: null,
          }),
        ],
        myGps: null,
        myTeamId: 'west',
        presence: {
          a: {
            player_id: 'a',
            team_id: 'west',
            lat: 41.295,
            lng: -7.746,
            accuracy: 5,
            updated_at: nowMs,
          },
          b: {
            player_id: 'b',
            team_id: 'west',
            lat: 41.2951,
            lng: -7.746,
            accuracy: 5,
            updated_at: nowMs,
          },
          c: {
            player_id: 'c',
            team_id: 'west',
            lat: 41.297,
            lng: -7.746,
            accuracy: 5,
            updated_at: nowMs,
          },
        },
        nowMs,
        gameId: null,
        t,
      }),
    )

    expect(result.current.byCurseId['curse-1'].readout?.text).toMatch(/^Quarantine spread \d+ m$/)
    expect(result.current.byCurseId['curse-1'].readout?.ok).toBe(false)
  })

  it('flags Slow Walk speed above the configured limit', () => {
    const startedAt = Date.parse('2026-06-18T12:00:00.000Z')
    const initial = { lat: 41.295, lng: -7.746, accuracy: 5, updated_at: startedAt }
    const curse = makeCurse({
      curse_ref: 'curse.slow-walk',
      params: { max_speed_kmh: 2.5 },
      expires_at: null,
    })
    const { result, rerender } = renderHook(
      ({ gps }) =>
        useCurseEnforcement({
          activeCurses: [curse],
          myGps: gps,
          myTeamId: 'west',
          presence: {},
          nowMs: gps.updated_at,
          gameId: null,
          t,
        }),
      { initialProps: { gps: initial } },
    )
    rerender({
      gps: { ...initial, lat: initial.lat + 0.0002, updated_at: startedAt + 10_000 },
    })

    expect(result.current.byCurseId[curse.id].readout?.text).toMatch(/^Speed /)
    expect(result.current.byCurseId[curse.id].readout?.ok).toBe(false)
  })

  it('locks actions for Pilgrimage and completes at its neutral geofence', async () => {
    const nowMs = Date.parse('2026-06-18T12:00:10.000Z')
    const target = { lat: 41.29624, lng: -7.7458, accuracy: 5, updated_at: nowMs }
    const curse = makeCurse({
      curse_ref: 'curse.pilgrimage',
      params: { target_landmark_ref: 'landmark.largo-do-pelourinho' },
      expires_at: null,
    })
    mockApiPost.mockResolvedValue({ ok: true })
    const { result } = renderHook(() =>
      useCurseEnforcement({
        activeCurses: [curse],
        myGps: target,
        myPlayerId: 'player-1',
        myTeamId: 'west',
        presence: {},
        nowMs,
        gameId: 'game-1',
        t,
      }),
    )

    expect(result.current.actionsLocked).toBe(true)
    expect(result.current.actionsLockedLabel).toMatch(/Pilgrimage/)
    expect(result.current.byCurseId[curse.id].readout?.ok).toBe(true)
    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/api/games/game-1/complete-pilgrimage', {
        device_id: 'test-device-id',
        player_id: 'player-1',
        curse_id: curse.id,
        pos: target,
      })
    })
  })

  it('keeps pause readouts but emits no Pilgrimage completion while gameplay is paused', async () => {
    const nowMs = Date.parse('2026-06-18T12:00:10.000Z')
    const target = { lat: 41.29624, lng: -7.7458, accuracy: 5, updated_at: nowMs }
    const curse = makeCurse({
      curse_ref: 'curse.pilgrimage',
      params: { target_landmark_ref: 'landmark.largo-do-pelourinho' },
      expires_at: null,
    })
    mockApiPost.mockClear()
    const { result } = renderHook(() =>
      useCurseEnforcement({
        activeCurses: [curse],
        myGps: target,
        myPlayerId: 'player-1',
        myTeamId: 'west',
        presence: {},
        nowMs,
        gameId: 'game-1',
        gameplayActive: false,
        t,
      }),
    )

    expect(result.current.byCurseId[curse.id].readout?.ok).toBe(true)
    await act(async () => Promise.resolve())
    expect(mockApiPost).not.toHaveBeenCalled()
  })

  it('flags Detour entry from the selected street geometry and clears outside its corridor', () => {
    const nowMs = Date.parse('2026-06-18T12:00:10.000Z')
    const curse = makeCurse({
      curse_ref: 'curse.detour',
      params: {
        banned_street_name: 'Avenida Carvalho Araújo',
        banned_street_polyline: [
          [41.295, -7.746],
          [41.296, -7.746],
        ],
        corridor_m: 18,
      },
      expires_at: null,
    })
    const inside = { lat: 41.2955, lng: -7.746, accuracy: 5, updated_at: nowMs }
    const { result, rerender } = renderHook(
      ({ gps }) =>
        useCurseEnforcement({
          activeCurses: [curse],
          myGps: gps,
          myTeamId: 'west',
          presence: {},
          nowMs,
          gameId: null,
          t,
        }),
      { initialProps: { gps: inside } },
    )

    expect(result.current.byCurseId[curse.id].readout?.text).toContain('Avenida Carvalho Araújo')
    expect(result.current.byCurseId[curse.id].readout?.ok).toBe(false)

    rerender({ gps: { ...inside, lng: -7.7454 } })
    expect(result.current.byCurseId[curse.id].readout?.ok).toBe(true)
  })

  it('shows reminders for honor and photo/check-in curse categories', () => {
    const nowMs = Date.parse('2026-06-18T12:00:10.000Z')
    const refs = [
      'curse.single-file',
      'curse.photo-tax',
      'curse.outfit-swap',
      'curse.pose-patrol',
      'curse.check-in',
      'curse.mute',
      'curse.backwards',
      'curse.detour',
    ]
    const { result } = renderHook(() =>
      useCurseEnforcement({
        activeCurses: refs.map((curse_ref, index) =>
          makeCurse({
            id: `curse-${index}`,
            curse_ref,
            started_at: new Date(nowMs - 10_000).toISOString(),
            expires_at: null,
            params:
              curse_ref === 'curse.photo-tax'
                ? { interval_seconds: 90, submission_window_seconds: 30 }
                : curse_ref === 'curse.pose-patrol'
                  ? { interval_seconds: 120, submission_window_seconds: 30 }
                  : curse_ref === 'curse.check-in'
                    ? { interval_seconds: 60, submission_window_seconds: 60 }
                    : curse_ref === 'curse.mute'
                      ? { ping_interval_seconds: 60 }
                      : {},
          }),
        ),
        myGps: null,
        myTeamId: 'west',
        presence: {},
        nowMs,
        gameId: null,
        t,
      }),
    )

    for (let index = 0; index < refs.length; index++) {
      expect(result.current.byCurseId[`curse-${index}`].prompt?.label).toBeTruthy()
    }
  })

  it('loads a durable Frozen anchor and reports drift from it', async () => {
    const startedAt = Date.parse('2026-06-18T12:00:00.000Z')
    const curse = makeCurse({
      curse_ref: 'curse.frozen',
      started_at: new Date(startedAt).toISOString(),
      expires_at: '2026-06-18T12:08:00.000Z',
      params: { max_drift_m: 10 },
    })
    const anchor = {
      lat: 41.295,
      lng: -7.746,
      accuracy: 5,
      updated_at: startedAt,
    }
    mockApiPost.mockResolvedValue({
      anchor: { lat: anchor.lat, lng: anchor.lng },
    })
    const { result, rerender } = renderHook(
      ({ nowMs, myGps }: { nowMs: number; myGps: typeof anchor | null }) =>
        useCurseEnforcement({
          activeCurses: [curse],
          myGps,
          myPlayerId: 'player-1',
          myTeamId: 'west',
          presence: {},
          nowMs,
          gameId: 'game-1',
          t,
        }),
      {
        initialProps: {
          nowMs: startedAt,
          myGps: anchor,
        } as { nowMs: number; myGps: typeof anchor | null },
      },
    )

    await waitFor(() => {
      expect(result.current.byCurseId[curse.id].readout?.ok).toBe(true)
    })

    act(() => {
      rerender({
        nowMs: startedAt + 5_000,
        myGps: {
          ...anchor,
          lat: anchor.lat + 0.0002,
          updated_at: startedAt + 5_000,
        },
      })
    })
    await waitFor(() => {
      expect(result.current.byCurseId[curse.id].readout?.ok).toBe(false)
    })
  })

  it('stops retrying when a Frozen curse disappears during anchor setup', async () => {
    const startedAt = Date.parse('2026-06-18T12:00:00.000Z')
    const curse = makeCurse({
      curse_ref: 'curse.frozen',
      expires_at: '2026-06-18T12:08:00.000Z',
    })
    const gps = { lat: 41.295, lng: -7.746, accuracy: 5, updated_at: startedAt }
    mockApiPost.mockReset()
    mockApiPost.mockRejectedValue(new Error('curse_not_found'))

    const { rerender } = renderHook(
      ({ nowMs }) =>
        useCurseEnforcement({
          activeCurses: [curse],
          myGps: { ...gps, updated_at: nowMs },
          myPlayerId: 'player-1',
          myTeamId: 'west',
          presence: {},
          nowMs,
          gameId: 'game-1',
          t,
        }),
      { initialProps: { nowMs: startedAt } },
    )

    await waitFor(() => expect(mockApiPost).toHaveBeenCalledTimes(1))
    rerender({ nowMs: startedAt + 1_000 })
    await act(async () => Promise.resolve())
    expect(mockApiPost).toHaveBeenCalledTimes(1)
  })
})
