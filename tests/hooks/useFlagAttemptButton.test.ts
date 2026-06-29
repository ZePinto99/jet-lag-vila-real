import { renderHook } from '@testing-library/react'
import { useFlagAttemptButton } from '@/lib/hooks/useFlagAttemptButton'

const gps = { lat: 41.295, lng: -7.746, accuracy: 5, updated_at: 1000 }
const enemyLandmarks = [
  { id: 'near', ref: 'enemy.near', lat: 41.29502, lng: -7.746, team_id: 'east' },
  { id: 'far', ref: 'enemy.far', lat: 41.296, lng: -7.746, team_id: 'east' },
]

describe('useFlagAttemptButton', () => {
  it('requires GPS, live status, and non-respawning player', () => {
    expect(
      renderHook(() =>
        useFlagAttemptButton({
          myGps: null,
          enemyLandmarks,
          respawning: false,
          gameStatus: 'live',
          discoveredEnemyKinds: {},
        }),
      ).result.current.reason,
    ).toBe('no_gps')

    expect(
      renderHook(() =>
        useFlagAttemptButton({
          myGps: gps,
          enemyLandmarks,
          respawning: true,
          gameStatus: 'live',
          discoveredEnemyKinds: {},
        }),
      ).result.current.reason,
    ).toBe('respawning')

    expect(
      renderHook(() =>
        useFlagAttemptButton({
          myGps: gps,
          enemyLandmarks,
          respawning: false,
          gameStatus: 'flag_found',
          discoveredEnemyKinds: {},
        }),
      ).result.current.reason,
    ).toBe('not_live')
  })

  it('enables for the nearest undiscovered enemy candidate within 20 m', () => {
    // RULEBOOK §5.2: raiders can attempt a nearby enemy candidate.
    const { result } = renderHook(() =>
      useFlagAttemptButton({
        myGps: gps,
        enemyLandmarks,
        respawning: false,
        gameStatus: 'live',
        discoveredEnemyKinds: {},
      }),
    )

    expect(result.current.enabled).toBe(true)
    expect(result.current.target?.ref).toBe('enemy.near')
    expect(result.current.distance_m).toBeLessThan(5)
  })

  it('blocks out-of-range and already-discovered targets', () => {
    expect(
      renderHook(() =>
        useFlagAttemptButton({
          myGps: { ...gps, lat: 41.299 },
          enemyLandmarks,
          respawning: false,
          gameStatus: 'live',
          discoveredEnemyKinds: {},
        }),
      ).result.current.reason,
    ).toBe('no_landmark_in_range')

    const discovered = renderHook(() =>
      useFlagAttemptButton({
        myGps: gps,
        enemyLandmarks,
        respawning: false,
        gameStatus: 'live',
        discoveredEnemyKinds: { 'enemy.near': 'flag_decoy' },
      }),
    ).result.current
    expect(discovered.reason).toBe('already_discovered')
    expect(discovered.target?.ref).toBe('enemy.near')
  })
})
