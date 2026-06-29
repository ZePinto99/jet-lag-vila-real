import { renderHook } from '@testing-library/react'
import { useLiveGameRealtime } from '@/lib/hooks/useLiveGameRealtime'
import { useGameStore } from '@/store/gameStore'
import {
  makeCard,
  makeCurse,
  makeEvent,
  makeGame,
  makePlayer,
  makeTeam,
  mockSupabaseClient,
} from '../test-utils'

function emitTable(channel: {
  callbacks: Array<{
    filter: Record<string, unknown>
    callback: (payload: unknown) => void
  }>
}, table: string, payload: unknown) {
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
    expect(channel.callbacks.map((entry: { filter: Record<string, unknown> }) => entry.filter.table)).toEqual([
      'games',
      'teams',
      'players',
      'events',
      'active_curses',
      'cards',
    ])

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
      activeCurses: [makeCurse({ id: 'curse-live', target_team_id: west.id })],
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
})
