import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
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
// Accept a peer-submitted challenge photo (playtest item D14).
//
// Only the OTHER team may accept. On accept, the submitting team is credited
// (reward + first-blood if applicable) and a replacement challenge is drawn —
// the same award path as a non-photo auto-complete.
// ---------------------------------------------------------------------------

const CATALOG = challengesCatalog as ChallengeDefinition[]
const CATALOG_BY_ID = new Map<string, ChallengeDefinition>(
  CATALOG.map((c) => [c.id, c]),
)

const RequestSchema = z.object({
  device_id: z.string().min(1).max(128),
  player_id: z.string().uuid(),
  card_id: z.string().uuid(),
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
  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', details: parsed.error.issues },
      { status: 400 },
    )
  }
  const { device_id, player_id, card_id } = parsed.data

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

  // Load the pending card.
  const { data: cardRow, error: cardError } = await supabase
    .from('cards')
    .select('*')
    .eq('id', card_id)
    .eq('game_id', game.id)
    .eq('kind', 'challenge')
    .maybeSingle()
  if (cardError) {
    return NextResponse.json(
      { error: 'cards_lookup_failed', details: cardError.message },
      { status: 500 },
    )
  }
  if (!cardRow) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const card = cardRow as Card
  if (card.state !== 'pending') {
    return NextResponse.json({ error: 'not_pending' }, { status: 409 })
  }
  // Only the opposing team may review.
  if (caller.team_id === card.team_id) {
    return NextResponse.json({ error: 'cannot_review_own' }, { status: 403 })
  }

  const submittingTeam = teams.find((t) => t.id === card.team_id)
  const def = CATALOG_BY_ID.get(card.ref)
  if (!submittingTeam || !def) {
    return NextResponse.json({ error: 'invalid_challenge' }, { status: 409 })
  }

  const submittedBy =
    typeof card.payload?.submitted_by === 'string'
      ? (card.payload.submitted_by as string)
      : caller.id

  try {
    const award = await awardChallenge({
      supabase,
      game,
      team: submittingTeam,
      card,
      def,
      actorPlayerId: submittedBy,
      reviewedByTeamId: caller.team_id,
    })
    const response: SubmitChallengeResponse = {
      status: 'completed',
      challenge_ref: card.ref,
      ...award,
    }
    return NextResponse.json(response)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'award_failed'
    const status = message === 'challenge_not_available' ? 409 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
