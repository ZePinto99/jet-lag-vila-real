// Per-team scoring per RULEBOOK §13.2 tiebreaker.
//
// Computed purely from the event log + current team coin balances + the
// players roster (needed for tag attribution, since `tag` events carry
// player_ids rather than team_ids).
//
// Server uses the same logic in /end-by-timeout to declare the winner; the
// client uses it to render the results breakdown.

import type { GameEvent, Player, Team, TeamScore } from '@/lib/types'

const FLAG_PTS = 10
const CHALLENGE_PTS = 1
const TAG_PTS = 1
const CURSE_PTS = 0.5
const COINS_PER_POINT = 50

interface ScoringInput {
  events: GameEvent[]
  teams: Team[]
  players: Player[]
}

export function computeScores({ events, teams, players }: ScoringInput): TeamScore[] {
  const playerTeam = new Map<string, string>()
  for (const p of players) playerTeam.set(p.id, p.team_id)

  const byTeam = new Map<string, TeamScore>()
  for (const team of teams) {
    byTeam.set(team.id, {
      team_id: team.id,
      team_side: team.side,
      found_real_flag: false,
      challenges_completed: 0,
      tags_made: 0,
      curses_cast: 0,
      coins_remaining: team.coins,
      flag_points: 0,
      challenge_points: 0,
      tag_points: 0,
      curse_points: 0,
      coin_points: 0,
      total: 0,
    })
  }

  for (const ev of events) {
    switch (ev.type) {
      case 'flag_attempt': {
        const p = ev.payload as { result?: string; team_id?: string }
        if (p.result === 'real' && p.team_id) {
          const s = byTeam.get(p.team_id)
          if (s) s.found_real_flag = true
        }
        break
      }
      case 'challenge_completed': {
        const p = ev.payload as { team_id?: string }
        if (p.team_id) {
          const s = byTeam.get(p.team_id)
          if (s) s.challenges_completed++
        }
        break
      }
      case 'tag': {
        const p = ev.payload as { defender_player_id?: string }
        if (p.defender_player_id) {
          const tid = playerTeam.get(p.defender_player_id)
          if (tid) {
            const s = byTeam.get(tid)
            if (s) s.tags_made++
          }
        }
        break
      }
      case 'curse_cast': {
        const p = ev.payload as { buyer_team_id?: string }
        if (p.buyer_team_id) {
          const s = byTeam.get(p.buyer_team_id)
          if (s) s.curses_cast++
        }
        break
      }
    }
  }

  for (const s of byTeam.values()) {
    s.flag_points = s.found_real_flag ? FLAG_PTS : 0
    s.challenge_points = s.challenges_completed * CHALLENGE_PTS
    s.tag_points = s.tags_made * TAG_PTS
    s.curse_points = s.curses_cast * CURSE_PTS
    s.coin_points = Math.floor(s.coins_remaining / COINS_PER_POINT)
    s.total =
      s.flag_points +
      s.challenge_points +
      s.tag_points +
      s.curse_points +
      s.coin_points
  }

  return Array.from(byTeam.values())
}

// Determine the winner from scores. Returns null if every tiebreaker is tied.
export function pickTimeoutWinner(scores: TeamScore[]): {
  winner_team_id: string | null
  reason: 'timeout_points' | 'timeout_tiebreaker' | 'timeout_tied'
} {
  if (scores.length < 2) {
    return { winner_team_id: scores[0]?.team_id ?? null, reason: 'timeout_points' }
  }
  const [a, b] = scores
  if (a.total !== b.total) {
    return { winner_team_id: a.total > b.total ? a.team_id : b.team_id, reason: 'timeout_points' }
  }
  if (a.challenges_completed !== b.challenges_completed) {
    return {
      winner_team_id:
        a.challenges_completed > b.challenges_completed ? a.team_id : b.team_id,
      reason: 'timeout_tiebreaker',
    }
  }
  if (a.coins_remaining !== b.coins_remaining) {
    return {
      winner_team_id: a.coins_remaining > b.coins_remaining ? a.team_id : b.team_id,
      reason: 'timeout_tiebreaker',
    }
  }
  return { winner_team_id: null, reason: 'timeout_tied' }
}
