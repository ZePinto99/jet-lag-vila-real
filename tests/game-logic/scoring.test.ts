/** @jest-environment node */

import { computeScores, pickTimeoutWinner } from '@/lib/results/scoring'
import { makeEvent, makePlayer, makeTeam } from '../test-utils'

describe('results scoring', () => {
  const west = makeTeam({ id: 'west', side: 'west', coins: 125 })
  const east = makeTeam({ id: 'east', side: 'east', coins: 40 })
  const westPlayer = makePlayer({ id: 'west-player', team_id: west.id })
  const eastPlayer = makePlayer({ id: 'east-player', team_id: east.id })

  it('scores flags, challenges, tags, curses, and remaining coins', () => {
    // RULEBOOK §13.2: timeout scoring uses flag, challenges, tags, curses, and coins.
    const scores = computeScores({
      teams: [west, east],
      players: [westPlayer, eastPlayer],
      events: [
        makeEvent({ type: 'flag_attempt', payload: { result: 'real', team_id: west.id } }),
        makeEvent({ id: 'c1', type: 'challenge_completed', payload: { team_id: west.id } }),
        makeEvent({ id: 'c2', type: 'challenge_completed', payload: { team_id: west.id } }),
        makeEvent({ id: 't1', type: 'tag', payload: { defender_player_id: eastPlayer.id } }),
        makeEvent({ id: 'x1', type: 'curse_cast', payload: { buyer_team_id: east.id } }),
      ],
    })

    expect(scores.find((s) => s.team_id === west.id)).toMatchObject({
      flag_points: 10,
      challenge_points: 2,
      tag_points: 0,
      curse_points: 0,
      coin_points: 2,
      total: 14,
    })
    expect(scores.find((s) => s.team_id === east.id)).toMatchObject({
      tag_points: 1,
      curse_points: 0.5,
      coin_points: 0,
      total: 1.5,
    })
  })

  it('picks the total-points winner first', () => {
    expect(
      pickTimeoutWinner([
        { ...computeScores({ teams: [west], players: [], events: [] })[0], total: 4 },
        { ...computeScores({ teams: [east], players: [], events: [] })[0], total: 3 },
      ]),
    ).toEqual({ winner_team_id: west.id, reason: 'timeout_points' })
  })

  it('uses challenge and coin tiebreakers before declaring a tie', () => {
    const baseA = computeScores({ teams: [west], players: [], events: [] })[0]
    const baseB = computeScores({ teams: [east], players: [], events: [] })[0]

    expect(
      pickTimeoutWinner([
        { ...baseA, total: 4, challenges_completed: 1, coins_remaining: 0 },
        { ...baseB, total: 4, challenges_completed: 2, coins_remaining: 0 },
      ]),
    ).toEqual({ winner_team_id: east.id, reason: 'timeout_tiebreaker' })

    expect(
      pickTimeoutWinner([
        { ...baseA, total: 4, challenges_completed: 1, coins_remaining: 100 },
        { ...baseB, total: 4, challenges_completed: 1, coins_remaining: 150 },
      ]),
    ).toEqual({ winner_team_id: east.id, reason: 'timeout_tiebreaker' })

    expect(
      pickTimeoutWinner([
        { ...baseA, total: 4, challenges_completed: 1, coins_remaining: 100 },
        { ...baseB, total: 4, challenges_completed: 1, coins_remaining: 100 },
      ]),
    ).toEqual({ winner_team_id: null, reason: 'timeout_tied' })
  })
})
