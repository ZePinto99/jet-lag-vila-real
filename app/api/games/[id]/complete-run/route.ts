import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { haversineMeters } from '@/lib/geo/haversine'
import { getSeedLandmarkByRef } from '@/lib/landmarks'
import type {
  CompleteRunResponse,
  Game,
  Player,
  Team,
} from '@/lib/types'

// RULEBOOK §13: flag carrier must cross the home-base geofence (30 m, see
// ARCHITECTURE §8) to trigger the win.
const HOME_BASE_RANGE_M = 30

const GpsPositionSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number(),
  updated_at: z.number(),
})

const CompleteRunRequestSchema = z.object({
  device_id: z.string().min(1).max(128),
  player_id: z.string().uuid(),
  pos: GpsPositionSchema,
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

  const parsed = CompleteRunRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', details: parsed.error.issues },
      { status: 400 },
    )
  }
  const { device_id, player_id, pos } = parsed.data

  const supabase = createAdminClient()

  // 1. Load game. 404 if absent.
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
  let game = gameRow as Game

  // 2. Game must be in 'flag_found'.
  if (game.status !== 'flag_found') {
    return NextResponse.json(
      { error: 'game_not_in_flag_found' },
      { status: 409 },
    )
  }

  // 3. Identify caller via device_id + assert player_id and flag_carrier.
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
  if (teamIds.length === 0) {
    return NextResponse.json({ error: 'not_flag_carrier' }, { status: 403 })
  }

  const { data: playersData, error: playersError } = await supabase
    .from('players')
    .select('*')
    .in('team_id', teamIds)
    .eq('device_id', device_id)

  if (playersError) {
    return NextResponse.json(
      { error: 'player_lookup_failed', details: playersError.message },
      { status: 500 },
    )
  }
  const caller = (playersData ?? [])[0] as Player | undefined
  if (!caller || caller.id !== player_id || !caller.flag_carrier) {
    return NextResponse.json({ error: 'not_flag_carrier' }, { status: 403 })
  }

  // 4. Resolve caller's team's home base from the seed catalog.
  const team = teams.find((t) => t.id === caller.team_id)
  if (!team) {
    return NextResponse.json({ error: 'home_base_missing' }, { status: 500 })
  }
  if (!team.home_landmark_id) {
    return NextResponse.json({ error: 'home_base_missing' }, { status: 500 })
  }
  const homeSeed = getSeedLandmarkByRef(team.home_landmark_id)
  if (!homeSeed) {
    return NextResponse.json({ error: 'home_base_missing' }, { status: 500 })
  }

  const distance_m = haversineMeters(pos, {
    lat: homeSeed.lat,
    lng: homeSeed.lng,
  })
  if (distance_m > HOME_BASE_RANGE_M) {
    return NextResponse.json(
      { error: 'not_at_home_base', details: { distance_m } },
      { status: 409 },
    )
  }

  // 5. Transition status='flag_found' → 'finished' atomically.
  const endedAt = new Date().toISOString()
  const { data: updatedGameRow, error: gameUpdateError } = await supabase
    .from('games')
    .update({ status: 'finished', ended_at: endedAt })
    .eq('id', game.id)
    .eq('status', 'flag_found')
    .select()
    .maybeSingle()

  if (gameUpdateError) {
    return NextResponse.json(
      { error: 'game_update_failed', details: gameUpdateError.message },
      { status: 500 },
    )
  }

  if (!updatedGameRow) {
    // Lost the race (already finished). Re-fetch and short-circuit without
    // appending a duplicate game_won event.
    const { data: refetched, error: refetchError } = await supabase
      .from('games')
      .select('*')
      .eq('id', game.id)
      .maybeSingle()
    if (refetchError || !refetched) {
      return NextResponse.json(
        { error: 'game_lookup_failed', details: refetchError?.message },
        { status: 500 },
      )
    }
    const finalGame = refetched as Game
    const response: CompleteRunResponse = {
      game: finalGame,
      winner_team_id: caller.team_id,
    }
    return NextResponse.json(response)
  }

  game = updatedGameRow as Game

  // 6. Append game_won event.
  const { error: wonEventError } = await supabase.from('events').insert({
    game_id: game.id,
    type: 'game_won',
    actor_player_id: caller.id,
    payload: {
      winner_team_id: caller.team_id,
      flag_carrier_player_id: caller.id,
    },
  })
  if (wonEventError) {
    return NextResponse.json(
      { error: 'event_insert_failed', details: wonEventError.message },
      { status: 500 },
    )
  }

  const response: CompleteRunResponse = {
    game,
    winner_team_id: caller.team_id,
  }
  return NextResponse.json(response)
}
