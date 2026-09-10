import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { haversineMeters } from '@/lib/geo/haversine'
import { isPositionFresh } from '@/lib/geo/positionFreshness'
import { getSeedLandmarkByRef } from '@/lib/landmarks'
import type { ActiveCurse, Game, Player, Team } from '@/lib/types'

const PILGRIMAGE_RADIUS_M = 30

const RequestSchema = z.object({
  device_id: z.string().min(1).max(128),
  player_id: z.string().uuid(),
  curse_id: z.string().uuid(),
  pos: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy: z.number().nonnegative(),
    updated_at: z.number(),
  }),
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
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', details: parsed.error.issues },
      { status: 400 },
    )
  }
  const { device_id, player_id, curse_id, pos } = parsed.data
  if (!isPositionFresh(pos.updated_at, Date.now())) {
    return NextResponse.json({ error: 'stale_position' }, { status: 409 })
  }

  const supabase = createAdminClient()
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
  if (!gameRow) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const game = gameRow as Game
  if (game.status !== 'live' && game.status !== 'flag_found') {
    return NextResponse.json({ error: 'game_not_in_play' }, { status: 409 })
  }

  const { data: teamRows, error: teamError } = await supabase
    .from('teams')
    .select('*')
    .eq('game_id', gameId)
  if (teamError) {
    return NextResponse.json(
      { error: 'team_lookup_failed', details: teamError.message },
      { status: 500 },
    )
  }
  const teams = (teamRows ?? []) as Team[]
  const { data: playerRows, error: playerError } = await supabase
    .from('players')
    .select('*')
    .in('team_id', teams.map((team) => team.id))
    .eq('device_id', device_id)
  if (playerError) {
    return NextResponse.json(
      { error: 'player_lookup_failed', details: playerError.message },
      { status: 500 },
    )
  }
  const caller = (playerRows ?? [])[0] as Player | undefined
  if (!caller || caller.id !== player_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { data: curseRow, error: curseError } = await supabase
    .from('active_curses')
    .select('*')
    .eq('id', curse_id)
    .eq('game_id', gameId)
    .maybeSingle()
  if (curseError) {
    return NextResponse.json(
      { error: 'curse_lookup_failed', details: curseError.message },
      { status: 500 },
    )
  }
  if (!curseRow) {
    // The atomic RPC provides retry-stable success after another teammate has
    // already completed this same cast.
    const { data } = await supabase.rpc('complete_pilgrimage_atomic', {
      p_game_id: gameId,
      p_curse_id: curse_id,
      p_player_id: caller.id,
    })
    const result = data as { completed?: boolean } | null
    return result?.completed
      ? NextResponse.json(result)
      : NextResponse.json({ error: 'pilgrimage_not_active' }, { status: 409 })
  }
  const curse = curseRow as ActiveCurse
  if (curse.curse_ref !== 'curse.pilgrimage' || curse.target_team_id !== caller.team_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const targetRef =
    typeof curse.params?.target_landmark_ref === 'string'
      ? curse.params.target_landmark_ref
      : null
  const target = targetRef ? getSeedLandmarkByRef(targetRef) : null
  if (!target || target.team_pool !== 'neutral') {
    return NextResponse.json({ error: 'pilgrimage_target_missing' }, { status: 500 })
  }
  const distance_m = haversineMeters(pos, target)
  if (distance_m > PILGRIMAGE_RADIUS_M) {
    return NextResponse.json(
      { error: 'not_at_pilgrimage_target', details: { distance_m } },
      { status: 409 },
    )
  }

  const { data, error } = await supabase.rpc('complete_pilgrimage_atomic', {
    p_game_id: gameId,
    p_curse_id: curse_id,
    p_player_id: caller.id,
  })
  if (error) {
    return NextResponse.json(
      { error: 'pilgrimage_completion_failed', details: error.message },
      { status: 500 },
    )
  }
  const result = data as { error?: string; completed?: boolean } | null
  if (!result?.completed || result.error) {
    const responseError = result?.error ?? 'pilgrimage_completion_failed'
    return NextResponse.json(
      { error: responseError },
      { status: responseError === 'forbidden' ? 403 : 409 },
    )
  }
  return NextResponse.json(result)
}
