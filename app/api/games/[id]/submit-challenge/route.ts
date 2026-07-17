import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { haversineMeters } from '@/lib/geo/haversine'
import { getSeedLandmarkByRef } from '@/lib/landmarks'
import { awardChallenge } from '@/lib/server/challengeAward'
import challengesCatalog from '@/data/challenges.json'
import type {
  Card,
  ChallengeDefinition,
  Game,
  Player,
  SubmitChallengeResponse,
  Team,
} from '@/lib/types'

// ---------------------------------------------------------------------------
// Constants (RULEBOOK §7.2 — first-blood bonus, §8.1 — challenges)
// ---------------------------------------------------------------------------

// Geofence radius for a challenge submission. Looser than flag-attempt (20 m)
// since challenges happen at the surrounding location, not strictly at the
// marker. 100 m generously covers "I'm at the landmark" for walking play.
const CHALLENGE_GEOFENCE_M = 100

// ---------------------------------------------------------------------------
// Challenge catalog
// ---------------------------------------------------------------------------

const CATALOG = challengesCatalog as ChallengeDefinition[]
const CATALOG_BY_ID = new Map<string, ChallengeDefinition>(
  CATALOG.map((c) => [c.id, c]),
)

// ---------------------------------------------------------------------------
// Body validation
// ---------------------------------------------------------------------------

const GpsPositionSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number(),
  updated_at: z.number(),
})

const SubmitChallengeRequestSchema = z.object({
  device_id: z.string().min(1).max(128),
  player_id: z.string().uuid(),
  challenge_ref: z
    .string()
    .min(1)
    .max(128)
    .refine((s) => s.startsWith('challenge.'), {
      message: 'challenge_ref must start with "challenge."',
    }),
  pos: GpsPositionSchema.optional(),
  photo_url: z.string().min(1).max(2048).optional(),
  text_submission: z.string().min(1).max(2048).optional(),
})

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

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

  const parsed = SubmitChallengeRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', details: parsed.error.issues },
      { status: 400 },
    )
  }
  const {
    device_id,
    player_id,
    challenge_ref,
    pos,
    photo_url,
    text_submission,
  } = parsed.data

  const supabase = createAdminClient()

  // 1. Load game; 404 if absent.
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

  // 2. Status must be live or flag_found.
  if (game.status !== 'live' && game.status !== 'flag_found') {
    return NextResponse.json({ error: 'game_not_in_play' }, { status: 409 })
  }

  // 3. Identify the caller via device_id; assert player_id match.
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

  // 4. Caller cannot be respawning — challenges are field work.
  if (caller.respawning) {
    return NextResponse.json({ error: 'player_respawning' }, { status: 409 })
  }

  const callerTeam = teams.find((t) => t.id === caller.team_id)
  if (!callerTeam) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // 5. Find the team's challenge card by ref. Must exist AND be `available`.
  const { data: cardRow, error: cardError } = await supabase
    .from('cards')
    .select('*')
    .eq('game_id', game.id)
    .eq('team_id', callerTeam.id)
    .eq('kind', 'challenge')
    .eq('ref', challenge_ref)
    .maybeSingle()

  if (cardError) {
    return NextResponse.json(
      { error: 'cards_lookup_failed', details: cardError.message },
      { status: 500 },
    )
  }
  if (!cardRow) {
    return NextResponse.json(
      { error: 'challenge_not_available' },
      { status: 409 },
    )
  }
  const card = cardRow as Card
  if (card.state !== 'available') {
    return NextResponse.json(
      { error: 'challenge_not_available' },
      { status: 409 },
    )
  }

  // 6. Look up the challenge definition. 400 if unknown ref.
  const def = CATALOG_BY_ID.get(challenge_ref)
  if (!def) {
    return NextResponse.json(
      { error: 'invalid_challenge_ref' },
      { status: 400 },
    )
  }
  const reward_coins = def.reward_coins

  // 7. Geofence (only when the challenge is tied to a specific landmark).
  if (def.landmark_ref !== null) {
    if (!pos) {
      return NextResponse.json(
        { error: 'invalid_body', details: 'pos required for this challenge' },
        { status: 400 },
      )
    }
    const seed = getSeedLandmarkByRef(def.landmark_ref)
    if (!seed) {
      return NextResponse.json(
        { error: 'seed_landmark_missing' },
        { status: 500 },
      )
    }
    const distance_m = haversineMeters(pos, { lat: seed.lat, lng: seed.lng })
    if (distance_m > CHALLENGE_GEOFENCE_M) {
      return NextResponse.json(
        { error: 'out_of_geofence', details: { distance_m } },
        { status: 409 },
      )
    }
  }

  // -------------------------------------------------------------------------
  // Apply submission.
  // -------------------------------------------------------------------------

  // Photo challenges go through peer review: they don't credit coins on submit.
  // Instead the card moves to `pending` and the OTHER team accepts/rejects it
  // (D14). Non-photo challenges (window count, quote) auto-complete as before.
  const needsReview = def.photo_required === true

  if (needsReview) {
    if (!photo_url) {
      return NextResponse.json({ error: 'photo_required' }, { status: 400 })
    }
    const enemyTeam = teams.find((t) => t.id !== callerTeam.id)
    if (!enemyTeam) {
      return NextResponse.json({ error: 'no_reviewing_team' }, { status: 409 })
    }
    const submittedAt = new Date().toISOString()
    const { data: pendingRow, error: pendingError } = await supabase
      .from('cards')
      .update({
        state: 'pending',
        payload: {
          ...(card.payload ?? {}),
          photo_url,
          submitted_at: submittedAt,
          submitted_by: caller.id,
          review_status: 'submitted',
          ...(text_submission !== undefined ? { text_submission } : {}),
        },
        updated_at: submittedAt,
      })
      .eq('id', card.id)
      .eq('state', 'available')
      .select()
      .maybeSingle()
    if (pendingError) {
      return NextResponse.json(
        { error: 'card_update_failed', details: pendingError.message },
        { status: 500 },
      )
    }
    if (!pendingRow) {
      return NextResponse.json(
        { error: 'challenge_not_available' },
        { status: 409 },
      )
    }

    // Notify the reviewing team (event flows over realtime to all clients).
    const { error: submittedEventError } = await supabase
      .from('events')
      .insert({
        game_id: game.id,
        type: 'challenge_submitted',
        actor_player_id: caller.id,
        payload: {
          team_id: callerTeam.id,
          reviewing_team_id: enemyTeam.id,
          challenge_ref,
          card_id: card.id,
          photo_url,
          reward_coins,
          location_name: def.location_name,
          submitter_player_id: caller.id,
        },
      })
    if (submittedEventError) {
      return NextResponse.json(
        { error: 'event_insert_failed', details: submittedEventError.message },
        { status: 500 },
      )
    }

    const response: SubmitChallengeResponse = {
      status: 'pending',
      challenge_ref,
      reward_coins,
      first_blood: false,
      bonus_coins: 0,
      team_coins: callerTeam.coins,
      replacement: null,
    }
    return NextResponse.json(response)
  }

  // Non-photo challenge → auto-complete + credit now.
  try {
    const award = await awardChallenge({
      supabase,
      game,
      team: callerTeam,
      card,
      def,
      actorPlayerId: caller.id,
    })
    const response: SubmitChallengeResponse = {
      status: 'completed',
      challenge_ref,
      ...award,
    }
    return NextResponse.json(response)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'award_failed'
    const status = message === 'challenge_not_available' ? 409 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
