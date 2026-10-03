import { act, renderHook, waitFor } from '@testing-library/react'
import { useLobbyRealtime } from '@/lib/hooks/useLobbyRealtime'
import { useGameStore } from '@/store/gameStore'
import { makeGame, makePlayer, makeTeam, mockSupabaseClient } from '../test-utils'

function snapshotResponse(status: 'lobby' | 'setup' | 'live') {
  const west = makeTeam({ id: 'west' })
  const east = makeTeam({ id: 'east', side: 'east' })
  const me = makePlayer({ id: 'me', team_id: west.id, device_id: 'test-device-id' })
  return {
    game: makeGame({ status }),
    teams: [west, east],
    players: [me],
  }
}

describe('useLobbyRealtime', () => {
  it('reconciles the authoritative phase when the channel subscribes', async () => {
    const stale = snapshotResponse('lobby')
    useGameStore.setState({ ...stale, me: stale.players[0], isHydrated: true })
    const client = mockSupabaseClient()
    const fresh = snapshotResponse('setup')
    const fetchMock = jest
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(fresh), { status: 200 }))
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    })

    renderHook(() => useLobbyRealtime('game-1', 'ABCD'))

    await waitFor(() => {
      expect(useGameStore.getState().game?.status).toBe('setup')
      expect(useGameStore.getState().me?.id).toBe('me')
    })
    expect(client.channel).toHaveBeenCalledWith('lobby:game-1')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/games/by-code/ABCD',
      expect.objectContaining({ method: 'GET', cache: 'no-store' }),
    )
  })

  it('reconciles a missed setup -> live transition when the app becomes visible', async () => {
    const setup = snapshotResponse('setup')
    useGameStore.setState({ ...setup, me: setup.players[0], isHydrated: true })
    mockSupabaseClient()
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(setup), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(snapshotResponse('live')), { status: 200 }),
      )
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    })

    renderHook(() => useLobbyRealtime('game-1', 'ABCD'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(useGameStore.getState().game?.status).toBe('live')
    })
  })
})
