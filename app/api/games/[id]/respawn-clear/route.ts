import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { haversineMeters } from '@/lib/geo/haversine'
import { getSeedLandmarksByPool } from '@/lib/landmarks'
import type {
  Game,
  Player,
  RespawnClearResponse,
  Team,
} from '@/lib/types'

// Distance (m) within which a tagged raider can clear their respawning flag at
// a neutral landmark. Rulebook §6 says "walk to the nearest neutral landmark";
// 30 m gives enough headroom for GPS drift while keeping the player visibly at
// the landmark.
const NEUTRAL_CLEAR_RADIUS_M = 30

const GpsPositionSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number(),
  updated_at: z.number(),
})

const RespawnClearRequestSchema = z.object({
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

  const parsed = RespawnClearRequestSchema.safeParse(body)
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
  const game = gameRow as Game

  // 2. Game must be in play.
  if (game.status !== 'live' && game.status !== 'flag_found') {
    return NextResponse.json({ error: 'game_not_in_play' }, { status: 409 })
  }

  // 3. Identify caller via device_id and assert it matches body.player_id.
  //    Scope the lookup to teams in this game so we don't accept a device_id
  //    from a different game by coincidence.
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
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { data: playerRows, error: playerLookupError } = await supabase
    .from('players')
    .select('*')
    .in('team_id', teamIds)
    .eq('device_id', device_id)

  if (playerLookupError) {
    return NextResponse.json(
      { error: 'player_lookup_failed', details: playerLookupError.message },
      { status: 500 },
    )
  }
  const caller = (playerRows ?? [])[0] as Player | undefined
  if (!caller || caller.id !== player_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // 4. Caller must currently be respawning.
  if (!caller.respawning) {
    return NextResponse.json({ error: 'not_respawning' }, { status: 409 })
  }

  // 5. Position must be within radius of any neutral landmark from the seed catalog.
  const neutrals = getSeedLandmarksByPool('neutral')
  let nearestRef: string | null = null
  let nearestDistance = Number.POSITIVE_INFINITY
  for (const n of neutrals) {
    const d = haversineMeters(pos, { lat: n.lat, lng: n.lng })
    if (d < nearestDistance) {
      nearestDistance = d
      nearestRef = n.id
    }
  }

  if (nearestRef === null || nearestDistance > NEUTRAL_CLEAR_RADIUS_M) {
    return NextResponse.json(
      {
        error: 'not_at_neutral_landmark',
        details: { nearest_m: nearestDistance },
      },
      { status: 409 },
    )
  }

  // 6. Clear respawning flag.
  const { data: updatedPlayerRow, error: updateError } = await supabase
    .from('players')
    .update({ respawning: false })
    .eq('id', caller.id)
    .select()
    .maybeSingle()

  if (updateError || !updatedPlayerRow) {
    return NextResponse.json(
      { error: 'player_update_failed', details: updateError?.message },
      { status: 500 },
    )
  }
  const updatedPlayer = updatedPlayerRow as Player

  // 7. Append `player_respawning_cleared` event.
  const { error: eventError } = await supabase.from('events').insert({
    game_id: game.id,
    type: 'player_respawning_cleared',
    actor_player_id: caller.id,
    payload: {
      player_id: caller.id,
      at_neutral_ref: nearestRef,
    },
  })
  if (eventError) {
    return NextResponse.json(
      { error: 'event_insert_failed', details: eventError.message },
      { status: 500 },
    )
  }

  const response: RespawnClearResponse = {
    player: updatedPlayer,
    cleared_at_neutral_ref: nearestRef,
  }
  return NextResponse.json(response)
}
