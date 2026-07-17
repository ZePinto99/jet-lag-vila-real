import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { haversineMeters } from '@/lib/geo/haversine'
import { getSeedLandmarkByRef } from '@/lib/landmarks'
import intelCatalog from '@/data/intel.json'
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
// Constants (RULEBOOK §11 — intel reference)
// ---------------------------------------------------------------------------

// Anti-spam cap: a team may not buy more than 4 intel cards total (any state).
const INTEL_CAP = 4

// Latitude of Vila Real city centre, used as the N/S boundary for I1 and the
// origin of the I8 compass bearing.
const CITY_CENTRE_LAT = 41.295
const CITY_CENTRE_LNG = -7.726

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

// Initial bearing from `from` to `to`, in degrees (0 = north, clockwise).
// Standard great-circle formula.
function initialBearingDegrees(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const toDeg = (r: number) => (r * 180) / Math.PI
  const lat1 = toRad(from.lat)
  const lat2 = toRad(to.lat)
  const dLng = toRad(to.lng - from.lng)
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  const brng = toDeg(Math.atan2(y, x))
  return (brng + 360) % 360
}

function snapToCompass8(
  deg: number,
): 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' {
  // Per spec: 0–22.5 → N, 22.5–67.5 → NE, ..., 292.5–337.5 → NW, 337.5–360 → N.
  if (deg < 22.5) return 'N'
  if (deg < 67.5) return 'NE'
  if (deg < 112.5) return 'E'
  if (deg < 157.5) return 'SE'
  if (deg < 202.5) return 'S'
  if (deg < 247.5) return 'SW'
  if (deg < 292.5) return 'W'
  if (deg < 337.5) return 'NW'
  return 'N'
}

function hotColdBucket(
  meters: number,
): 'under_200m' | 'under_500m' | 'under_1km' | 'over_1km' {
  if (meters < 200) return 'under_200m'
  if (meters < 500) return 'under_500m'
  if (meters < 1000) return 'under_1km'
  return 'over_1km'
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
  switch (intel_ref) {
    case 'intel.north-south': {
      answer = {
        intel_ref: 'intel.north-south',
        direction: realFlag.lat > CITY_CENTRE_LAT ? 'north' : 'south',
      }
      break
    }
    case 'intel.east-west': {
      // Caller's team home base seed entry — needed for the east/west pivot.
      if (!callerTeam.home_landmark_id) {
        return NextResponse.json(
          { error: 'home_base_missing' },
          { status: 409 },
        )
      }
      const homeBase = getSeedLandmarkByRef(callerTeam.home_landmark_id)
      if (!homeBase) {
        return NextResponse.json(
          { error: 'home_base_missing' },
          { status: 409 },
        )
      }
      answer = {
        intel_ref: 'intel.east-west',
        direction: realFlag.lng > homeBase.lng ? 'east' : 'west',
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
      const meters = haversineMeters(player_pos, realFlag)
      answer = {
        intel_ref: 'intel.hot-cold',
        bucket: hotColdBucket(meters),
        buy_position: { lat: player_pos.lat, lng: player_pos.lng },
        // Real-flag coords for the live thermometer reading (E17). The buying
        // team paid for distance intel, so revealing coords to them is by
        // design; the reading updates client-side as they move.
        target: { lat: realFlag.lat, lng: realFlag.lng },
      }
      break
    }
    case 'intel.surroundings': {
      // v1 placeholder — uploading a setup-time surroundings photo lands later.
      answer = {
        intel_ref: 'intel.surroundings',
        text:
          'Surroundings photo not yet supported. Visit the area to scout in person.',
      }
      break
    }
    case 'intel.direction': {
      const brng = initialBearingDegrees(
        { lat: CITY_CENTRE_LAT, lng: CITY_CENTRE_LNG },
        realFlag,
      )
      answer = {
        intel_ref: 'intel.direction',
        bearing: snapToCompass8(brng),
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

  // -------------------------------------------------------------------------
  // Side effects, matching the harden-flag ordering:
  //   1. coins_deducted event
  //   2. UPDATE teams.coins  (optimistic guard against race)
  //   3. INSERT cards row
  //   4. intel_purchased event (no answer in payload — private state)
  // -------------------------------------------------------------------------

  const { error: coinsEventError } = await supabase.from('events').insert({
    game_id: game.id,
    type: 'coins_deducted',
    actor_player_id: caller.id,
    payload: {
      team_id: callerTeam.id,
      amount: cost,
      reason: 'buy_intel',
      intel_ref,
    },
  })
  if (coinsEventError) {
    return NextResponse.json(
      { error: 'event_insert_failed', details: coinsEventError.message },
      { status: 500 },
    )
  }

  const newCoins = callerTeam.coins - cost
  const { data: updatedTeamRow, error: teamUpdateError } = await supabase
    .from('teams')
    .update({ coins: newCoins })
    .eq('id', callerTeam.id)
    .eq('coins', callerTeam.coins) // optimistic: avoid double-debit on retry
    .select()
    .maybeSingle()

  if (teamUpdateError) {
    return NextResponse.json(
      { error: 'team_update_failed', details: teamUpdateError.message },
      { status: 500 },
    )
  }
  if (!updatedTeamRow) {
    // Coins moved under us — re-fetch and surface insufficient_coins.
    const { data: refreshedTeam } = await supabase
      .from('teams')
      .select('coins')
      .eq('id', callerTeam.id)
      .maybeSingle()
    const currentCoins =
      (refreshedTeam as { coins: number } | null)?.coins ?? 0
    return NextResponse.json(
      {
        error: 'insufficient_coins',
        details: { coins: currentCoins, cost },
      },
      { status: 409 },
    )
  }
  const finalCoins = (updatedTeamRow as Team).coins

  // Insert the intel card. The answer is stored on the row (visible to the
  // owning team via RLS when that lands).
  const { data: insertedCardRow, error: cardInsertError } = await supabase
    .from('cards')
    .insert({
      game_id: game.id,
      team_id: callerTeam.id,
      kind: 'intel',
      ref: intel_ref,
      state: 'in_hand',
      payload: answer,
    })
    .select()
    .maybeSingle()

  if (cardInsertError || !insertedCardRow) {
    return NextResponse.json(
      {
        error: 'card_insert_failed',
        details: cardInsertError?.message,
      },
      { status: 500 },
    )
  }
  const card = insertedCardRow as Card

  // Append the (public) intel_purchased event — NO answer.
  const { error: purchaseEventError } = await supabase.from('events').insert({
    game_id: game.id,
    type: 'intel_purchased',
    actor_player_id: caller.id,
    payload: {
      team_id: callerTeam.id,
      intel_ref,
      cost,
    },
  })
  if (purchaseEventError) {
    return NextResponse.json(
      { error: 'event_insert_failed', details: purchaseEventError.message },
      { status: 500 },
    )
  }

  const response: BuyIntelResponse = {
    card,
    answer,
    team_coins: finalCoins,
  }
  return NextResponse.json(response)
}
