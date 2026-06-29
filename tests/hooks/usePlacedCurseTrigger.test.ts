import { renderHook, waitFor } from '@testing-library/react'
import { usePlacedCurseTrigger } from '@/lib/hooks/usePlacedCurseTrigger'

const gps = { lat: 41.295, lng: -7.746, accuracy: 5, updated_at: 1000 }
const enemyLandmarks = [
  { id: 'enemy', ref: 'enemy.zone', lat: 41.295, lng: -7.746, team_id: 'east' },
]

describe('usePlacedCurseTrigger', () => {
  beforeEach(() => {
    window.localStorage.setItem('device_id', 'device-1')
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ triggered_curse_refs: [] }), { status: 200 }),
    )
  })

  it('posts once when entering an enemy defense zone', async () => {
    // RULEBOOK placed-curses extension: hidden curse triggers on enemy zone entry.
    const { rerender } = renderHook(
      ({ myGps }) =>
        usePlacedCurseTrigger('game-1', 'player-1', myGps, enemyLandmarks, true),
      { initialProps: { myGps: null as typeof gps | null } },
    )

    rerender({ myGps: gps })

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/games/game-1/trigger-placed-curse',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          device_id: 'device-1',
          player_id: 'player-1',
          pos: gps,
        }),
      }),
    )

    rerender({ myGps: { ...gps, updated_at: 2000 } })
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})
