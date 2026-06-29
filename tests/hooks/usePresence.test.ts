import { act, renderHook } from '@testing-library/react'
import { usePresence } from '@/lib/hooks/usePresence'
import { mockSupabaseClient } from '../test-utils'

const position = { lat: 41.295, lng: -7.746, accuracy: 5, updated_at: 1000 }

describe('usePresence', () => {
  it('subscribes to the game positions channel and tracks the latest GPS payload', () => {
    const client = mockSupabaseClient()
    renderHook(() => usePresence('game-1', 'player-1', 'team-west', position))

    expect(client.channel).toHaveBeenCalledWith('game:game-1:positions', {
      config: { presence: { key: 'player-1' } },
    })
    const channel = client.channel.mock.results[0].value
    expect(channel.track).toHaveBeenCalledWith({
      player_id: 'player-1',
      team_id: 'team-west',
      ...position,
    })
  })

  it('rebuilds presence by choosing the newest meta per player', () => {
    const client = mockSupabaseClient()
    const { result } = renderHook(() =>
      usePresence('game-1', 'player-1', 'team-west', position),
    )
    const channel = client.channel.mock.results[0].value

    act(() => {
      channel.setPresenceState({
        'player-1': [
          { player_id: 'player-1', team_id: 'team-west', lat: 1, lng: 1, accuracy: 10, updated_at: 1 },
          { player_id: 'player-1', team_id: 'team-west', lat: 2, lng: 2, accuracy: 4, updated_at: 2 },
        ],
      })
      channel.emitPresence('sync')
    })

    expect(result.current.presence['player-1']).toMatchObject({
      lat: 2,
      lng: 2,
      updated_at: 2,
    })
  })
})
