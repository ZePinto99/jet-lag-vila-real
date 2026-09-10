import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGameplayActionBlock } from '@/lib/server/actionLock'
import type { Card, Game, Player, Team } from '@/lib/types'

// ---------------------------------------------------------------------------
// Reject a peer-submitted challenge photo (playtest item D14).
//
// Only the OTHER team may reject. The card goes back to `available` so the
// submitting team can retake the photo and resubmit. No coins are credited.
// ---------------------------------------------------------------------------

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
  const actionBlock = await getGameplayActionBlock(supabase, game.id, caller)
  if (actionBlock) return NextResponse.json({ error: actionBlock }, { status: 409 })

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
  if (caller.team_id === card.team_id) {
    return NextResponse.json({ error: 'cannot_review_own' }, { status: 403 })
  }

  const { data: rejectedData, error: rejectError } = await supabase.rpc(
    'reject_challenge_review_atomic',
    {
      p_game_id: game.id,
      p_card_id: card.id,
      p_reviewer_player_id: caller.id,
      p_reviewer_team_id: caller.team_id,
    },
  )
  if (rejectError) {
    return NextResponse.json(
      { error: 'challenge_reject_failed', details: rejectError.message },
      { status: 500 },
    )
  }
  const rejected = rejectedData as { error?: string } | null
  if (!rejected || rejected.error) {
    const error = rejected?.error ?? 'challenge_reject_failed'
    const status = error === 'cannot_review_own' || error === 'forbidden' ? 403 :
      ['not_pending', 'game_not_in_play', 'game_expired', 'player_respawning', 'actions_locked'].includes(error)
        ? 409 : error === 'not_found' ? 404 : 500
    return NextResponse.json({ error }, { status })
  }

  return NextResponse.json({ ok: true })
}
