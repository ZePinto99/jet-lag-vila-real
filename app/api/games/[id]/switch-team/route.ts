import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Game, Player, SwitchTeamResponse, Team } from '@/lib/types'

const SwitchBody = z.object({
  player_id: z.string().uuid(),
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

  const parsed = SwitchBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', details: parsed.error.issues },
      { status: 400 },
    )
  }
  const { player_id, device_id } = parsed.data

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

  // Load teams for this game.
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

  // Load player and verify they belong to this game.
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

  // Security: caller's device must own this player.
  if (player.device_id !== device_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  if (player.ready) {
    return NextResponse.json({ error: 'player_ready' }, { status: 409 })
  }

  const currentTeam = teams.find((t) => t.id === player.team_id)
  if (!currentTeam) {
    return NextResponse.json({ error: 'team_lookup_failed' }, { status: 500 })
  }
  const otherSide = currentTeam.side === 'west' ? 'east' : 'west'
  const otherTeam = teams.find((t) => t.side === otherSide)
  if (!otherTeam) {
    return NextResponse.json({ error: 'team_lookup_failed' }, { status: 500 })
  }

  const { data: updatedPlayer, error: updateError } = await supabase
    .from('players')
    .update({ team_id: otherTeam.id })
    .eq('id', player.id)
    .select()
    .single()

  if (updateError || !updatedPlayer) {
    return NextResponse.json(
      { error: 'player_update_failed', details: updateError?.message },
      { status: 500 },
    )
  }

  const response: SwitchTeamResponse = {
    player: updatedPlayer as Player,
    team: otherTeam,
  }
  return NextResponse.json(response)
}
