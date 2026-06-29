import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeScores } from '@/lib/results/scoring'
import type {
  Game,
  GameEvent,
  Player,
  Team,
  TeamScore,
} from '@/lib/types'

// GET /api/games/[id]/observer-state
//
// Public (no device auth) spectator snapshot. Returns a REDACTED view of the
// game so a watching non-player can follow the board WITHOUT being able to spoil
// flag locations:
//   - landmarks for BOTH teams, but stripped to { id, ref, lat, lng, team_id }
//     (NO `kind`, NO `hardened` — the secret state stays server-side)
//   - all events (for scoring) but only the most recent 80 in the feed
//   - per-team scores via computeScores()
//
// Note: this endpoint deliberately omits cards, intel payloads, active curses
// and placed curses entirely — none of that is needed for a spectator board and
// some of it would leak private team state.

// Spectator-safe landmark: coords + ownership only.
export interface ObserverLandmark {
  id: string
  ref: string
  lat: number
  lng: number
  team_id: string | null
}

// Spectator-safe player: identity + visible status only.
export interface ObserverPlayer {
  id: string
  team_id: string
  display_name: string
  flag_carrier: boolean
  respawning: boolean
}

export interface ObserverStateResponse {
  game: Game
  teams: Team[]
  players: ObserverPlayer[]
  landmarks: ObserverLandmark[]
  recent_events: GameEvent[]
  scores: TeamScore[]
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params

  const supabase = createAdminClient()

  // 1. Load the game. 404 if absent.
  const { data: gameRow, error: gameError } = await supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
    .maybeSingle()

  if (gameError) {
    return NextResponse.json(
      { error: 'game_lookup_failed', details: gameError.message },
      { status: 500 },
    )
  }
  if (!gameRow) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const game = gameRow as Game

  // 2. Teams (all fields — coins/side are public for a scoreboard).
  const { data: teamsData, error: teamsError } = await supabase
    .from('teams')
    .select('*')
    .eq('game_id', game.id)

  if (teamsError || !teamsData) {
    return NextResponse.json(
      { error: 'team_lookup_failed', details: teamsError?.message },
      { status: 500 },
    )
  }
  const teams = teamsData as Team[]
  const teamIds = teams.map((t) => t.id)

  // 3. Players — stripped to spectator-safe fields.
  let players: ObserverPlayer[] = []
  if (teamIds.length > 0) {
    const { data: playersData, error: playersError } = await supabase
      .from('players')
      .select('id, team_id, display_name, flag_carrier, respawning')
      .in('team_id', teamIds)
      .order('created_at', { ascending: true })

    if (playersError) {
      return NextResponse.json(
        { error: 'player_lookup_failed', details: playersError.message },
        { status: 500 },
      )
    }
    players = (playersData ?? []) as ObserverPlayer[]
  }

  // 4. Landmarks for BOTH teams — stripped of kind/hardened so spectators can't
  //    spoil the real flag location.
  const { data: landmarksData, error: landmarksError } = await supabase
    .from('landmarks')
    .select('id, ref, lat, lng, team_id')
    .eq('game_id', game.id)

  if (landmarksError) {
    return NextResponse.json(
      { error: 'landmark_lookup_failed', details: landmarksError.message },
      { status: 500 },
    )
  }
  const landmarks = (landmarksData ?? []) as ObserverLandmark[]

  // 5. All events — for scoring (computeScores walks the full log). The feed
  //    below only surfaces the most recent 80.
  const { data: allEventsData, error: allEventsError } = await supabase
    .from('events')
    .select('*')
    .eq('game_id', game.id)
    .order('created_at', { ascending: true })

  if (allEventsError) {
    return NextResponse.json(
      { error: 'events_lookup_failed', details: allEventsError.message },
      { status: 500 },
    )
  }
  const allEvents = (allEventsData ?? []) as GameEvent[]

  // Most recent 80, ascending (oldest first) so the client renders the same way
  // as the Live timeline; the client reverses for newest-first display.
  const recentEvents = allEvents.slice(-80)

  // 6. Per-team scores (needs the full event log + current coin balances).
  const scores = computeScores({ events: allEvents, teams, players: players as unknown as Player[] })

  // computeScores only reads player.id + player.team_id, both present on the
  // spectator-safe shape, so the cast above is sound.

  const response: ObserverStateResponse = {
    game,
    teams,
    players,
    landmarks,
    recent_events: recentEvents,
    scores,
  }
  return NextResponse.json(response)
}
