import { NextResponse } from 'next/server'
import { z } from 'zod'
import { haversineMeters } from '@/lib/geo/haversine'
import { isPositionFresh } from '@/lib/geo/positionFreshness'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Game, Landmark, LandmarkKind, Player, Team } from '@/lib/types'

const CAMPING_RADIUS_M = 50
const FLAG_KINDS: LandmarkKind[] = ['flag_real', 'flag_decoy', 'flag_empty']

const BodySchema = z.object({
  device_id: z.string().min(1).max(128),
  player_id: z.string().uuid(),
  pos: z.object({
    lat: z.number(),
    lng: z.number(),
    accuracy: z.number(),
    updated_at: z.number(),
  }),
})

interface CampingStateResponse {
  inside_zone: boolean
  seconds_in_zone: number
  seconds_outside: number
  locked: boolean
  last_heartbeat_at: string
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(body)
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
  const [{ data: gameRow, error: gameError }, { data: teamsRows, error: teamsError }] =
    await Promise.all([
      supabase.from('games').select('*').eq('id', gameId).maybeSingle(),
      supabase.from('teams').select('*').eq('game_id', gameId),
    ])
  if (gameError || teamsError) {
    return NextResponse.json(
      { error: 'state_lookup_failed', details: gameError?.message ?? teamsError?.message },
      { status: 500 },
    )
  }
  if (!gameRow) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const game = gameRow as Game
  if (!['live', 'flag_found', 'paused'].includes(game.status)) {
    return NextResponse.json({ error: 'game_not_in_play' }, { status: 409 })
  }
  const teams = (teamsRows ?? []) as Team[]
  const { data: callerRow, error: callerError } = await supabase
    .from('players')
    .select('*')
    .eq('id', player_id)
    .eq('device_id', device_id)
    .in('team_id', teams.map((team) => team.id))
    .maybeSingle()
  if (callerError) {
    return NextResponse.json(
      { error: 'player_lookup_failed', details: callerError.message },
      { status: 500 },
    )
  }
  if (!callerRow) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const caller = callerRow as Player

  const { data: landmarkRows, error: landmarkError } = await supabase
    .from('landmarks')
    .select('*')
    .eq('game_id', gameId)
    .eq('team_id', caller.team_id)
    .in('kind', FLAG_KINDS)
  if (landmarkError) {
    return NextResponse.json(
      { error: 'landmark_lookup_failed', details: landmarkError.message },
      { status: 500 },
    )
  }
  const insideZone = ((landmarkRows ?? []) as Landmark[]).some(
    (landmark) => haversineMeters(pos, landmark) <= CAMPING_RADIUS_M,
  )

  const { data, error } = await supabase.rpc('update_player_camping_state', {
    p_game_id: gameId,
    p_player_id: caller.id,
    p_inside_zone: insideZone,
  })
  if (error) {
    return NextResponse.json(
      { error: 'camping_update_failed', details: error.message },
      { status: 500 },
    )
  }
  const result = data as CampingStateResponse | { error: string }
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 409 })
  }
  return NextResponse.json(result)
}
