import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeScores, pickTimeoutWinner } from '@/lib/results/scoring'
import type {
  EndByTimeoutResponse,
  Game,
  GameEvent,
  Player,
  Team,
} from '@/lib/types'

const DEFAULT_DURATION_MIN = 180

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

  // Load events for scoring.
  const { data: eventsData } = await supabase
    .from('events')
    .select('*')
    .eq('game_id', game.id)
    .order('created_at', { ascending: true })
  const events = (eventsData ?? []) as GameEvent[]

  const scores = computeScores({ events, teams, players })
  const { winner_team_id, reason } = pickTimeoutWinner(scores)

  // Optimistic transition: only fire from current status.
  const { data: updatedRow, error: updateErr } = await supabase
    .from('games')
    .update({ status: 'finished', ended_at: new Date().toISOString() })
    .eq('id', game.id)
    .in('status', ['live', 'flag_found'])
    .select()
    .maybeSingle()

  if (updateErr) {
    return NextResponse.json(
      { error: 'game_update_failed', details: updateErr.message },
      { status: 500 },
    )
  }

  // Lost the race — someone else finished it. Return the already-finished
  // response without duplicating the event.
  if (!updatedRow) {
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

  const finishedGame = updatedRow as Game

  await supabase.from('events').insert({
    game_id: finishedGame.id,
    type: 'game_ended_by_timeout',
    actor_player_id: caller.id,
    payload: {
      winner_team_id,
      reason,
      scores: scores.map((s) => ({
        team_id: s.team_id,
        team_side: s.team_side,
        total: s.total,
      })),
    },
  })

  // Also fire game_won so the rest of the UI (GameOver overlay, history)
  // sees the same terminal event family it already understands.
  if (winner_team_id) {
    await supabase.from('events').insert({
      game_id: finishedGame.id,
      type: 'game_won',
      actor_player_id: caller.id,
      payload: { winner_team_id, reason },
    })
  }

  const response: EndByTimeoutResponse = {
    game: finishedGame,
    winner_team_id,
    reason,
    scores,
  }
  return NextResponse.json(response)
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
  const scores = computeScores({ events, teams, players })

  // Try to honour an existing game_won event's winner; else recompute.
  const wonEvent = [...events]
    .reverse()
    .find((e) => e.type === 'game_won')
  let winner_team_id: string | null
  let reason: EndByTimeoutResponse['reason']
  if (wonEvent) {
    const wp = wonEvent.payload as {
      winner_team_id?: string | null
      reason?: EndByTimeoutResponse['reason']
    }
    winner_team_id = wp.winner_team_id ?? null
    reason = wp.reason ?? 'flag_returned'
  } else {
    const picked = pickTimeoutWinner(scores)
    winner_team_id = picked.winner_team_id
    reason = picked.reason
  }
  return { game, winner_team_id, reason, scores }
}
