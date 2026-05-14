import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateGameCode } from '@/lib/codes'
import type {
  CreateGameResponse,
  Game,
  Player,
  Team,
  TeamSide,
} from '@/lib/types'

const sideEnum = z.enum(['west', 'east']) satisfies z.ZodType<TeamSide>

const CreateGameBody = z.object({
  display_name: z.string().min(1).max(40),
  device_id: z.string().min(1).max(128),
  preferred_side: sideEnum.optional(),
})

const MAX_CODE_ATTEMPTS = 5

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_body', details: 'Body must be valid JSON.' },
      { status: 400 },
    )
  }

  const parsed = CreateGameBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', details: parsed.error.issues },
      { status: 400 },
    )
  }

  const { display_name, device_id } = parsed.data
  const preferred_side: TeamSide = parsed.data.preferred_side ?? 'west'

  const supabase = createAdminClient()

  // 1. Insert game with a unique code. Retry on unique-violation collisions.
  let game: Game | null = null
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateGameCode()
    const { data, error } = await supabase
      .from('games')
      .insert({ code, status: 'lobby', config: {} })
      .select()
      .single()

    if (!error && data) {
      game = data as Game
      break
    }
    // 23505 = unique_violation. Retry on collision; bail on anything else.
    if (error && error.code !== '23505') {
      return NextResponse.json(
        { error: 'game_insert_failed', details: error.message },
        { status: 500 },
      )
    }
  }

  if (!game) {
    return NextResponse.json(
      { error: 'code_generation_exhausted' },
      { status: 500 },
    )
  }

  // 2. Insert the two teams with their home-base seed refs (RULEBOOK §3.2).
  const { data: teamsData, error: teamsError } = await supabase
    .from('teams')
    .insert([
      {
        game_id: game.id,
        name: 'Team West',
        side: 'west',
        coins: 100,
        home_landmark_id: 'landmark.utad-main-library',
      },
      {
        game_id: game.id,
        name: 'Team East',
        side: 'east',
        coins: 100,
        home_landmark_id: 'landmark.palacio-de-mateus-main-gate',
      },
    ])
    .select()

  if (teamsError || !teamsData) {
    return NextResponse.json(
      { error: 'team_insert_failed', details: teamsError?.message },
      { status: 500 },
    )
  }

  const teams = teamsData as Team[]
  const targetTeam = teams.find((t) => t.side === preferred_side)
  if (!targetTeam) {
    return NextResponse.json(
      { error: 'team_lookup_failed' },
      { status: 500 },
    )
  }

  // 3. Insert the creator as the first player on their preferred side.
  //    The creator is the host for this game.
  const { data: playerData, error: playerError } = await supabase
    .from('players')
    .insert({
      team_id: targetTeam.id,
      display_name,
      device_id,
      role: 'player',
      ready: false,
      flag_carrier: false,
      is_host: true,
    })
    .select()
    .single()

  if (playerError || !playerData) {
    return NextResponse.json(
      { error: 'player_insert_failed', details: playerError?.message },
      { status: 500 },
    )
  }

  const me = playerData as Player

  // 4. Emit player_joined event (append-only).
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

  const response: CreateGameResponse = {
    game,
    teams,
    players: [me],
    me,
  }
  return NextResponse.json(response, { status: 201 })
}
