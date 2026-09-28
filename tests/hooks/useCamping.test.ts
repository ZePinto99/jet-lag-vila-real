import { act, renderHook, waitFor } from '@testing-library/react'
import { apiPost } from '@/lib/api'
import {
  CAMPING_COOLDOWN_S,
  CAMPING_LOCK_S,
  CAMPING_WARNING_S,
  useCamping,
  type UseCampingParams,
} from '@/lib/hooks/useCamping'
import { makeLandmark } from '../test-utils'

jest.mock('@/lib/api', () => ({ apiPost: jest.fn() }))
const mockApiPost = apiPost as jest.MockedFunction<typeof apiPost>

const NOW = Date.now()
const gps = { lat: 41.295, lng: -7.746, accuracy: 5, updated_at: NOW }
const landmark = makeLandmark({ lat: gps.lat, lng: gps.lng })

interface CampingResponse {
  inside_zone: boolean
  seconds_in_zone: number
  seconds_outside: number
  locked: boolean
  last_heartbeat_at: string
}

function response(overrides: Partial<CampingResponse> = {}): CampingResponse {
  return {
    inside_zone: true,
    seconds_in_zone: 0,
    seconds_outside: 0,
    locked: false,
    last_heartbeat_at: new Date(NOW).toISOString(),
    ...overrides,
  }
}

function params(overrides: Partial<UseCampingParams> = {}): UseCampingParams {
  return {
    gameId: 'game-1',
    myPlayerId: 'player-1',
    myGps: gps,
    myTeamLandmarks: [landmark],
    enabled: true,
    gameplayActive: true,
    clockNowMs: NOW,
    wallNowMs: NOW,
    ...overrides,
  }
}

describe('useCamping', () => {
  beforeEach(() => {
    jest.useRealTimers()
    window.localStorage.setItem('device_id', 'device-1')
    mockApiPost.mockReset()
  })

  it('hydrates the durable warning state immediately and sends no GPS storage payload beyond the heartbeat request', async () => {
    mockApiPost.mockResolvedValue(response({ seconds_in_zone: CAMPING_WARNING_S }))
    const { result } = renderHook(() => useCamping(params()))

    await waitFor(() => expect(result.current.status).toBe('warning'))
    expect(result.current.secondsInZone).toBe(CAMPING_WARNING_S)
    expect(mockApiPost).toHaveBeenCalledWith(
      '/api/games/game-1/camping-heartbeat',
      {
        device_id: 'device-1',
        player_id: 'player-1',
        pos: gps,
      },
    )
  })

  it('restores a camping lock after a full hook unmount/reload', async () => {
    mockApiPost.mockResolvedValue(response({
      seconds_in_zone: CAMPING_LOCK_S,
      locked: true,
    }))
    const first = renderHook(() => useCamping(params()))
    await waitFor(() => expect(first.result.current.campingLocked).toBe(true))
    first.unmount()

    const reloaded = renderHook(() => useCamping(params()))
    await waitFor(() => expect(reloaded.result.current.status).toBe('locked'))
    expect(mockApiPost).toHaveBeenCalledTimes(2)
  })

  it('freezes warning progress while weather-paused', async () => {
    mockApiPost.mockResolvedValue(response({ seconds_in_zone: 89 }))
    const { result, rerender } = renderHook(
      ({ gameplayActive, clockNowMs }) => useCamping(params({ gameplayActive, clockNowMs })),
      { initialProps: { gameplayActive: true, clockNowMs: NOW } },
    )
    await waitFor(() => expect(result.current.secondsInZone).toBe(89))

    rerender({ gameplayActive: false, clockNowMs: NOW + 5 * 60_000 })
    expect(result.current.secondsInZone).toBe(89)
    expect(result.current.status).toBe('idle')
  })

  it('projects the 90-second warning but never more than the server offline cap', async () => {
    mockApiPost.mockResolvedValue(response({ seconds_in_zone: 89 }))
    const { result, rerender } = renderHook(
      ({ clockNowMs }) => useCamping(params({ clockNowMs })),
      { initialProps: { clockNowMs: NOW } },
    )
    await waitFor(() => expect(result.current.secondsInZone).toBe(89))

    rerender({ clockNowMs: NOW + 1_000 })
    expect(result.current.status).toBe('warning')
    rerender({ clockNowMs: NOW + 10 * 60_000 })
    expect(result.current.secondsInZone).toBe(104)
    expect(result.current.status).toBe('warning')
  })

  it('projects the last cooldown second and unlocks without counting paused time', async () => {
    mockApiPost.mockResolvedValue(response({
      inside_zone: false,
      seconds_in_zone: CAMPING_LOCK_S,
      seconds_outside: 59,
      locked: true,
    }))
    const { result, rerender } = renderHook(
      ({ gameplayActive, clockNowMs }) => useCamping(params({ gameplayActive, clockNowMs })),
      { initialProps: { gameplayActive: true, clockNowMs: NOW } },
    )
    await waitFor(() => expect(result.current.status).toBe('locked'))

    rerender({ gameplayActive: false, clockNowMs: NOW + 60_000 })
    expect(result.current.status).toBe('locked')
    rerender({ gameplayActive: true, clockNowMs: NOW + 1_000 })
    expect(result.current.status).toBe('idle')
  })

  // P8: the 90 s warning is only worth promising if it is correct after a
  // reload. It is derived from the server's accumulated seconds, so a client
  // that has been open for zero seconds must still know it is at 95 s.
  it('derives the lock countdown from server seconds on a cold start, not from local elapsed time', async () => {
    mockApiPost.mockResolvedValue(response({ seconds_in_zone: 95 }))
    const { result } = renderHook(() => useCamping(params()))

    await waitFor(() => expect(result.current.status).toBe('warning'))
    // Freshly mounted: no locally accumulated time at all, yet the countdown is
    // already correct because the server supplied the 95 s.
    expect(result.current.secondsUntilLock).toBe(CAMPING_LOCK_S - 95)
    expect(result.current.secondsUntilUnlock).toBeNull()
  })

  it('does NOT warn below the threshold even after a long time on screen', async () => {
    mockApiPost.mockResolvedValue(response({ seconds_in_zone: 20 }))
    const { result, rerender } = renderHook(
      ({ clockNowMs }) => useCamping(params({ clockNowMs })),
      { initialProps: { clockNowMs: NOW } },
    )
    await waitFor(() => expect(result.current.secondsInZone).toBe(20))

    // The optimistic projection is capped at 15 s, so 20 + 15 = 35 s stays well
    // under the 90 s warning no matter how long the tab is left open.
    rerender({ clockNowMs: NOW + 30 * 60_000 })
    expect(result.current.status).toBe('idle')
    expect(result.current.secondsUntilLock).toBeGreaterThan(0)
  })

  it('does not warn while outside the zone even with a high in-zone total', async () => {
    mockApiPost.mockResolvedValue(response({
      inside_zone: false,
      seconds_in_zone: 119,
      seconds_outside: 5,
    }))
    const { result } = renderHook(() => useCamping(params()))

    await waitFor(() => expect(result.current.secondsInZone).toBe(119))
    expect(result.current.status).toBe('idle')
  })

  it('reports the remaining cooldown while locked and outside the zone', async () => {
    mockApiPost.mockResolvedValue(response({
      inside_zone: false,
      seconds_in_zone: CAMPING_LOCK_S,
      seconds_outside: 42,
      locked: true,
    }))
    const { result } = renderHook(() => useCamping(params()))

    await waitFor(() => expect(result.current.status).toBe('locked'))
    expect(result.current.secondsUntilUnlock).toBe(CAMPING_COOLDOWN_S - 42)
    expect(result.current.secondsUntilLock).toBe(0)
  })

  it('exposes full thresholds before the first heartbeat resolves', () => {
    mockApiPost.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useCamping(params()))

    expect(result.current.status).toBe('idle')
    expect(result.current.secondsUntilLock).toBe(CAMPING_LOCK_S)
    expect(result.current.secondsUntilUnlock).toBeNull()
    expect(result.current.cooldownThresholdSeconds).toBe(CAMPING_COOLDOWN_S)
  })

  it('does not report or advance state from stale GPS', async () => {
    renderHook(() => useCamping(params({
      myGps: { ...gps, updated_at: NOW - 31_000 },
    })))
    await act(async () => Promise.resolve())
    expect(mockApiPost).not.toHaveBeenCalled()
  })
})
