import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { haversineMeters } from '@/lib/geo/haversine'
import { isTeamActionLocked } from '@/lib/server/actionLock'
import { isPositionFresh } from '@/lib/geo/positionFreshness'
import { validatePublicProofPhoto } from '@/lib/server/storageProof'
import { nearestNeutralLandmark } from '@/lib/geo/nearestNeutral'
import {
  ATTEMPT_RANGE_M,
  HARDENED_RANGE_M,
  LANDMARK_LOCKOUT_MS,
  PROTECTION_WINDOW_MS,
} from '@/lib/gameConstants'
import type {
  AttemptFlagResponse,
  FlagAttemptResult,
  Game,
  Landmark,
  LandmarkKind,
  Player,
  Team,
} from '@/lib/types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
//
// The attempt geofence radii, the opening protection window and the per-landmark
// lockout all live in lib/gameConstants.ts so the in-app player guide can state
// the same numbers this route enforces. See that file for the rationale behind
// the 20 m client / 28 m server split and the hardened 12 m radius.

const GpsPositionSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number(),
  updated_at: z.number(),
})

const AttemptFlagRequestSchema = z.object({
  device_id: z.string().min(1).max(128),
  player_id: z.string().uuid(),
  landmark_ref: z.string().min(1).max(128),
  pos: GpsPositionSchema,
  photo_url: z.string().min(1).max(2048),
  answer: z.string().max(2048).optional(),
})

const KIND_TO_RESULT: Partial<Record<LandmarkKind, FlagAttemptResult>> = {
  flag_real: 'real',
  flag_decoy: 'decoy',
  flag_empty: 'empty',
}

const RESULT_MESSAGES: Record<FlagAttemptResult, string> = {
  real: 'You found the real flag. Return to your home base to win!',
  decoy: 'Decoy! All your intel cards have been expired.',
  empty: 'Empty. No marker here.',
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
    return NextResponse.json(
      { error: 'invalid_body', details: 'Body must be valid JSON.' },
      { status: 400 },
    )
  }

  const parsed = AttemptFlagRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', details: parsed.error.issues },
      { status: 400 },
    )
  }
  const { device_id, player_id, landmark_ref, pos, photo_url, answer } =
    parsed.data
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
  let game = gameRow as Game

  // 2. Status must be 'live'. No attempts during flag_found / paused / finished.
  if (game.status !== 'live') {
    return NextResponse.json({ error: 'game_not_in_live' }, { status: 409 })
  }

  // 2b. 30-minute protection window (P2-3): no attempts in the first 30 min.
  if (game.started_at) {
    const unlocksAtMs =
      new Date(game.started_at).getTime() + PROTECTION_WINDOW_MS
    if (Date.now() < unlocksAtMs) {
      return NextResponse.json(
        {
          error: 'attempts_locked',
          details: { unlocks_at: new Date(unlocksAtMs).toISOString() },
        },
        { status: 409 },
      )
    }
  }

  // 3. Identify caller via device_id, assert player_id match, scoped to this game.
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

  // 4. Caller cannot be respawning.
  if (caller.respawning) {
    return NextResponse.json({ error: 'player_respawning' }, { status: 409 })
  }
  if (await isTeamActionLocked(supabase, game.id, caller.team_id)) {
    return NextResponse.json({ error: 'actions_locked' }, { status: 409 })
  }
  const proof = await validatePublicProofPhoto({
    supabase,
    bucket: 'flag-attempts',
    publicUrl: photo_url,
    gameId: game.id,
    playerId: caller.id,
  })
  if (!proof.ok) {
    return NextResponse.json(
      { error: proof.error ?? 'invalid_photo_url' },
      { status: 400 },
    )
  }

  // 5. Resolve the landmark row for this game + ref.
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
  if (!landmarkRow) {
    return NextResponse.json(
      { error: 'landmark_not_in_game' },
      { status: 404 },
    )
  }
  const landmark = landmarkRow as Landmark

  // Must be an enemy candidate landmark (not the caller's own team's).
  if (landmark.team_id === caller.team_id) {
    return NextResponse.json(
      { error: 'cannot_attempt_own_landmark' },
      { status: 409 },
    )
  }

  // 6. Geofence: within range (tighter for hardened landmarks).
  const rangeM = landmark.hardened ? HARDENED_RANGE_M : ATTEMPT_RANGE_M
  const distance_m = haversineMeters(pos, {
    lat: landmark.lat,
    lng: landmark.lng,
  })
  if (distance_m > rangeM) {
    return NextResponse.json(
      { error: 'out_of_geofence', details: { distance_m } },
      { status: 409 },
    )
  }

  // 6b. 15-minute per-landmark lockout (P2-4): if this team failed an attempt
  // (decoy/empty) at THIS landmark in the last 15 min, block the re-attempt.
  // Derived from the append-only flag_attempt event log — no new table.
  const lockoutCutoffIso = new Date(
    Date.now() - LANDMARK_LOCKOUT_MS,
  ).toISOString()
  const { data: recentAttemptRows, error: recentAttemptError } = await supabase
    .from('events')
    .select('payload, created_at')
    .eq('game_id', game.id)
    .eq('type', 'flag_attempt')
    .gte('created_at', lockoutCutoffIso)

  if (recentAttemptError) {
    return NextResponse.json(
      { error: 'events_lookup_failed', details: recentAttemptError.message },
      { status: 500 },
    )
  }
  const lockingAttempt = (
    (recentAttemptRows ?? []) as Array<{
      payload: Record<string, unknown>
      created_at: string
    }>
  ).find((e) => {
    const p = e.payload
    return (
      p.team_id === caller.team_id &&
      p.landmark_ref === landmark_ref &&
      (p.result === 'decoy' || p.result === 'empty')
    )
  })
  if (lockingAttempt) {
    const unlocksAtMs =
      new Date(lockingAttempt.created_at).getTime() + LANDMARK_LOCKOUT_MS
    return NextResponse.json(
      {
        error: 'landmark_locked_out',
        details: { unlocks_at: new Date(unlocksAtMs).toISOString() },
      },
      { status: 409 },
    )
  }

  // 7. Determine result from landmark.kind.
  const result = KIND_TO_RESULT[landmark.kind]
  if (!result) {
    // landmark.kind was 'home' or 'neutral' — not a candidate.
    return NextResponse.json(
      { error: 'cannot_attempt_own_landmark' },
      { status: 409 },
    )
  }

  const respawnTarget = result === 'decoy' ? nearestNeutralLandmark(pos) : null
  if (result === 'decoy' && !respawnTarget) {
    return NextResponse.json({ error: 'respawn_target_missing' }, { status: 500 })
  }
  const { data: attemptData, error: attemptError } = await supabase.rpc(
    'attempt_flag_atomic',
    {
      p_game_id: game.id,
      p_player_id: caller.id,
      p_team_id: caller.team_id,
      p_landmark_ref: landmark_ref,
      p_result: result,
      p_photo_url: photo_url,
      p_lat: pos.lat,
      p_lng: pos.lng,
      p_taken_at: new Date(pos.updated_at).toISOString(),
      p_answer: answer ?? null,
      p_respawn_target_ref: respawnTarget?.landmark.id ?? null,
    },
  )
  if (attemptError) {
    return NextResponse.json(
      { error: 'flag_attempt_failed', details: attemptError.message },
      { status: 500 },
    )
  }
  const adjudication = attemptData as {
    error?: string
    unlocks_at?: string
    game?: Game
  } | null
  if (!adjudication || adjudication.error) {
    const error = adjudication?.error ?? 'flag_attempt_failed'
    return NextResponse.json(
      {
        error,
        ...(adjudication?.unlocks_at
          ? { details: { unlocks_at: adjudication.unlocks_at } }
          : {}),
      },
      { status: error === 'flag_attempt_failed' ? 500 : 409 },
    )
  }
  if (!adjudication.game) {
    return NextResponse.json({ error: 'flag_attempt_failed' }, { status: 500 })
  }
  const finalGame = adjudication.game

  const response: AttemptFlagResponse = {
    result,
    message: RESULT_MESSAGES[result],
    game: finalGame,
  }
  return NextResponse.json(response)
}
