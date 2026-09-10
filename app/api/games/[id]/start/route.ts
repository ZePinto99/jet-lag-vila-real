import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Game, Player, StartGameResponse, Team } from '@/lib/types'

const StartBody = z.object({
  device_id: z.string().min(1).max(128),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_body', details: 'Body must be valid JSON.' },
      { status: 400 },
    )
  }

  const parsed = StartBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', details: parsed.error.issues },
      { status: 400 },
    )
  }
  const { device_id } = parsed.data

  const supabase = createAdminClient()

  // Load game.
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

  // Load teams (for caller membership check and all_ready computation).
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

  // Load all players to verify caller and compute all_ready.
  const { data: allPlayersData, error: allPlayersError } = await supabase
    .from('players')
    .select('*')
    .in('team_id', teamIds)

  if (allPlayersError) {
    return NextResponse.json(
      { error: 'player_lookup_failed', details: allPlayersError.message },
      { status: 500 },
    )
  }
  const allPlayers = (allPlayersData ?? []) as Player[]

  const caller = allPlayers.find((p) => p.device_id === device_id)
  if (!caller) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Idempotent: if the game is already past lobby, just return it.
  if (game.status !== 'lobby') {
    const response: StartGameResponse = { game }
    return NextResponse.json(response)
  }

  // Recompute all_ready server-side.
  const totalPlayers = allPlayers.length
  const everyReady = totalPlayers > 0 && allPlayers.every((p) => p.ready)
  const teamCounts = teams.map(
    (team) => allPlayers.filter((player) => player.team_id === team.id).length,
  )
  const validRoster =
    teams.length === 2 &&
    teamCounts.every((count) => count >= 1 && count <= 4) &&
    teamCounts[0] === teamCounts[1]
  const all_ready = everyReady && validRoster

  if (!all_ready) {
    return NextResponse.json(
      {
        error: everyReady ? 'invalid_team_sizes' : 'not_all_ready',
        ...(everyReady ? { details: { team_counts: teamCounts } } : {}),
      },
      { status: 409 },
    )
  }

  // Commit lobby -> setup and game_started together. The RPC repeats roster
  // validation under the game-row lock so a concurrent request cannot create
  // a phase transition without its append-only event.
  const { data: startData, error: startError } = await supabase.rpc(
    'start_game_setup_atomic',
    { p_game_id: game.id, p_actor_player_id: caller.id },
  )
  if (startError) {
    return NextResponse.json(
      { error: 'game_start_failed', details: startError.message },
      { status: 500 },
    )
  }
  const started = startData as { error?: string; game?: Game } | null
  if (!started?.game || started.error) {
    const error = started?.error ?? 'game_start_failed'
    const status = error === 'not_all_ready' || error === 'invalid_team_sizes'
      ? 409
      : error === 'not_found' ? 404 : 500
    return NextResponse.json({ error }, { status })
  }

  const response: StartGameResponse = { game: started.game }
  return NextResponse.json(response)
}
