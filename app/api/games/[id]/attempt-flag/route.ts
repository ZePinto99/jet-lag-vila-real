import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { haversineMeters } from '@/lib/geo/haversine'
import type {
  AttemptFlagResponse,
  Card,
  FlagAttemptResult,
  Game,
  Landmark,
  LandmarkKind,
  Player,
  Team,
} from '@/lib/types'

// Server-side geofence radius for flag attempts. Matches RULEBOOK §5.2: raider
// must be within 20 m of the candidate landmark. Clients typically display a
// slightly larger buffer to account for GPS jitter.
const ATTEMPT_RANGE_M = 20

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
  photo_url: z.string().min(1).max(2048).optional(),
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
  const { device_id, player_id, landmark_ref, pos } = parsed.data

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

  // 6. Geofence: within 20 m.
  const distance_m = haversineMeters(pos, {
    lat: landmark.lat,
    lng: landmark.lng,
  })
  if (distance_m > ATTEMPT_RANGE_M) {
    return NextResponse.json(
      { error: 'out_of_geofence', details: { distance_m } },
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

  // 8. Side effects per result.
  if (result === 'real') {
    // Mark caller as the flag carrier.
    const { error: carrierError } = await supabase
      .from('players')
      .update({ flag_carrier: true })
      .eq('id', caller.id)
    if (carrierError) {
      return NextResponse.json(
        { error: 'player_update_failed', details: carrierError.message },
        { status: 500 },
      )
    }

    // Transition game to flag_found (optimistic guard).
    const { data: updatedGameRow, error: gameUpdateError } = await supabase
      .from('games')
      .update({ status: 'flag_found' })
      .eq('id', game.id)
      .eq('status', 'live')
      .select()
      .maybeSingle()
    if (gameUpdateError) {
      return NextResponse.json(
        { error: 'game_update_failed', details: gameUpdateError.message },
        { status: 500 },
      )
    }
    if (updatedGameRow) {
      game = updatedGameRow as Game
    }

    // Append flag_attempt event.
    const { error: attemptEventError } = await supabase.from('events').insert({
      game_id: game.id,
      type: 'flag_attempt',
      actor_player_id: caller.id,
      payload: {
        landmark_ref,
        result,
        team_id: caller.team_id,
      },
    })
    if (attemptEventError) {
      return NextResponse.json(
        { error: 'event_insert_failed', details: attemptEventError.message },
        { status: 500 },
      )
    }

    // Append flag_found event.
    const { error: foundEventError } = await supabase.from('events').insert({
      game_id: game.id,
      type: 'flag_found',
      actor_player_id: caller.id,
      payload: {
        player_id: caller.id,
        landmark_ref,
        team_id: caller.team_id,
      },
    })
    if (foundEventError) {
      return NextResponse.json(
        { error: 'event_insert_failed', details: foundEventError.message },
        { status: 500 },
      )
    }
  } else if (result === 'decoy') {
    // Expire ALL in_hand intel cards on caller's team (RULEBOOK §5.2: loses
    // all intel cards). Mirrors the targeted-expire pattern in tag/route.ts.
    const { data: intelCardsData, error: intelLookupError } = await supabase
      .from('cards')
      .select('*')
      .eq('game_id', game.id)
      .eq('team_id', caller.team_id)
      .eq('kind', 'intel')
      .eq('state', 'in_hand')

    if (intelLookupError) {
      return NextResponse.json(
        { error: 'cards_lookup_failed', details: intelLookupError.message },
        { status: 500 },
      )
    }
    const intelCards = (intelCardsData ?? []) as Card[]
    if (intelCards.length > 0) {
      const { error: expireError } = await supabase
        .from('cards')
        .update({ state: 'expired', updated_at: new Date().toISOString() })
        .eq('game_id', game.id)
        .eq('team_id', caller.team_id)
        .eq('kind', 'intel')
        .eq('state', 'in_hand')
      if (expireError) {
        return NextResponse.json(
          { error: 'card_update_failed', details: expireError.message },
          { status: 500 },
        )
      }
    }

    const { error: attemptEventError } = await supabase.from('events').insert({
      game_id: game.id,
      type: 'flag_attempt',
      actor_player_id: caller.id,
      payload: {
        landmark_ref,
        result,
        team_id: caller.team_id,
      },
    })
    if (attemptEventError) {
      return NextResponse.json(
        { error: 'event_insert_failed', details: attemptEventError.message },
        { status: 500 },
      )
    }
  } else {
    // empty
    const { error: attemptEventError } = await supabase.from('events').insert({
      game_id: game.id,
      type: 'flag_attempt',
      actor_player_id: caller.id,
      payload: {
        landmark_ref,
        result,
        team_id: caller.team_id,
      },
    })
    if (attemptEventError) {
      return NextResponse.json(
        { error: 'event_insert_failed', details: attemptEventError.message },
        { status: 500 },
      )
    }
  }

  // 9. Re-fetch the (possibly updated) game row so the response reflects the
  // committed status even if our optimistic transition lost a race.
  const { data: finalGameRow, error: finalGameError } = await supabase
    .from('games')
    .select('*')
    .eq('id', game.id)
    .maybeSingle()
  if (finalGameError || !finalGameRow) {
    return NextResponse.json(
      { error: 'game_lookup_failed', details: finalGameError?.message },
      { status: 500 },
    )
  }
  const finalGame = finalGameRow as Game

  const response: AttemptFlagResponse = {
    result,
    message: RESULT_MESSAGES[result],
    game: finalGame,
  }
  return NextResponse.json(response)
}
