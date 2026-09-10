import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { haversineMeters } from '@/lib/geo/haversine'
import { getSeedLandmarkByRef } from '@/lib/landmarks'
import { nearestNeutralLandmark } from '@/lib/geo/nearestNeutral'
import { isPositionFresh } from '@/lib/geo/positionFreshness'
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
// Hysteresis prevents noisy GPS at exactly 30 m from immediately clearing the
// immunity stage; the raider must visibly leave the neutral's vicinity.
const NEUTRAL_LEAVE_RADIUS_M = 45

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
  if (!isPositionFresh(pos.updated_at, Date.now())) {
    return NextResponse.json({ error: 'stale_position' }, { status: 409 })
  }

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

  const targetRef = caller.respawn_target_ref
  const target = targetRef ? getSeedLandmarkByRef(targetRef) : null
  if (!target || target.team_pool !== 'neutral') {
    return NextResponse.json({ error: 'respawn_target_missing' }, { status: 500 })
  }
  const distance_m = haversineMeters(pos, target)
  let stage: 'arrive' | 'clear'
  if (!caller.respawn_arrived) {
    if (distance_m > NEUTRAL_CLEAR_RADIUS_M) {
      const nearestNow = nearestNeutralLandmark(pos)
      const atWrongNeutral = nearestNow !== null &&
        nearestNow.landmark.id !== target.id &&
        nearestNow.distance_m <= NEUTRAL_CLEAR_RADIUS_M
      return NextResponse.json(
        {
          error: atWrongNeutral
            ? 'wrong_respawn_landmark'
            : 'not_at_respawn_landmark',
          details: {
            required_ref: target.id,
            required_name: target.name,
            distance_m,
          },
        },
        { status: 409 },
      )
    }
    stage = 'arrive'
  } else {
    if (distance_m <= NEUTRAL_LEAVE_RADIUS_M) {
      return NextResponse.json(
        {
          error: 'must_leave_neutral',
          details: {
            required_ref: target.id,
            required_name: target.name,
            distance_m,
            leave_radius_m: NEUTRAL_LEAVE_RADIUS_M,
          },
        },
        { status: 409 },
      )
    }
    stage = 'clear'
  }

  const { data: transitionData, error: transitionError } = await supabase.rpc(
    'advance_respawn_atomic',
    {
      p_game_id: game.id,
      p_player_id: caller.id,
      p_expected_target_ref: target.id,
      p_stage: stage,
    },
  )
  if (transitionError) {
    return NextResponse.json(
      { error: 'respawn_update_failed', details: transitionError.message },
      { status: 500 },
    )
  }
  const transition = transitionData as { error?: string; player?: Player } | null
  if (!transition?.player || transition.error) {
    const error = transition?.error ?? 'respawn_update_failed'
    const status = ['not_respawning', 'already_arrived', 'neutral_not_reached', 'respawn_target_changed']
      .includes(error) ? 409 : error === 'not_found' ? 404 : 500
    return NextResponse.json({ error }, { status })
  }

  const response: RespawnClearResponse = {
    player: transition.player,
    stage: stage === 'arrive' ? 'arrived' : 'cleared',
    respawn_target_ref: target.id,
  }
  return NextResponse.json(response)
}
