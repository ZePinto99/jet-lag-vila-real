import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import type {
  Game,
  JoinGameResponse,
  Player,
  Team,
  TeamSide,
} from '@/lib/types'

const sideEnum = z.enum(['west', 'east']) satisfies z.ZodType<TeamSide>

const JoinBody = z.object({
  display_name: z.string().min(1).max(40),
  device_id: z.string().min(1).max(128),
  preferred_side: sideEnum.optional(),
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

  const parsed = JoinBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', details: parsed.error.issues },
      { status: 400 },
    )
  }
  const { display_name, device_id, preferred_side } = parsed.data

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
  if (teams.length < 2) {
    return NextResponse.json({ error: 'teams_missing' }, { status: 500 })
  }
  const teamIds = teams.map((t) => t.id)

  // Load all players for the game.
  const { data: playersData, error: playersError } = await supabase
    .from('players')
    .select('*')
    .in('team_id', teamIds)
    .order('created_at', { ascending: true })

  if (playersError) {
    return NextResponse.json(
      { error: 'player_lookup_failed', details: playersError.message },
      { status: 500 },
    )
  }
  const existingPlayers = (playersData ?? []) as Player[]

  // Idempotency: if this device already joined, return the existing snapshot.
  const existingMe = existingPlayers.find((p) => p.device_id === device_id)
  if (existingMe) {
    const response: JoinGameResponse = {
      game,
      teams,
      players: existingPlayers,
      me: existingMe,
    }
    return NextResponse.json(response)
  }

  // Determine target team: preferred_side wins; else auto-assign to smaller
  // team, tiebreaking on 'west'.
  let targetTeam: Team | undefined
  if (preferred_side) {
    targetTeam = teams.find((t) => t.side === preferred_side)
  } else {
    const westTeam = teams.find((t) => t.side === 'west')
    const eastTeam = teams.find((t) => t.side === 'east')
    if (!westTeam || !eastTeam) {
      return NextResponse.json({ error: 'teams_missing' }, { status: 500 })
    }
    const westCount = existingPlayers.filter((p) => p.team_id === westTeam.id).length
    const eastCount = existingPlayers.filter((p) => p.team_id === eastTeam.id).length
    targetTeam = eastCount < westCount ? eastTeam : westTeam
  }

  if (!targetTeam) {
    return NextResponse.json({ error: 'team_lookup_failed' }, { status: 500 })
  }

  // Insert new player.
  const { data: insertedPlayer, error: insertError } = await supabase
    .from('players')
    .insert({
      team_id: targetTeam.id,
      display_name,
      device_id,
      role: 'player',
      ready: false,
      flag_carrier: false,
    })
    .select()
    .single()

  if (insertError || !insertedPlayer) {
    return NextResponse.json(
      { error: 'player_insert_failed', details: insertError?.message },
      { status: 500 },
    )
  }
  const me = insertedPlayer as Player

  // Emit player_joined event.
  const { error: eventError } = await supabase.from('events').insert({
    game_id: game.id,
    type: 'player_joined',
    actor_player_id: me.id,
    payload: { player_id: me.id, team_id: targetTeam.id },
  })
  if (eventError) {
    return NextResponse.json(
      { error: 'event_insert_failed', details: eventError.message },
      { status: 500 },
    )
  }

  const players: Player[] = [...existingPlayers, me]
  const response: JoinGameResponse = { game, teams, players, me }
  return NextResponse.json(response, { status: 201 })
}
