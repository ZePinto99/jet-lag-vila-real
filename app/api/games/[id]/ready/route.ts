import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Game, Player, SetReadyResponse, Team } from '@/lib/types'

const ReadyBody = z.object({
  player_id: z.string().uuid(),
  device_id: z.string().min(1).max(128),
  ready: z.boolean(),
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

  const parsed = ReadyBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', details: parsed.error.issues },
      { status: 400 },
    )
  }
  const { player_id, device_id, ready } = parsed.data

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
  if (game.status !== 'lobby') {
    return NextResponse.json({ error: 'game_not_in_lobby' }, { status: 409 })
  }

  // Load teams.
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

  // Load player.
  const { data: playerRow, error: playerError } = await supabase
    .from('players')
    .select('*')
    .eq('id', player_id)
    .maybeSingle()

  if (playerError) {
    return NextResponse.json(
      { error: 'player_lookup_failed', details: playerError.message },
      { status: 500 },
    )
  }
  if (!playerRow) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const player = playerRow as Player
  if (!teamIds.includes(player.team_id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (player.device_id !== device_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Update ready flag.
  const { data: updatedPlayer, error: updateError } = await supabase
    .from('players')
    .update({ ready })
    .eq('id', player.id)
    .select()
    .single()

  if (updateError || !updatedPlayer) {
    return NextResponse.json(
      { error: 'player_update_failed', details: updateError?.message },
      { status: 500 },
    )
  }
  const me = updatedPlayer as Player

  // Recompute all_ready across the full game roster.
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

  const totalPlayers = allPlayers.length
  const everyReady = totalPlayers > 0 && allPlayers.every((p) => p.ready)
  const everyTeamHasPlayer = teams.every((t) =>
    allPlayers.some((p) => p.team_id === t.id),
  )
  const all_ready = everyReady && everyTeamHasPlayer && totalPlayers >= 2

  const response: SetReadyResponse = { player: me, all_ready }
  return NextResponse.json(response)
}
