import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { haversineMeters } from '@/lib/geo/haversine'
import { getSeedLandmarkByRef } from '@/lib/landmarks'
import { isPositionFresh } from '@/lib/geo/positionFreshness'
import { isTeamActionLocked } from '@/lib/server/actionLock'
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

  // 2. A finished game is allowed through for retry-stable winner lookup in
  // the atomic RPC. Other phases cannot complete a run.
  if (game.status !== 'flag_found' && game.status !== 'finished') {
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
  if (caller.respawning) {
    return NextResponse.json({ error: 'player_respawning' }, { status: 409 })
  }

  // 4. Resolve caller's team's home base from the seed catalog.
  const team = teams.find((t) => t.id === caller.team_id)
  if (!team) {
    return NextResponse.json({ error: 'home_base_missing' }, { status: 500 })
  }
  if (!team.home_landmark_id) {
    return NextResponse.json({ error: 'home_base_missing' }, { status: 500 })
  }
  if (await isTeamActionLocked(supabase, game.id, team.id)) {
    return NextResponse.json({ error: 'actions_locked' }, { status: 409 })
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

  // 5. Commit the terminal status and exactly one winner event in the same
  // transaction. Concurrent/retried calls return the persisted winner.
  const { data: finishData, error: finishError } = await supabase.rpc(
    'complete_flag_run_atomic',
    { p_game_id: game.id, p_carrier_player_id: caller.id },
  )
  if (finishError) {
    return NextResponse.json(
      { error: 'game_finish_failed', details: finishError.message },
      { status: 500 },
    )
  }
  const finish = finishData as {
    error?: string
    game?: Game
    winner_team_id?: string
  } | null
  if (!finish?.game || !finish.winner_team_id || finish.error) {
    const error = finish?.error ?? 'game_finish_failed'
    // `game_expired` is a legitimate guard result, not a server fault:
    // gameplay_action_guard_locked (0030:51) returns it once the game duration
    // has elapsed. It must map to 409 like every other guard rejection, as
    // submit-challenge / accept-challenge / reject-challenge already do.
    //
    // It previously fell through this whitelist to `: 500`, so a flag carrier
    // who reached home a second past the 180-minute deadline got an HTTP 500 —
    // indistinguishable from a dropped connection, which sends them retrying the
    // geofence instead of showing them the results screen. Correct refusal,
    // catastrophic presentation, at the most emotionally loaded moment in the
    // game.
    const status =
      error === 'not_flag_carrier' ? 403 :
      error === 'game_not_in_flag_found' ||
      error === 'player_respawning' ||
      error === 'game_expired' ? 409 :
      error === 'not_found' ? 404 : 500
    return NextResponse.json({ error }, { status })
  }

  const response: CompleteRunResponse = {
    game: finish.game,
    winner_team_id: finish.winner_team_id,
  }
  return NextResponse.json(response)
}
