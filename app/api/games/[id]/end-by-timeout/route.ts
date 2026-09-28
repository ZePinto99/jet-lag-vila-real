import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeScores, pickTimeoutWinner } from '@/lib/results/scoring'
import { DEFAULT_DURATION_MIN } from '@/lib/gameConstants'
import type {
  EndByTimeoutResponse,
  Game,
  GameEvent,
  Player,
  Team,
} from '@/lib/types'

const Body = z.object({
  device_id: z.string().min(1).max(128),
})

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

  const { data: gameRow, error: gameErr } = await supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
    .single()
  if (gameErr || !gameRow) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const game = gameRow as Game

  // If already finished, return current snapshot (idempotent).
  // Pull most-recent game_won event to honour the same response shape.
  if (game.status === 'finished') {
    return NextResponse.json(
      await buildFinishedResponse(supabase, game),
      { status: 200 },
    )
  }

  if (game.status !== 'live' && game.status !== 'flag_found') {
    return NextResponse.json({ error: 'game_not_in_play' }, { status: 409 })
  }

  if (!game.started_at) {
    return NextResponse.json({ error: 'game_not_started' }, { status: 409 })
  }

  const durationMs =
    (game.config?.duration_minutes ?? DEFAULT_DURATION_MIN) * 60 * 1000
  const startMs = new Date(game.started_at).getTime()
  const endMs = startMs + durationMs
  if (Date.now() < endMs) {
    return NextResponse.json(
      { error: 'not_yet_expired', details: { ms_remaining: endMs - Date.now() } },
      { status: 409 },
    )
  }

  // Caller must be a player in this game.
  const { data: teamsData } = await supabase
    .from('teams')
    .select('*')
    .eq('game_id', game.id)
  const teams = (teamsData ?? []) as Team[]
  const teamIds = teams.map((t) => t.id)
  const { data: playersData } = await supabase
    .from('players')
    .select('*')
    .in('team_id', teamIds)
  const players = (playersData ?? []) as Player[]
  const caller = players.find((p) => p.device_id === parsed.data.device_id)
  if (!caller) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // The database locks the game + both team balances, recomputes the complete
  // score from the ledger, performs the final coin flip when needed, and
  // persists the terminal events in one transaction. Concurrent retries return
  // that stored result and never flip twice.
  const { data: finishData, error: finishError } = await supabase.rpc(
    'finish_game_by_timeout_atomic',
    { p_game_id: game.id, p_actor_player_id: caller.id },
  )
  if (finishError) {
    return NextResponse.json(
      { error: 'game_finish_failed', details: finishError.message },
      { status: 500 },
    )
  }
  const finish = finishData as (EndByTimeoutResponse & { error?: string }) | null
  if (!finish || finish.error) {
    if (finish?.error === 'already_finished') {
      const { data: refetched } = await supabase
        .from('games')
        .select('*')
        .eq('id', game.id)
        .single()
      return NextResponse.json(
        await buildFinishedResponse(supabase, refetched as Game),
        { status: 200 },
      )
    }
    return NextResponse.json(
      { error: finish?.error ?? 'game_finish_failed' },
      { status: finish?.error === 'not_yet_expired' ? 409 : 500 },
    )
  }
  return NextResponse.json(finish)
}

async function buildFinishedResponse(
  supabase: ReturnType<typeof createAdminClient>,
  game: Game,
): Promise<EndByTimeoutResponse> {
  const { data: teamsData } = await supabase
    .from('teams')
    .select('*')
    .eq('game_id', game.id)
  const teams = (teamsData ?? []) as Team[]
  const teamIds = teams.map((t) => t.id)
  const { data: playersData } = await supabase
    .from('players')
    .select('*')
    .in('team_id', teamIds)
  const players = (playersData ?? []) as Player[]
  const { data: eventsData } = await supabase
    .from('events')
    .select('*')
    .eq('game_id', game.id)
    .order('created_at', { ascending: true })
  const events = (eventsData ?? []) as GameEvent[]
  const timeoutEvent = [...events]
    .reverse()
    .find((event) => event.type === 'game_ended_by_timeout')
  const persistedScores = (timeoutEvent?.payload as { scores?: unknown } | undefined)?.scores
  // Timeout results are immutable historical records. Never reinterpret an
  // old finished game after scoring rules change.
  const scores = Array.isArray(persistedScores)
    ? (persistedScores as EndByTimeoutResponse['scores'])
    : computeScores({ events, teams, players })

  // Try to honour a persisted winner; else recompute.
  //
  // finish_game_by_timeout_atomic (0045:241-251) writes the winner into BOTH
  // `game_ended_by_timeout` and `game_won`, including the mandatory coin-flip
  // result on an exact tie (0045:236-237, reason 'timeout_coin_flip'). Reading
  // only `game_won` meant that if that second insert was ever missing — a
  // legacy game, or a partially-applied finish — we fell through to
  // pickTimeoutWinner(), which has no coin-flip branch and returns
  // { winner_team_id: null, reason: 'timeout_tied' }. That contradicts both the
  // persisted record and RULEBOOK §13 ("Then coin flip"), and it would show a
  // player a tie for a game the server had already decided.
  //
  // So: prefer whichever terminal event actually recorded a winner, and only
  // recompute when neither did.
  const wonEvent = [...events]
    .reverse()
    .find((e) => e.type === 'game_won')
  let winner_team_id: string | null
  let reason: EndByTimeoutResponse['reason']
  const persistedTerminal = (wonEvent ?? timeoutEvent)?.payload as
    | { winner_team_id?: string | null; reason?: EndByTimeoutResponse['reason'] }
    | undefined
  if (persistedTerminal?.winner_team_id) {
    winner_team_id = persistedTerminal.winner_team_id
    reason = persistedTerminal.reason ?? (wonEvent ? 'flag_returned' : 'timeout_points')
  } else if (wonEvent) {
    // A game_won with no winner id is only possible on legacy rows; keep its
    // reason so the overlay still explains the ending.
    winner_team_id = null
    reason = persistedTerminal?.reason ?? 'flag_returned'
  } else {
    const picked = pickTimeoutWinner(scores)
    winner_team_id = picked.winner_team_id
    reason = picked.reason
  }
  return { game, winner_team_id, reason, scores }
}
