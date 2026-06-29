// Post-game narrative recap — pure functions, no React.
//
// Derives a short, shareable "highlights" summary from the append-only event
// log plus the players/teams rosters. This is intentionally tolerant of
// missing or malformed payloads: the recap should never throw, even on a
// partial event stream. All counts come straight from the events; names and
// team labels are resolved from the rosters and the seed landmark catalog.

import { getSeedLandmarkByRef } from '@/lib/landmarks'
import type { GameEvent, Player, Team } from '@/lib/types'

export interface MatchRecap {
  winnerTeamId: string | null
  mvp: { playerId: string; name: string; teamId: string; tags: number } | null
  firstBloodTeamId: string | null
  totalTags: number
  totalCaptures: number
  totalChallenges: number
  totalCurses: number
  highlights: { icon: string; text: string }[]
}

interface RecapInput {
  events: GameEvent[]
  players: Player[]
  teams: Team[]
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

// "Team West" / "Team East" from a team id, with a safe fallback.
function teamLabel(teamId: string | null, teams: Team[]): string {
  if (!teamId) return 'Team ?'
  const team = teams.find((t) => t.id === teamId)
  if (!team) return 'Team ?'
  return `Team ${team.side === 'east' ? 'East' : 'West'}`
}

function landmarkName(ref: string | null): string {
  if (!ref) return 'a landmark'
  return getSeedLandmarkByRef(ref)?.name ?? ref
}

export function computeRecap({ events, players, teams }: RecapInput): MatchRecap {
  const playerById = new Map<string, Player>()
  for (const p of players) playerById.set(p.id, p)

  let winnerTeamId: string | null = null
  let firstBloodTeamId: string | null = null
  let firstChallengeTeamId: string | null = null

  let totalTags = 0
  let totalCaptures = 0
  let totalChallenges = 0
  let totalCurses = 0

  // Tag counts keyed by defender (the tagger). Track first-seen order for ties.
  const tagsByDefender = new Map<string, number>()
  const defenderOrder: string[] = []

  // Track the first real-flag capture for a headline beat.
  let firstCaptureTeamId: string | null = null
  let firstCaptureLandmarkRef: string | null = null

  for (const ev of events) {
    const payload = ev.payload as Record<string, unknown>
    switch (ev.type) {
      case 'tag': {
        totalTags++
        const defenderId = asString(payload.defender_player_id)
        if (defenderId) {
          if (!tagsByDefender.has(defenderId)) defenderOrder.push(defenderId)
          tagsByDefender.set(defenderId, (tagsByDefender.get(defenderId) ?? 0) + 1)
        }
        break
      }
      case 'flag_attempt': {
        if (asString(payload.result) === 'real') {
          totalCaptures++
          const teamId = asString(payload.team_id)
          if (firstCaptureTeamId == null && teamId) {
            firstCaptureTeamId = teamId
            firstCaptureLandmarkRef = asString(payload.landmark_ref)
          }
        }
        break
      }
      case 'challenge_completed': {
        totalChallenges++
        const teamId = asString(payload.team_id)
        if (teamId && firstChallengeTeamId == null) firstChallengeTeamId = teamId
        if (payload.first_blood === true && teamId && firstBloodTeamId == null) {
          firstBloodTeamId = teamId
        }
        break
      }
      case 'curse_cast': {
        totalCurses++
        break
      }
      case 'game_won': {
        winnerTeamId = asString(payload.winner_team_id)
        break
      }
      default:
        break
    }
  }

  // No explicit first_blood flag seen → fall back to the earliest challenge.
  if (firstBloodTeamId == null) firstBloodTeamId = firstChallengeTeamId

  // MVP = most tags as defender; tie resolved by first-seen order.
  let mvp: MatchRecap['mvp'] = null
  let bestTags = 0
  for (const defenderId of defenderOrder) {
    const tags = tagsByDefender.get(defenderId) ?? 0
    if (tags > bestTags) {
      bestTags = tags
      const player = playerById.get(defenderId)
      mvp = {
        playerId: defenderId,
        name: player?.display_name ?? 'A defender',
        teamId: player?.team_id ?? '',
        tags,
      }
    }
  }

  // ----- Highlight beats (ordered, 4-7) -----
  const highlights: { icon: string; text: string }[] = []

  if (winnerTeamId) {
    highlights.push({
      icon: '🏆',
      text: `${teamLabel(winnerTeamId, teams)} won the match`,
    })
  }

  if (firstBloodTeamId) {
    highlights.push({
      icon: '🩸',
      text: `First blood: ${teamLabel(firstBloodTeamId, teams)}`,
    })
  }

  if (firstCaptureTeamId) {
    highlights.push({
      icon: '🚩',
      text: `${teamLabel(firstCaptureTeamId, teams)} captured the flag at ${landmarkName(firstCaptureLandmarkRef)}`,
    })
  }

  if (mvp) {
    highlights.push({
      icon: '🖐️',
      text: `${mvp.name} made the most tags (${mvp.tags})`,
    })
  }

  highlights.push({
    icon: '⚔️',
    text: `${totalTags} tags · ${totalChallenges} challenges · ${totalCurses} curses`,
  })

  if (totalCaptures > 0) {
    highlights.push({
      icon: '🎯',
      text: `${totalCaptures} flag ${totalCaptures === 1 ? 'capture' : 'captures'} this match`,
    })
  }

  return {
    winnerTeamId,
    mvp,
    firstBloodTeamId,
    totalTags,
    totalCaptures,
    totalChallenges,
    totalCurses,
    highlights,
  }
}
