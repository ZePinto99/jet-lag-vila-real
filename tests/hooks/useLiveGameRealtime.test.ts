import { act, renderHook, waitFor } from '@testing-library/react'
import { useLiveGameRealtime } from '@/lib/hooks/useLiveGameRealtime'
import { useGameStore } from '@/store/gameStore'
import {
  makeCard,
  makeCurse,
  makeEvent,
  makeGame,
  makeLandmark,
  makePlayer,
  makeTeam,
  mockSupabaseClient,
} from '../test-utils'

function emitTable(
  channel: {
    callbacks: Array<{
      filter: Record<string, unknown>
      callback: (payload: unknown) => void
    }>
  },
  table: string,
  payload: unknown,
) {
  const callback = channel.callbacks.find((entry) => entry.filter.table === table)
  if (!callback) throw new Error(`No realtime callback for table ${table}`)
  callback.callback(payload)
}

describe('useLiveGameRealtime', () => {
  it('subscribes to live game tables and mutates the Zustand store', () => {
    const west = makeTeam({ id: 'west' })
    const east = makeTeam({ id: 'east', side: 'east' })
    useGameStore.setState({ teams: [west, east] })
    const client = mockSupabaseClient()

    renderHook(() => useLiveGameRealtime('game-1', west.id))

    expect(client.channel).toHaveBeenCalledWith('live:game-1')
    const channel = client.channel.mock.results[0].value
    expect(
      channel.callbacks.map((entry: { filter: Record<string, unknown> }) => entry.filter.table),
    ).toEqual(['games', 'teams', 'players', 'events', 'active_curses', 'cards'])

    const game = makeGame({ status: 'flag_found' })
    emitTable(channel, 'games', { eventType: 'UPDATE', new: game })
    expect(useGameStore.getState().game?.status).toBe('flag_found')

    const updatedWest = makeTeam({ id: west.id, coins: 75 })
    emitTable(channel, 'teams', { eventType: 'UPDATE', new: updatedWest })
    expect(useGameStore.getState().teams.find((t) => t.id === west.id)?.coins).toBe(75)

    const player = makePlayer({ id: 'player-1', team_id: west.id, respawning: true })
    emitTable(channel, 'players', { eventType: 'UPDATE', new: player })
    expect(useGameStore.getState().players.find((p) => p.id === player.id)?.respawning).toBe(true)

    emitTable(channel, 'events', { eventType: 'INSERT', new: makeEvent({ id: 'event-live' }) })
    expect(useGameStore.getState().events.map((e) => e.id)).toContain('event-live')

    const curse = makeCurse({ id: 'curse-live', target_team_id: west.id })
    emitTable(channel, 'active_curses', { eventType: 'INSERT', new: curse })
    expect(useGameStore.getState().activeCurses.map((c) => c.id)).toContain('curse-live')

    const card = makeCard({ id: 'card-live', team_id: west.id })
    emitTable(channel, 'cards', { eventType: 'INSERT', new: card })
    expect(useGameStore.getState().myCards.map((c) => c.id)).toContain('card-live')
  })

  it('filters player and curse updates to the current game/team and removes deleted rows', () => {
    const west = makeTeam({ id: 'west' })
    useGameStore.setState({
      teams: [west],
      activeCurses: [
        makeCurse({ id: 'curse-event', target_team_id: west.id }),
        makeCurse({ id: 'curse-live', target_team_id: west.id }),
      ],
      myCards: [makeCard({ id: 'card-live', team_id: west.id })],
    })
    const client = mockSupabaseClient()

    renderHook(() => useLiveGameRealtime('game-1', west.id))
    const channel = client.channel.mock.results[0].value

    emitTable(channel, 'players', {
      eventType: 'UPDATE',
      new: makePlayer({ id: 'outsider', team_id: 'other-team' }),
    })
    expect(useGameStore.getState().players).toHaveLength(0)

    emitTable(channel, 'active_curses', {
      eventType: 'INSERT',
      new: makeCurse({ id: 'enemy-curse', target_team_id: 'east' }),
    })
    expect(useGameStore.getState().activeCurses.map((c) => c.id)).not.toContain('enemy-curse')

    emitTable(channel, 'events', {
      eventType: 'INSERT',
      new: makeEvent({
        id: 'curse-expired-event',
        type: 'curse_expired',
        payload: { curse_id: 'curse-event', target_team_id: west.id },
      }),
    })
    expect(useGameStore.getState().activeCurses.map((c) => c.id)).not.toContain('curse-event')

    emitTable(channel, 'active_curses', {
      eventType: 'DELETE',
      old: { id: 'curse-live' },
    })
    expect(useGameStore.getState().activeCurses).toHaveLength(0)

    emitTable(channel, 'cards', {
      eventType: 'DELETE',
      old: { id: 'card-live' },
    })
    expect(useGameStore.getState().myCards).toHaveLength(0)
  })

  it('reconciles team-private hardening and placed-curse state from scoped events', async () => {
    const west = makeTeam({ id: 'west' })
    const east = makeTeam({ id: 'east', side: 'east' })
    const me = makePlayer({ id: 'player-1', team_id: west.id })
    const hardened = makeLandmark({ id: 'flag-row', team_id: west.id, hardened: true })
    const placement = {
      id: 'placed-1',
      game_id: 'game-1',
      owner_team_id: west.id,
      landmark_ref: 'landmark.miradouro-vila-velha',
      placed_ref: 'placed.tripwire',
      curse_ref: 'curse.slow-walk',
      armed: true,
      created_at: '2026-06-18T12:00:00.000Z',
      triggered_at: null,
      triggered_by_team_id: null,
    }
    useGameStore.setState({ game: makeGame(), teams: [west, east], players: [me], me })
    const client = mockSupabaseClient()
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          game: makeGame(),
          teams: [west, east],
          players: [me],
          my_team_landmarks: [hardened],
          enemy_landmarks: [],
          active_curses: [],
          my_cards: [],
          my_placed_curses: [placement],
          recent_events: [],
        }),
        { status: 200 },
      ),
    )
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    })

    renderHook(() => useLiveGameRealtime('game-1', west.id))
    const channel = client.channel.mock.results[0].value
    emitTable(channel, 'events', {
      eventType: 'INSERT',
      new: makeEvent({
        id: 'hardened-event',
        type: 'flag_hardened',
        payload: { team_id: west.id },
      }),
    })

    await waitFor(() => {
      expect(useGameStore.getState().myTeamLandmarks[0]?.hardened).toBe(true)
      expect(useGameStore.getState().myPlacedCurses[0]?.id).toBe('placed-1')
    })

    fetchMock.mockClear()
    emitTable(channel, 'events', {
      eventType: 'INSERT',
      new: makeEvent({
        id: 'enemy-placement-event',
        type: 'placed_curse_triggered',
        payload: { owner_team_id: east.id },
      }),
    })
    expect(fetchMock).not.toHaveBeenCalled()

    emitTable(channel, 'events', {
      eventType: 'INSERT',
      new: makeEvent({
        id: 'own-placement-event',
        type: 'placed_curse_triggered',
        payload: { owner_team_id: west.id },
      }),
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    fetchMock.mockClear()
    emitTable(channel, 'events', {
      eventType: 'INSERT',
      new: makeEvent({ id: 'resume-event', type: 'game_resumed', payload: {} }),
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
  })

  it('reconciles missed events when realtime reconnects', async () => {
    const west = makeTeam({ id: 'west' })
    const east = makeTeam({ id: 'east', side: 'east' })
    const me = makePlayer({ id: 'player-1', team_id: west.id })
    const missed = makeEvent({ id: 'event-missed' })
    useGameStore.setState({ game: makeGame(), teams: [west, east], players: [me], me })
    const client = mockSupabaseClient()
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          game: makeGame(),
          teams: [west, east],
          players: [me],
          my_team_landmarks: [],
          enemy_landmarks: [],
          active_curses: [],
          my_cards: [],
          my_placed_curses: [],
          recent_events: [missed],
        }),
        { status: 200 },
      ),
    )
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    })

    renderHook(() => useLiveGameRealtime('game-1', west.id))
    const channel = client.channel.mock.results[0].value
    const statusCallback = channel.subscribe.mock.calls[0][0]

    act(() => statusCallback?.('SUBSCRIBED'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/games/game-1/live-state?device_id=test-device-id',
        expect.objectContaining({ method: 'GET' }),
      )
      expect(useGameStore.getState().events.map((event) => event.id)).toContain(missed.id)
    })
  })

  it('reconciles surroundings intel instead of storing its private object path', async () => {
    const west = makeTeam({ id: 'west' })
    const east = makeTeam({ id: 'east', side: 'east' })
    const me = makePlayer({ id: 'player-1', team_id: west.id })
    const signed = makeCard({
      id: 'surroundings-card',
      team_id: west.id,
      ref: 'intel.surroundings',
      payload: {
        intel_ref: 'intel.surroundings',
        photo_url: 'https://signed.test/photo',
      },
    })
    useGameStore.setState({ game: makeGame(), teams: [west, east], players: [me], me })
    const client = mockSupabaseClient()
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          game: makeGame(),
          teams: [west, east],
          players: [me],
          my_team_landmarks: [],
          enemy_landmarks: [],
          active_curses: [],
          my_cards: [signed],
          my_placed_curses: [],
          recent_events: [],
        }),
        { status: 200 },
      ),
    )
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    })

    renderHook(() => useLiveGameRealtime('game-1', west.id))
    const channel = client.channel.mock.results[0].value
    emitTable(channel, 'cards', {
      eventType: 'INSERT',
      new: {
        ...signed,
        payload: {
          intel_ref: 'intel.surroundings',
          object_path: 'private/game/team/real.jpg',
        },
      },
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled()
      const stored = useGameStore.getState().myCards.find((card) => card.id === signed.id)
      expect(stored?.payload).toEqual(signed.payload)
      expect(stored?.payload).not.toHaveProperty('object_path')
    })
  })
})
