import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSeedLandmarkByRef } from '@/lib/landmarks'
import { getGameplayActionBlock } from '@/lib/server/actionLock'
import { isPositionFresh } from '@/lib/geo/positionFreshness'
import { PLAY_AREA_CENTRE } from '@/lib/geo/playArea'
import { compass4FromPoint, eastWestOf } from '@/lib/intel/direction'
import { buildHotColdAnswer } from '@/lib/intel/answers'
import { northSouthPivotForDefendingSide } from '@/lib/intel/northSouth'
import intelCatalog from '@/data/intel.json'
import { INTEL_CAP } from '@/lib/gameConstants'
import type {
  BuyIntelResponse,
  Card,
  Game,
  IntelAnswer,
  Landmark,
  Player,
  Team,
} from '@/lib/types'

// ---------------------------------------------------------------------------
// Body validation
// ---------------------------------------------------------------------------

const GpsPositionSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number(),
  updated_at: z.number(),
})

const BuyIntelRequestSchema = z.object({
  device_id: z.string().min(1).max(128),
  player_id: z.string().uuid(),
  // Existence in the catalog is checked server-side once we've loaded the
  // intel definition; here we just shape-check the prefix.
  intel_ref: z
    .string()
    .min(1)
    .max(128)
    .refine((s) => s.startsWith('intel.'), {
      message: 'intel_ref must start with "intel."',
    }),
  player_pos: GpsPositionSchema.optional(),
})

// ---------------------------------------------------------------------------
// Intel catalog types
// ---------------------------------------------------------------------------

interface IntelDefinition {
  id: string
  name: string
  reveals: string
  cost_coins: number
}

const INTEL_BY_ID = new Map<string, IntelDefinition>(
  (intelCatalog as IntelDefinition[]).map((i) => [i.id, i]),
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveLandmarkName(ref: string): string {
  const seed = getSeedLandmarkByRef(ref)
  // Fallback to the ref string if the seed catalog is missing the entry. This
  // shouldn't happen in practice — landmarks rows are created from the seed
  // catalog during setup — but we'd rather degrade than crash.
  return seed?.name ?? ref
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// Fisher–Yates partial shuffle: returns `n` distinct random elements from arr.
function pickDistinct<T>(arr: T[], n: number): T[] {
  const copy = arr.slice()
  const out: T[] = []
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length)
    out.push(copy[idx])
    copy.splice(idx, 1)
  }
  return out
}

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

  const parsed = BuyIntelRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', details: parsed.error.issues },
      { status: 400 },
    )
  }
  const { device_id, player_id, intel_ref, player_pos } = parsed.data

  const supabase = createAdminClient()

  // 1. Load game; must be in 'live' or 'flag_found' (intel still useful during
  // the chase phase if you somehow haven't bought your cap yet).
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

  if (game.status !== 'live' && game.status !== 'flag_found') {
    return NextResponse.json({ error: 'game_not_in_play' }, { status: 409 })
  }

  // 2. Load both teams for this game.
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

  // 3. Identify the caller via device_id, scoped to this game's teams. Assert
  // the supplied player_id matches.
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

  const callerTeam = teams.find((t) => t.id === caller.team_id)
  const enemyTeam = teams.find((t) => t.id !== caller.team_id)
  if (!callerTeam || !enemyTeam) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const actionBlock = await getGameplayActionBlock(supabase, game.id, caller)
  if (actionBlock) return NextResponse.json({ error: actionBlock }, { status: 409 })

  // 4. Look up the intel definition; bail if unknown.
  const intelDef = INTEL_BY_ID.get(intel_ref)
  if (!intelDef) {
    return NextResponse.json({ error: 'invalid_intel_ref' }, { status: 400 })
  }
  const cost = intelDef.cost_coins

  // 5. Coin check against the materialized counter.
  if (callerTeam.coins < cost) {
    return NextResponse.json(
      {
        error: 'insufficient_coins',
        details: { coins: callerTeam.coins, cost },
      },
      { status: 409 },
    )
  }

  // 6. Intel-cap and duplicate-purchase checks. Both look at any state — once
  // a card has ever existed for this team, it counts.
  const { data: teamCardsData, error: teamCardsError } = await supabase
    .from('cards')
    .select('*')
    .eq('game_id', game.id)
    .eq('team_id', callerTeam.id)
    .eq('kind', 'intel')

  if (teamCardsError) {
    return NextResponse.json(
      { error: 'cards_lookup_failed', details: teamCardsError.message },
      { status: 500 },
    )
  }
  const teamIntelCards = (teamCardsData ?? []) as Card[]
  if (teamIntelCards.length >= INTEL_CAP) {
    return NextResponse.json({ error: 'intel_cap_reached' }, { status: 409 })
  }
  if (teamIntelCards.some((c) => c.ref === intel_ref)) {
    return NextResponse.json(
      { error: 'intel_already_purchased' },
      { status: 409 },
    )
  }

  // 7. Hot/cold needs the caller's GPS.
  if (intel_ref === 'intel.hot-cold' && !player_pos) {
    return NextResponse.json(
      { error: 'player_pos_required' },
      { status: 400 },
    )
  }
  if (player_pos && !isPositionFresh(player_pos.updated_at, Date.now())) {
    return NextResponse.json({ error: 'stale_position' }, { status: 409 })
  }

  // 8. Load the enemy team's 5 candidate landmark rows. We bypass RLS with the
  // admin client so we can read `kind`.
  const { data: enemyLandmarksData, error: enemyLandmarksError } =
    await supabase
      .from('landmarks')
      .select('*')
      .eq('game_id', game.id)
      .eq('team_id', enemyTeam.id)

  if (enemyLandmarksError) {
    return NextResponse.json(
      {
        error: 'landmark_lookup_failed',
        details: enemyLandmarksError.message,
      },
      { status: 500 },
    )
  }
  const enemyLandmarks = (enemyLandmarksData ?? []) as Landmark[]
  const realFlag = enemyLandmarks.find((l) => l.kind === 'flag_real')
  if (!realFlag) {
    // Enemy team hasn't completed flag setup — shouldn't happen post-live, but
    // guard so we don't compute nonsense.
    return NextResponse.json(
      { error: 'enemy_flag_not_set' },
      { status: 409 },
    )
  }

  // -------------------------------------------------------------------------
  // Compute the answer matching the IntelAnswer discriminated union.
  // -------------------------------------------------------------------------

  let answer: IntelAnswer
  let storedAnswer: Record<string, unknown> | null = null
  switch (intel_ref) {
    case 'intel.north-south': {
      if (!enemyTeam.side) {
        return NextResponse.json(
          { error: 'team_side_missing' },
          { status: 409 },
        )
      }
      const pivotLat = northSouthPivotForDefendingSide(enemyTeam.side)
      answer = {
        intel_ref: 'intel.north-south',
        direction: realFlag.lat > pivotLat ? 'north' : 'south',
        pivot_lat: pivotLat,
      }
      break
    }
    case 'intel.east-west': {
      // I2 describes the enemy assignment relative to the defending team's
      // own home. Using the buyer's home made the clue nearly constant because
      // the two candidate pools are geographically separated.
      if (!enemyTeam.home_landmark_id) {
        return NextResponse.json(
          { error: 'home_base_missing' },
          { status: 409 },
        )
      }
      const homeBase = getSeedLandmarkByRef(enemyTeam.home_landmark_id)
      if (!homeBase) {
        return NextResponse.json(
          { error: 'home_base_missing' },
          { status: 409 },
        )
      }
      answer = {
        intel_ref: 'intel.east-west',
        direction: eastWestOf(homeBase.lng, realFlag.lng),
        pivot_lng: homeBase.lng,
      }
      break
    }
    case 'intel.eliminate-one': {
      const nonReal = enemyLandmarks.filter(
        (l) => l.kind === 'flag_decoy' || l.kind === 'flag_empty',
      )
      if (nonReal.length === 0) {
        return NextResponse.json(
          { error: 'no_non_real_candidates' },
          { status: 409 },
        )
      }
      const pick = pickRandom(nonReal)
      answer = {
        intel_ref: 'intel.eliminate-one',
        not_real: { ref: pick.ref, name: resolveLandmarkName(pick.ref) },
      }
      break
    }
    case 'intel.eliminate-two': {
      const nonReal = enemyLandmarks.filter(
        (l) => l.kind === 'flag_decoy' || l.kind === 'flag_empty',
      )
      if (nonReal.length < 2) {
        return NextResponse.json(
          { error: 'no_non_real_candidates' },
          { status: 409 },
        )
      }
      const picks = pickDistinct(nonReal, 2)
      answer = {
        intel_ref: 'intel.eliminate-two',
        not_real: picks.map((p) => ({
          ref: p.ref,
          name: resolveLandmarkName(p.ref),
        })),
      }
      break
    }
    case 'intel.decoy-reveal': {
      const decoys = enemyLandmarks.filter((l) => l.kind === 'flag_decoy')
      if (decoys.length === 0) {
        return NextResponse.json(
          { error: 'no_decoys' },
          { status: 409 },
        )
      }
      const pick = pickRandom(decoys)
      answer = {
        intel_ref: 'intel.decoy-reveal',
        decoy: { ref: pick.ref, name: resolveLandmarkName(pick.ref) },
      }
      break
    }
    case 'intel.hot-cold': {
      // player_pos guaranteed by the check above; narrow for TS.
      if (!player_pos) {
        return NextResponse.json(
          { error: 'player_pos_required' },
          { status: 400 },
        )
      }
      answer = buildHotColdAnswer(player_pos, realFlag)
      break
    }
    case 'intel.surroundings': {
      const { data: surroundingsRow, error: surroundingsError } = await supabase
        .from('flag_surroundings')
        .select('object_path')
        .eq('game_id', game.id)
        .eq('team_id', enemyTeam.id)
        .maybeSingle()
      if (surroundingsError) {
        return NextResponse.json(
          { error: 'surroundings_lookup_failed', details: surroundingsError.message },
          { status: 500 },
        )
      }
      const objectPath = (surroundingsRow as { object_path: string } | null)
        ?.object_path
      if (!objectPath) {
        return NextResponse.json(
          { error: 'surroundings_photo_missing' },
          { status: 409 },
        )
      }
      const { data: signed, error: signError } = await supabase.storage
        .from('surroundings-photos')
        .createSignedUrl(objectPath, 5 * 60)
      if (signError || !signed?.signedUrl) {
        return NextResponse.json(
          { error: 'surroundings_sign_failed', details: signError?.message },
          { status: 500 },
        )
      }
      answer = {
        intel_ref: 'intel.surroundings',
        photo_url: signed.signedUrl,
      }
      // Never persist a signed URL (it expires) and never return this private
      // object path to a client. live-state resolves the enemy team's hidden
      // flag_surroundings row and re-signs it on every team-scoped snapshot.
      // Keeping the path out of cards also prevents it leaking through the
      // project's deliberately broad v1 read policy on the cards table.
      storedAnswer = {
        intel_ref: 'intel.surroundings',
      }
      break
    }
    case 'intel.direction': {
      answer = {
        intel_ref: 'intel.direction',
        bearing: compass4FromPoint(PLAY_AREA_CENTRE, realFlag),
      }
      break
    }
    default: {
      // The intel_ref exists in intel.json but we have no compute path for it.
      // Shouldn't happen unless someone adds a new intel id to the JSON
      // without updating this switch.
      return NextResponse.json(
        { error: 'invalid_intel_ref' },
        { status: 400 },
      )
    }
  }

  // Debit, cap/duplicate check, private card insert and public events must be a
  // single transaction: several team-mates can buy at the same moment.
  const { data: purchaseData, error: purchaseError } = await supabase.rpc(
    'purchase_intel_atomic',
    {
      p_game_id: game.id,
      p_team_id: callerTeam.id,
      p_actor_player_id: caller.id,
      p_intel_ref: intel_ref,
      p_cost: cost,
      p_answer: storedAnswer ?? answer,
    },
  )
  if (purchaseError) {
    return NextResponse.json(
      { error: 'intel_purchase_failed', details: purchaseError.message },
      { status: 500 },
    )
  }
  const purchase = purchaseData as {
    error?: string
    coins?: number
    card?: Card
    team_coins?: number
  } | null
  if (!purchase || purchase.error) {
    const error = purchase?.error ?? 'intel_purchase_failed'
    return NextResponse.json(
      {
        error,
        ...(purchase?.coins !== undefined
          ? { details: { coins: purchase.coins, cost } }
          : {}),
      },
      { status: error === 'intel_purchase_failed' ? 500 : 409 },
    )
  }
  if (!purchase.card || purchase.team_coins === undefined) {
    return NextResponse.json({ error: 'intel_purchase_failed' }, { status: 500 })
  }
  const card: Card = {
    ...purchase.card,
    payload: answer as unknown as Record<string, unknown>,
  }
  const finalCoins = purchase.team_coins

  const response: BuyIntelResponse = {
    card,
    answer,
    team_coins: finalCoins,
  }
  return NextResponse.json(response)
}
