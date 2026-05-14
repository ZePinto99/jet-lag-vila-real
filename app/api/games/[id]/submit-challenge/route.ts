import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { haversineMeters } from '@/lib/geo/haversine'
import { getSeedLandmarkByRef } from '@/lib/landmarks'
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

// One-shot bonus to the very first team to complete any challenge.
const FIRST_BLOOD_BONUS = 30

const ACTIVE_CHALLENGES_TARGET = 3

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

  // 8. Consume the card. Merge a submission record into payload for the
  //    timeline / audit. Optimistic guard on state to avoid double-consume.
  const submittedAt = new Date().toISOString()
  const newPayload: Record<string, unknown> = {
    ...(card.payload ?? {}),
    submitted_at: submittedAt,
  }
  if (photo_url !== undefined) newPayload.photo_url = photo_url
  if (text_submission !== undefined) newPayload.text_submission = text_submission

  const { data: consumedCardRow, error: consumeError } = await supabase
    .from('cards')
    .update({
      state: 'consumed',
      payload: newPayload,
      updated_at: submittedAt,
    })
    .eq('id', card.id)
    .eq('state', 'available')
    .select()
    .maybeSingle()

  if (consumeError) {
    return NextResponse.json(
      { error: 'card_update_failed', details: consumeError.message },
      { status: 500 },
    )
  }
  if (!consumedCardRow) {
    // State moved under us — another concurrent submit beat us to it.
    return NextResponse.json(
      { error: 'challenge_not_available' },
      { status: 409 },
    )
  }

  // 9. First-blood check: any prior challenge_completed event in this game?
  const { data: priorCompletionRow, error: priorCompletionError } =
    await supabase
      .from('events')
      .select('id')
      .eq('game_id', game.id)
      .eq('type', 'challenge_completed')
      .limit(1)
      .maybeSingle()

  if (priorCompletionError) {
    return NextResponse.json(
      {
        error: 'events_lookup_failed',
        details: priorCompletionError.message,
      },
      { status: 500 },
    )
  }
  const first_blood = !priorCompletionRow
  const bonus_coins = first_blood ? FIRST_BLOOD_BONUS : 0
  const total_credit = reward_coins + bonus_coins

  // 10. coins_credited event (ledger). Insert before the team coin bump so the
  //     log records intent even if the update somehow fails.
  const { error: coinsEventError } = await supabase.from('events').insert({
    game_id: game.id,
    type: 'coins_credited',
    actor_player_id: caller.id,
    payload: {
      team_id: callerTeam.id,
      amount: total_credit,
      reason: 'challenge_completed',
      challenge_ref,
      breakdown: { reward: reward_coins, first_blood: bonus_coins },
    },
  })
  if (coinsEventError) {
    return NextResponse.json(
      { error: 'event_insert_failed', details: coinsEventError.message },
      { status: 500 },
    )
  }

  // 11. Credit team coins. Addition is monotonic — no optimistic guard needed.
  const { data: updatedTeamRow, error: teamUpdateError } = await supabase
    .from('teams')
    .update({ coins: callerTeam.coins + total_credit })
    .eq('id', callerTeam.id)
    .select()
    .maybeSingle()

  if (teamUpdateError) {
    return NextResponse.json(
      { error: 'team_update_failed', details: teamUpdateError.message },
      { status: 500 },
    )
  }
  // Re-read coins to avoid drift from concurrent credits.
  let teamCoins =
    (updatedTeamRow as Team | null)?.coins ?? callerTeam.coins + total_credit
  {
    const { data: refreshedTeam, error: refreshError } = await supabase
      .from('teams')
      .select('coins')
      .eq('id', callerTeam.id)
      .maybeSingle()
    if (refreshError) {
      return NextResponse.json(
        { error: 'team_lookup_failed', details: refreshError.message },
        { status: 500 },
      )
    }
    if (refreshedTeam) {
      teamCoins = (refreshedTeam as { coins: number }).coins
    }
  }

  // 12. challenge_completed event.
  const { error: completedEventError } = await supabase.from('events').insert({
    game_id: game.id,
    type: 'challenge_completed',
    actor_player_id: caller.id,
    payload: {
      team_id: callerTeam.id,
      challenge_ref,
      reward_coins,
      first_blood,
      bonus_coins,
      actor_player_id: caller.id,
    },
  })
  if (completedEventError) {
    return NextResponse.json(
      { error: 'event_insert_failed', details: completedEventError.message },
      { status: 500 },
    )
  }

  // -------------------------------------------------------------------------
  // Draw a replacement challenge if any unused remain.
  // -------------------------------------------------------------------------

  let replacement: ChallengeDefinition | null = null

  // Re-read the team's challenge cards (any state) so we know exactly which
  // refs have ever been drawn.
  const { data: allTeamChallengesData, error: allTeamChallengesError } =
    await supabase
      .from('cards')
      .select('ref, state')
      .eq('game_id', game.id)
      .eq('team_id', callerTeam.id)
      .eq('kind', 'challenge')

  if (allTeamChallengesError) {
    return NextResponse.json(
      {
        error: 'cards_lookup_failed',
        details: allTeamChallengesError.message,
      },
      { status: 500 },
    )
  }
  const allTeamChallenges = (allTeamChallengesData ?? []) as Array<{
    ref: string
    state: string
  }>
  const availableCount = allTeamChallenges.filter(
    (c) => c.state === 'available',
  ).length
  const drawnRefs = new Set(allTeamChallenges.map((c) => c.ref))
  const unusedPool = CATALOG.filter((c) => !drawnRefs.has(c.id))

  if (availableCount < ACTIVE_CHALLENGES_TARGET && unusedPool.length > 0) {
    const pick = unusedPool[Math.floor(Math.random() * unusedPool.length)]
    const { data: insertedRow, error: insertError } = await supabase
      .from('cards')
      .insert({
        game_id: game.id,
        team_id: callerTeam.id,
        kind: 'challenge',
        ref: pick.id,
        state: 'available',
        payload: {},
      })
      .select()
      .maybeSingle()

    if (insertError) {
      return NextResponse.json(
        { error: 'card_insert_failed', details: insertError.message },
        { status: 500 },
      )
    }
    if (insertedRow) {
      replacement = pick
    }
  }

  const response: SubmitChallengeResponse = {
    challenge_ref,
    reward_coins,
    first_blood,
    bonus_coins,
    team_coins: teamCoins,
    replacement,
  }
  return NextResponse.json(response)
}
