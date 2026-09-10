import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPushToTeam } from '@/lib/push/server'
import { getSeedLandmarkByRef } from '@/lib/landmarks'
import { haversineMeters } from '@/lib/geo/haversine'
import { isPositionFresh } from '@/lib/geo/positionFreshness'
import { isTeamActionLocked } from '@/lib/server/actionLock'
import type { Game, Landmark, LandmarkKind, Player, Team } from '@/lib/types'

// POST /api/games/[id]/attempt-start
//
// Lightweight "I'm beginning a flag attempt here" signal (PLAYTEST_TRIAGE
// P2-5). The client calls this when the raider opens the mini-challenge panel,
// before they walk/photograph/submit. It inserts a `flag_attempt_started`
// event so the realtime subscription delivers a toast to the defending team
// (reaction window) and the attacker's team-mates. The authoritative result
// still comes from /attempt-flag at submit time.
//
// Deliberately permissive: it's an intention signal, not a state change, so a
// cancelled panel (a feint) is a feature, not a bug. We still validate that the
// caller is in this game and the target is a real enemy candidate so we don't
// pollute the log with garbage.

const PROTECTION_WINDOW_MS = 30 * 60_000
const ATTEMPT_START_RADIUS_M = 28
const FLAG_KINDS: LandmarkKind[] = ['flag_real', 'flag_decoy', 'flag_empty']

const GpsPositionSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number(),
  updated_at: z.number(),
})

const AttemptStartSchema = z.object({
  device_id: z.string().min(1).max(128),
  player_id: z.string().uuid(),
  landmark_ref: z.string().min(1).max(128),
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

  const parsed = AttemptStartSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', details: parsed.error.issues },
      { status: 400 },
    )
  }
  const { device_id, player_id, landmark_ref, pos } = parsed.data

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

  if (game.status !== 'live') {
    return NextResponse.json({ error: 'game_not_in_live' }, { status: 409 })
  }
  // Don't broadcast starts during the protection window (button is locked too).
  if (game.started_at) {
    const unlocksAtMs =
      new Date(game.started_at).getTime() + PROTECTION_WINDOW_MS
    if (Date.now() < unlocksAtMs) {
      return NextResponse.json({ error: 'attempts_locked' }, { status: 409 })
    }
  }

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
  const teamIds = (teamsData as Team[]).map((t) => t.id)
  if (teamIds.length === 0) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
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
  if (!caller || caller.id !== player_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  if (caller.respawning) {
    return NextResponse.json({ error: 'player_respawning' }, { status: 409 })
  }
  if (await isTeamActionLocked(supabase, game.id, caller.team_id)) {
    return NextResponse.json({ error: 'actions_locked' }, { status: 409 })
  }

  // Landmark must be an enemy candidate in this game.
  const { data: landmarkRow, error: landmarkError } = await supabase
    .from('landmarks')
    .select('*')
    .eq('game_id', game.id)
    .eq('ref', landmark_ref)
    .maybeSingle()
  if (landmarkError) {
    return NextResponse.json(
      { error: 'landmark_lookup_failed', details: landmarkError.message },
      { status: 500 },
    )
  }
  const landmark = landmarkRow as Landmark | null
  if (
    !landmark ||
    landmark.team_id === caller.team_id ||
    !FLAG_KINDS.includes(landmark.kind)
  ) {
    return NextResponse.json({ error: 'invalid_landmark' }, { status: 409 })
  }
  const distanceM = haversineMeters(pos, landmark)
  if (distanceM > ATTEMPT_START_RADIUS_M) {
    return NextResponse.json(
      { error: 'out_of_geofence', details: { distance_m: distanceM } },
      { status: 409 },
    )
  }

  const { data: recordedData, error: eventError } = await supabase.rpc(
    'record_flag_attempt_start_atomic',
    {
      p_game_id: game.id,
      p_player_id: caller.id,
      p_attacking_team_id: caller.team_id,
      p_defending_team_id: landmark.team_id,
      p_landmark_ref: landmark_ref,
    },
  )
  if (eventError) {
    return NextResponse.json(
      { error: 'attempt_start_failed', details: eventError.message },
      { status: 500 },
    )
  }
  const recorded = recordedData as { recorded?: boolean; error?: string } | null
  if (!recorded?.recorded) {
    const error = recorded?.error ?? 'attempt_start_failed'
    return NextResponse.json(
      { error },
      { status: error.endsWith('_cooldown') ? 429 : 409 },
    )
  }

  // Lock-screen alert to the defending team (best-effort; no-op without VAPID).
  if (landmark.team_id) {
    const lmName = getSeedLandmarkByRef(landmark_ref)?.name ?? landmark_ref
    await sendPushToTeam(game.id, landmark.team_id, {
      title: 'Flag under attack!',
      body: `Your flag is under attack at ${lmName}!`,
      tag: 'flag-attack',
      url: `/game/${game.code}`,
    })
  }

  return NextResponse.json({ ok: true })
}
