import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import challengesCatalog from '@/data/challenges.json'
import type {
  Card,
  ChallengeDefinition,
  Game,
  GetChallengesResponse,
  Player,
  Team,
} from '@/lib/types'

// ---------------------------------------------------------------------------
// Constants (RULEBOOK §8.1 — up to 3 active challenges at any time)
// ---------------------------------------------------------------------------

const ACTIVE_CHALLENGES_TARGET = 3

// ---------------------------------------------------------------------------
// Challenge catalog
// ---------------------------------------------------------------------------

const CATALOG = challengesCatalog as ChallengeDefinition[]
const CATALOG_BY_ID = new Map<string, ChallengeDefinition>(
  CATALOG.map((c) => [c.id, c]),
)

// ---------------------------------------------------------------------------
// Query validation
// ---------------------------------------------------------------------------

const QuerySchema = z.object({
  device_id: z.string().min(1).max(128),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params

  const url = new URL(request.url)
  const parsedQuery = QuerySchema.safeParse({
    device_id: url.searchParams.get('device_id') ?? undefined,
  })
  if (!parsedQuery.success) {
    return NextResponse.json(
      { error: 'invalid_body', details: parsedQuery.error.issues },
      { status: 400 },
    )
  }
  const { device_id } = parsedQuery.data

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

  // 2. Game must be in active play (live or flag_found).
  if (game.status !== 'live' && game.status !== 'flag_found') {
    return NextResponse.json({ error: 'game_not_in_play' }, { status: 409 })
  }

  // 3. Identify the caller via device_id, scoped to this game's teams.
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
  if (!caller) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const callerTeam = teams.find((t) => t.id === caller.team_id)
  if (!callerTeam) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // 4. Load all the team's challenge cards (any state). We need every state to
  //    determine which catalog entries are "unused" (never drawn).
  const { data: challengeCardsData, error: challengeCardsError } =
    await supabase
      .from('cards')
      .select('*')
      .eq('game_id', game.id)
      .eq('team_id', callerTeam.id)
      .eq('kind', 'challenge')

  if (challengeCardsError) {
    return NextResponse.json(
      { error: 'cards_lookup_failed', details: challengeCardsError.message },
      { status: 500 },
    )
  }
  const challengeCards = (challengeCardsData ?? []) as Card[]

  // 5. Lazy initialisation: top up `available` to 3 from the unused pool.
  //    Pending (awaiting peer review) cards count toward the active cap so we
  //    don't refill past 3 while some are under review (D14).
  let available = challengeCards.filter((c) => c.state === 'available')
  const pendingCards = challengeCards.filter((c) => c.state === 'pending')
  const drawnRefs = new Set(challengeCards.map((c) => c.ref))
  const unusedPool = CATALOG.filter((c) => !drawnRefs.has(c.id))

  const needed =
    ACTIVE_CHALLENGES_TARGET - available.length - pendingCards.length
  if (needed > 0 && unusedPool.length > 0) {
    const remaining = unusedPool.slice()
    const toInsert: Array<{
      game_id: string
      team_id: string
      kind: 'challenge'
      ref: string
      state: 'available'
      payload: Record<string, unknown>
    }> = []
    for (let i = 0; i < needed && remaining.length > 0; i++) {
      const idx = Math.floor(Math.random() * remaining.length)
      const pick = remaining[idx]
      remaining.splice(idx, 1)
      toInsert.push({
        game_id: game.id,
        team_id: callerTeam.id,
        kind: 'challenge',
        ref: pick.id,
        state: 'available',
        payload: {},
      })
    }

    if (toInsert.length > 0) {
      const { data: insertedRows, error: insertError } = await supabase
        .from('cards')
        .insert(toInsert)
        .select()

      if (insertError) {
        return NextResponse.json(
          { error: 'card_insert_failed', details: insertError.message },
          { status: 500 },
        )
      }
      const inserted = (insertedRows ?? []) as Card[]
      available = available.concat(inserted)
    }
  }

  // 6. Resolve active challenges to their definitions. Drop any cards whose
  //    ref no longer exists in the catalog (shouldn't happen, but degrade).
  const activeDefs: ChallengeDefinition[] = []
  const rejectedRefs: string[] = []
  for (const card of available) {
    const def = CATALOG_BY_ID.get(card.ref)
    if (!def) continue
    activeDefs.push(def)
    if ((card.payload as Record<string, unknown>)?.review_status === 'rejected') {
      rejectedRefs.push(card.ref)
    }
  }

  const pending: GetChallengesResponse['pending'] = []
  for (const card of pendingCards) {
    const def = CATALOG_BY_ID.get(card.ref)
    if (!def) continue
    const photo = (card.payload as Record<string, unknown>)?.photo_url
    pending.push({
      challenge: def,
      card_id: card.id,
      photo_url: typeof photo === 'string' ? photo : '',
    })
  }

  const response: GetChallengesResponse = {
    active: activeDefs,
    pending,
    rejected_refs: rejectedRefs,
  }
  return NextResponse.json(response)
}
