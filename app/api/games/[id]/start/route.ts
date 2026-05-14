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
  const everyTeamHasPlayer = teams.every((t) =>
    allPlayers.some((p) => p.team_id === t.id),
  )
  const all_ready = everyReady && everyTeamHasPlayer && totalPlayers >= 2

  if (!all_ready) {
    return NextResponse.json({ error: 'not_all_ready' }, { status: 409 })
  }

  // Transition lobby -> setup. We do NOT set started_at here; the 3-hour
  // game timer begins when both teams complete flag setup and we transition
  // setup -> live (handled by the flag-setup route).
  const { data: updatedGameRow, error: updateError } = await supabase
    .from('games')
    .update({ status: 'setup' })
    .eq('id', game.id)
    .eq('status', 'lobby') // optimistic guard: only transition from lobby
    .select()
    .maybeSingle()

  if (updateError) {
    return NextResponse.json(
      { error: 'game_update_failed', details: updateError.message },
      { status: 500 },
    )
  }
  if (!updatedGameRow) {
    // Lost the race: someone else transitioned the game. Re-fetch and return.
    const { data: refetched, error: refetchError } = await supabase
      .from('games')
      .select('*')
      .eq('id', game.id)
      .maybeSingle()
    if (refetchError || !refetched) {
      return NextResponse.json(
        { error: 'game_update_failed' },
        { status: 500 },
      )
    }
    const response: StartGameResponse = { game: refetched as Game }
    return NextResponse.json(response)
  }
  const updatedGame = updatedGameRow as Game

  // Emit game_started event.
  const { error: eventError } = await supabase.from('events').insert({
    game_id: updatedGame.id,
    type: 'game_started',
    actor_player_id: caller.id,
    payload: {},
  })
  if (eventError) {
    return NextResponse.json(
      { error: 'event_insert_failed', details: eventError.message },
      { status: 500 },
    )
  }

  const response: StartGameResponse = { game: updatedGame }
  return NextResponse.json(response)
}
