import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { supportsTeamSize } from '@/lib/teamSizeEligibility'
import challengesCatalog from '@/data/challenges.json'
import type { Card, ChallengeDefinition, Game, Player, Team } from '@/lib/types'

const Body = z.object({ device_id: z.string().min(1).max(128) })
const CATALOG = challengesCatalog as ChallengeDefinition[]
const BY_REF = new Map(CATALOG.map((definition) => [definition.id, definition]))

function reviewSubmittedAtMs(card: Card): number {
  const submittedAt = card.payload?.submitted_at
  if (typeof submittedAt === 'string') {
    const parsed = Date.parse(submittedAt)
    if (Number.isFinite(parsed)) return parsed
  }
  return Date.parse(card.updated_at)
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const parsed = Body.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', details: parsed.error.issues },
      { status: 400 },
    )
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
  if (game.status !== 'live' && game.status !== 'flag_found') {
    return NextResponse.json({ resolved_card_ids: [] })
  }

  const { data: teamRows, error: teamError } = await supabase
    .from('teams')
    .select('*')
    .eq('game_id', game.id)
  if (teamError || !teamRows) {
    return NextResponse.json(
      { error: 'team_lookup_failed', details: teamError?.message },
      { status: 500 },
    )
  }
  const teams = teamRows as Team[]
  const teamIds = teams.map((team) => team.id)
  const { data: playerRows, error: playerError } = await supabase
    .from('players')
    .select('*')
    .in('team_id', teamIds)
  if (playerError) {
    return NextResponse.json(
      { error: 'player_lookup_failed', details: playerError.message },
      { status: 500 },
    )
  }
  const players = (playerRows ?? []) as Player[]
  if (!players.some((player) => player.device_id === parsed.data.device_id)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const cutoffMs = Date.now() - 120_000
  const { data: cardRows, error: cardError } = await supabase
    .from('cards')
    .select('*')
    .eq('game_id', game.id)
    .eq('kind', 'challenge')
    .order('updated_at', { ascending: true })
  if (cardError) {
    return NextResponse.json(
      { error: 'cards_lookup_failed', details: cardError.message },
      { status: 500 },
    )
  }
  const cards = (cardRows ?? []) as Card[]
  const due = cards.filter(
    (card) =>
      card.state === 'pending' && reviewSubmittedAtMs(card) <= cutoffMs,
  )
  const resolvedCardIds: string[] = []

  for (const card of due) {
    const definition = BY_REF.get(card.ref)
    if (!definition) continue
    const teamSize = players.filter((player) => player.team_id === card.team_id).length
    const drawnRefs = new Set(
      cards.filter((candidate) => candidate.team_id === card.team_id).map((candidate) => candidate.ref),
    )
    const replacementRefs = CATALOG.filter(
      (candidate) =>
        !drawnRefs.has(candidate.id) && supportsTeamSize(candidate, teamSize),
    ).map((candidate) => candidate.id)

    const { data, error } = await supabase.rpc(
      'auto_accept_challenge_review_atomic',
      {
        p_game_id: game.id,
        p_card_id: card.id,
        p_reward_coins: definition.reward_coins,
        p_replacement_refs: replacementRefs,
      },
    )
    if (error) {
      return NextResponse.json(
        { error: 'challenge_auto_accept_failed', details: error.message },
        { status: 500 },
      )
    }
    const result = data as { auto_accepted?: boolean; error?: string } | null
    if (result?.auto_accepted) resolvedCardIds.push(card.id)
    else if (result?.error && !['not_pending', 'review_window_open'].includes(result.error)) {
      return NextResponse.json({ error: result.error }, { status: 409 })
    }
  }

  return NextResponse.json({ resolved_card_ids: resolvedCardIds })
}
