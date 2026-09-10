import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { supportsTeamSize } from '@/lib/teamSizeEligibility'
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

  const { count: teamSizeCount, error: teamSizeError } = await supabase
    .from('players')
    .select('id', { count: 'exact', head: true })
    .eq('team_id', callerTeam.id)
  if (teamSizeError) {
    return NextResponse.json(
      { error: 'player_lookup_failed', details: teamSizeError.message },
      { status: 500 },
    )
  }
  const teamSize = teamSizeCount ?? 0
  const eligibleCatalog = CATALOG.filter((candidate) =>
    supportsTeamSize(candidate, teamSize),
  )
  const eligibleRefs = new Set(eligibleCatalog.map((candidate) => candidate.id))

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

  // A game created before team-size eligibility was introduced may already
  // have an impossible teammate challenge in hand. Retire only unsubmitted
  // cards so the active slots can be refilled from the eligible catalog.
  const ineligibleAvailableIds = challengeCards
    .filter((card) => card.state === 'available' && !eligibleRefs.has(card.ref))
    .map((card) => card.id)
  if (ineligibleAvailableIds.length > 0) {
    const { error: retireError } = await supabase
      .from('cards')
      .update({ state: 'expired' })
      .in('id', ineligibleAvailableIds)
    if (retireError) {
      return NextResponse.json(
        { error: 'card_update_failed', details: retireError.message },
        { status: 500 },
      )
    }
  }
  const eligibleChallengeCards = challengeCards.filter(
    (card) => !ineligibleAvailableIds.includes(card.id),
  )

  // 5. Lazy initialisation: top up `available` to 3 from the unused pool.
  //    Pending (awaiting peer review) cards count toward the active cap so we
  //    don't refill past 3 while some are under review (D14).
  let available = eligibleChallengeCards.filter((c) => c.state === 'available')
  const pendingCards = eligibleChallengeCards.filter((c) => c.state === 'pending')
  const needed =
    ACTIVE_CHALLENGES_TARGET - available.length - pendingCards.length
  if (needed > 0) {
    const { error: drawError } = await supabase.rpc('draw_challenges_atomic', {
      p_game_id: game.id,
      p_team_id: callerTeam.id,
      p_catalog_refs: eligibleCatalog.map((candidate) => candidate.id),
      p_target_count: ACTIVE_CHALLENGES_TARGET,
    })
    if (drawError) {
      return NextResponse.json(
        { error: 'card_insert_failed', details: drawError.message },
        { status: 500 },
      )
    }
    const { data: refreshedRows, error: refreshError } = await supabase
      .from('cards')
      .select('*')
      .eq('game_id', game.id)
      .eq('team_id', callerTeam.id)
      .eq('kind', 'challenge')
    if (refreshError) {
      return NextResponse.json(
        { error: 'cards_lookup_failed', details: refreshError.message },
        { status: 500 },
      )
    }
    const refreshed = (refreshedRows ?? []) as Card[]
    available = refreshed.filter(
      (card) => card.state === 'available' && eligibleRefs.has(card.ref),
    )
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
