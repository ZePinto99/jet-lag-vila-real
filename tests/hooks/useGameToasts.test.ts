import { act, renderHook } from '@testing-library/react'
import { useGameToasts } from '@/lib/hooks/useGameToasts'
import { makeEvent, makePlayer } from '../test-utils'
import type { GameEvent } from '@/lib/types'

// The notification layer had NO test file at all, which is how `flag_carrier_stripped`
// came to be emitted by two migrations (0053, 0055) and consumed by nothing — a
// tagged carrier walked all the way home before discovering the run was over.
//
// These tests pin the strip notification specifically: both teams must be told,
// because it changes what each of them should do next.

const WEST = 'team-west'
const EAST = 'team-east'
const ME = 'p-me'
const MATE = 'p-mate'

const players = [
  makePlayer({ id: ME, team_id: WEST, display_name: 'Ana' }),
  makePlayer({ id: MATE, team_id: WEST, display_name: 'Bruno' }),
  makePlayer({ id: 'p-enemy', team_id: EAST, display_name: 'Carla' }),
]

// Identity `t` so assertions read against message KEYS, not copy — this test
// should not break when the wording is polished.
const t = ((key: string, vars?: Record<string, string | number>) =>
  vars ? `${key}:${JSON.stringify(vars)}` : key) as never

function run(myPlayerId: string, myTeamId: string, extra: GameEvent[]) {
  const hook = renderHook(
    ({ events }: { events: GameEvent[] }) =>
      useGameToasts({
        events,
        myTeamId,
        myPlayerId,
        players,
        presence: {},
        myTeamLandmarks: [],
        ready: true,
        t,
      } as never),
    // Start empty so the hook seeds, then push the real events — otherwise the
    // seed pass swallows them as history (the F20 replay guard).
    { initialProps: { events: [] as GameEvent[] } },
  )
  act(() => {
    hook.rerender({ events: extra })
  })
  return hook
}

const stripEvent = (playerId: string, teamId: string) =>
  makeEvent({
    id: 'ev-strip',
    type: 'flag_carrier_stripped',
    actor_player_id: 'p-enemy',
    payload: { player_id: playerId, team_id: teamId, defender_player_id: 'p-enemy' },
  }) as GameEvent

describe('useGameToasts — flag_carrier_stripped (P2 / migration 0053)', () => {
  it('tells the carrier THEY dropped the flag', () => {
    const { result } = run(ME, WEST, [stripEvent(ME, WEST)])
    expect(result.current.toasts.map((x) => x.text)).toContain('toast.you_lost_the_flag')
    expect(result.current.toasts[0].tone).toBe('alert')
  })

  it('tells a teammate WHO dropped it, so the team knows to re-photograph', () => {
    const { result } = run(ME, WEST, [stripEvent(MATE, WEST)])
    expect(result.current.toasts[0].text).toBe(
      'toast.teammate_lost_the_flag:{"player":"Bruno"}',
    )
  })

  it('tells the DEFENDING team their interception worked', () => {
    const { result } = run('p-enemy', EAST, [stripEvent(ME, WEST)])
    expect(result.current.toasts.map((x) => x.text)).toContain(
      'toast.we_stripped_the_flag',
    )
  })

  it('does not replay a historical strip as a toast on load (F20)', () => {
    const { result } = renderHook(() =>
      useGameToasts({
        events: [stripEvent(ME, WEST)],
        myTeamId: WEST,
        myPlayerId: ME,
        players,
        presence: {},
        myTeamLandmarks: [],
        ready: true,
        t,
      } as never),
    )
    expect(result.current.toasts).toHaveLength(0)
  })

  it('emits nothing before the hook is ready', () => {
    const { result } = renderHook(() =>
      useGameToasts({
        events: [stripEvent(ME, WEST)],
        myTeamId: WEST,
        myPlayerId: ME,
        players,
        presence: {},
        myTeamLandmarks: [],
        ready: false,
        t,
      } as never),
    )
    expect(result.current.toasts).toHaveLength(0)
  })
})
