import { renderHook } from '@testing-library/react'
import { useTagButton } from '@/lib/hooks/useTagButton'
import { makeLandmark } from '../test-utils'

const gps = { lat: 41.295, lng: -7.746, accuracy: 5, updated_at: 1000 }
const enemyLandmark = {
  id: 'enemy-lm',
  ref: 'landmark.enemy',
  lat: 41.3,
  lng: -7.746,
  team_id: 'east',
}

describe('useTagButton', () => {
  it('requires GPS before tagging', () => {
    const { result } = renderHook(() =>
      useTagButton({
        myGps: null,
        myPlayerId: 'me',
        myTeamId: 'west',
        myTeamLandmarks: [],
        enemyTeamLandmarks: [],
        presence: {},
        respawning: false,
        campingLocked: false,
        nowMs: 1000,
      }),
    )

    expect(result.current).toMatchObject({
      enabled: false,
      visible: false,
      reason: 'no_gps',
      targets: [],
      inDefenseZone: false,
    })
  })

  it('enables only for opposing players within 5 m while inside defense zone', () => {
    // RULEBOOK §6: defender inside own defense zone and within 5 m of a raider.
    const { result } = renderHook(() =>
      useTagButton({
        myGps: gps,
        myPlayerId: 'me',
        myTeamId: 'west',
        myTeamLandmarks: [makeLandmark({ lat: gps.lat, lng: gps.lng })],
        enemyTeamLandmarks: [enemyLandmark],
        presence: {
          me: { ...gps, player_id: 'me', team_id: 'west' },
          teammate: { ...gps, player_id: 'mate', team_id: 'west' },
          enemyNear: {
            lat: 41.29502,
            lng: -7.746,
            accuracy: 5,
            updated_at: 1001,
            player_id: 'enemy-1',
            team_id: 'east',
          },
          enemyFar: {
            lat: 41.296,
            lng: -7.746,
            accuracy: 5,
            updated_at: 1001,
            player_id: 'enemy-2',
            team_id: 'east',
          },
        },
        respawning: false,
        campingLocked: false,
        nowMs: 1001,
      }),
    )

    expect(result.current.enabled).toBe(true)
    expect(result.current.visible).toBe(true)
    expect(result.current.reason).toBe('enabled')
    expect(result.current.targets).toHaveLength(1)
    expect(result.current.targets[0].player_id).toBe('enemy-1')
  })

  it('prioritizes respawn, out-of-zone, no-enemy, and camping disabled reasons', () => {
    const base = {
      myGps: gps,
      myPlayerId: 'me',
      myTeamId: 'west',
      myTeamLandmarks: [makeLandmark({ lat: gps.lat, lng: gps.lng })],
      enemyTeamLandmarks: [enemyLandmark],
      presence: {
        enemy: {
          lat: 41.29502,
          lng: -7.746,
          accuracy: 5,
          updated_at: 1001,
          player_id: 'enemy',
          team_id: 'east',
        },
      },
      respawning: false,
      campingLocked: false,
      nowMs: 1001,
    }

    const respawning = renderHook((props) => useTagButton(props), {
      initialProps: { ...base, respawning: true },
    })
    expect(respawning.result.current.reason).toBe('respawning')

    const outOfZone = renderHook((props) => useTagButton(props), {
      initialProps: {
        ...base,
        myTeamLandmarks: [makeLandmark({ lat: 41.299, lng: -7.746 })],
      },
    })
    expect(outOfZone.result.current.reason).toBe('out_of_zone')
    expect(outOfZone.result.current.visible).toBe(false)

    const noEnemy = renderHook((props) => useTagButton(props), {
      initialProps: { ...base, presence: {} },
    })
    expect(noEnemy.result.current.reason).toBe('no_enemies_nearby')
    expect(noEnemy.result.current.visible).toBe(true)

    const camping = renderHook((props) => useTagButton(props), {
      initialProps: { ...base, campingLocked: true },
    })
    expect(camping.result.current.reason).toBe('camping_locked')
  })

  it('treats an opponent on our candidate as a raider despite overlapping defense zones', () => {
    const { result } = renderHook(() =>
      useTagButton({
        myGps: gps,
        myPlayerId: 'me',
        myTeamId: 'west',
        myTeamLandmarks: [makeLandmark({ lat: gps.lat, lng: gps.lng })],
        enemyTeamLandmarks: [{ ...enemyLandmark, lat: gps.lat, lng: gps.lng }],
        presence: {
          enemy: {
            ...gps,
            player_id: 'enemy',
            team_id: 'east',
          },
        },
        respawning: false,
        campingLocked: false,
        nowMs: 1000,
      }),
    )

    expect(result.current).toMatchObject({
      enabled: true,
      reason: 'enabled',
    })
    expect(result.current.targets.map((target) => target.player_id)).toEqual(['enemy'])
  })

  it('preserves defender immunity in a broad overlap more than 50 m from our candidate', () => {
    const overlapPoint = { ...gps, lat: 41.296 }
    const { result } = renderHook(() =>
      useTagButton({
        myGps: overlapPoint,
        myPlayerId: 'me',
        myTeamId: 'west',
        myTeamLandmarks: [makeLandmark({ lat: gps.lat, lng: gps.lng })],
        enemyTeamLandmarks: [{ ...enemyLandmark, lat: overlapPoint.lat, lng: overlapPoint.lng }],
        presence: {
          enemy: { ...overlapPoint, player_id: 'enemy', team_id: 'east' },
        },
        respawning: false,
        campingLocked: false,
        nowMs: 1000,
      }),
    )
    expect(result.current).toMatchObject({
      enabled: false,
      reason: 'no_enemies_nearby',
      targets: [],
    })
  })

  it('ignores stale local and enemy positions', () => {
    const base = {
      myGps: gps,
      myPlayerId: 'me',
      myTeamId: 'west',
      myTeamLandmarks: [makeLandmark({ lat: gps.lat, lng: gps.lng })],
      enemyTeamLandmarks: [enemyLandmark],
      presence: {
        enemy: { ...gps, player_id: 'enemy', team_id: 'east' },
      },
      respawning: false,
      campingLocked: false,
    }
    const staleMe = renderHook(() => useTagButton({ ...base, nowMs: 31_001 }))
    expect(staleMe.result.current.reason).toBe('no_gps')

    const staleEnemy = renderHook(() =>
      useTagButton({
        ...base,
        myGps: { ...gps, updated_at: 31_001 },
        nowMs: 31_001,
      }),
    )
    expect(staleEnemy.result.current.reason).toBe('no_enemies_nearby')
  })
})
