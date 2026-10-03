import { act, renderHook, waitFor } from '@testing-library/react'
import {
  LOBBY_RECONCILE_INTERVAL_MS,
  useLobbyRealtime,
} from '@/lib/hooks/useLobbyRealtime'
import { useGameStore } from '@/store/gameStore'
import { makeGame, makePlayer, makeTeam, mockSupabaseClient } from '../test-utils'

function snapshotResponse(status: 'lobby' | 'setup' | 'live', ready = true) {
  const west = makeTeam({ id: 'west' })
  const east = makeTeam({ id: 'east', side: 'east' })
  const me = makePlayer({
    id: 'me',
    team_id: west.id,
    device_id: 'test-device-id',
    ready,
  })
  return {
    game: makeGame({ status }),
    teams: [west, east],
    players: [me],
  }
}

function deferredResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((done) => {
    resolve = done
  })
  return { promise, resolve }
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
    expect(client.channel).toHaveBeenCalledWith(
      expect.stringMatching(/^lobby:game-1:\d+$/),
    )
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

  it('recovers a missed phase event on the short lobby polling interval', async () => {
    jest.useFakeTimers()
    const lobby = snapshotResponse('lobby')
    useGameStore.setState({ ...lobby, me: lobby.players[0], isHydrated: true })
    mockSupabaseClient()
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(lobby), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(snapshotResponse('setup')), { status: 200 }),
      )
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    })

    renderHook(() => useLobbyRealtime('game-1', 'ABCD'))
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      await jest.advanceTimersByTimeAsync(LOBBY_RECONCILE_INTERVAL_MS)
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(useGameStore.getState().game?.status).toBe('setup')
  })

  it('applies a slow valid response even when a polling tick queues another read', async () => {
    jest.useFakeTimers()
    const lobby = snapshotResponse('lobby')
    const setup = snapshotResponse('setup')
    useGameStore.setState({ ...lobby, me: lobby.players[0], isHydrated: true })
    mockSupabaseClient()
    const firstResponse = deferredResponse()
    const fetchMock = jest
      .fn()
      .mockReturnValueOnce(firstResponse.promise)
      .mockResolvedValueOnce(new Response(JSON.stringify(setup), { status: 200 }))
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    })

    renderHook(() => useLobbyRealtime('game-1', 'ABCD'))
    await act(async () => {
      await jest.advanceTimersByTimeAsync(LOBBY_RECONCILE_INTERVAL_MS)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      firstResponse.resolve(new Response(JSON.stringify(setup), { status: 200 }))
      await jest.advanceTimersByTimeAsync(0)
    })

    expect(useGameStore.getState().game?.status).toBe('setup')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps one subscription when lobby hydration fills the teams array', async () => {
    const stale = snapshotResponse('lobby')
    useGameStore.setState({
      ...stale,
      teams: [],
      me: stale.players[0],
      isHydrated: true,
    })
    const client = mockSupabaseClient()
    const fetchMock = jest
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(stale), { status: 200 }))
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    })

    renderHook(() => useLobbyRealtime('game-1', 'ABCD'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    act(() => {
      useGameStore.getState().setSnapshot({ ...stale, me: stale.players[0] })
    })

    expect(client.channel).toHaveBeenCalledTimes(1)
    expect(client.removeChannel).not.toHaveBeenCalled()
  })

  it('does not let an older snapshot overwrite newer ready and phase events', async () => {
    const stale = snapshotResponse('lobby', false)
    useGameStore.setState({ ...stale, me: stale.players[0], isHydrated: true })
    const client = mockSupabaseClient()
    const firstResponse = deferredResponse()
    const fresh = snapshotResponse('setup', true)
    const fetchMock = jest
      .fn()
      .mockReturnValueOnce(firstResponse.promise)
      .mockResolvedValueOnce(new Response(JSON.stringify(fresh), { status: 200 }))
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    })

    renderHook(() => useLobbyRealtime('game-1', 'ABCD'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const channel = client.channel.mock.results[0]?.value
    const callbacks = channel.callbacks as Array<{
      type: string
      filter: Record<string, unknown>
      callback: (payload?: unknown) => void
    }>
    const gameHandler = callbacks.find(
      (entry) => entry.type === 'postgres_changes' && entry.filter.table === 'games',
    )?.callback
    const playerHandler = callbacks.find(
      (entry) => entry.type === 'postgres_changes' && entry.filter.table === 'players',
    )?.callback
    expect(gameHandler).toBeDefined()
    expect(playerHandler).toBeDefined()

    act(() => {
      gameHandler?.({ eventType: 'UPDATE', new: fresh.game })
      playerHandler?.({ eventType: 'UPDATE', new: fresh.players[0] })
    })
    expect(useGameStore.getState().game?.status).toBe('setup')
    expect(useGameStore.getState().players[0]?.ready).toBe(true)

    act(() => {
      firstResponse.resolve(new Response(JSON.stringify(stale), { status: 200 }))
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(useGameStore.getState().game?.status).toBe('setup')
      expect(useGameStore.getState().players[0]?.ready).toBe(true)
    })
  })

  it('ignores a late event from a channel that has already been cleaned up', async () => {
    const lobby = snapshotResponse('lobby')
    useGameStore.setState({ ...lobby, me: lobby.players[0], isHydrated: true })
    const client = mockSupabaseClient()
    const fetchMock = jest
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(lobby), { status: 200 }))
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    })

    const { unmount } = renderHook(() => useLobbyRealtime('game-1', 'ABCD'))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const channel = client.channel.mock.results[0]?.value
    const gameHandler = channel.callbacks.find(
      (entry: { type: string; filter: Record<string, unknown> }) =>
        entry.type === 'postgres_changes' && entry.filter.table === 'games',
    )?.callback
    expect(gameHandler).toBeDefined()

    unmount()
    act(() => {
      gameHandler?.({ eventType: 'UPDATE', new: snapshotResponse('setup').game })
    })

    expect(useGameStore.getState().game?.status).toBe('lobby')
  })
})
