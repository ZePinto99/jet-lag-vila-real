import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeScores } from '@/lib/results/scoring'
import type {
  Game,
  GameEvent,
  GameResultsResponse,
  Player,
  Team,
  WinReason,
} from '@/lib/types'

const QuerySchema = z.object({
  device_id: z.string().min(1).max(128),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(100),
})

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params
  const url = new URL(request.url)
  const parsed = QuerySchema.safeParse({
    device_id: url.searchParams.get('device_id') ?? undefined,
    offset: url.searchParams.get('offset') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_query', details: parsed.error.issues },
      { status: 400 },
    )
  }
  const { device_id, offset, limit } = parsed.data
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
  if (game.status !== 'finished') {
    return NextResponse.json({ error: 'game_not_finished' }, { status: 409 })
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
  const { data: playersData, error: playersError } = await supabase
    .from('players')
    .select('*')
    .in('team_id', teams.map((team) => team.id))
  if (playersError) {
    return NextResponse.json(
      { error: 'player_lookup_failed', details: playersError.message },
      { status: 500 },
    )
  }
  const players = (playersData ?? []) as Player[]
  if (!players.some((player) => player.device_id === device_id)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // This complete ledger is the authoritative scoring input. It is purposely
  // separate from the paginated display query below.
  const { data: allEventsData, error: allEventsError } = await supabase
    .from('events')
    .select('*')
    .eq('game_id', game.id)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (allEventsError) {
    return NextResponse.json(
      { error: 'events_lookup_failed', details: allEventsError.message },
      { status: 500 },
    )
  }
  const allEvents = (allEventsData ?? []) as GameEvent[]
  const terminal = [...allEvents].reverse().find(
    (event) => event.type === 'game_won' || event.type === 'game_ended_by_timeout',
  )
  if (!terminal) {
    return NextResponse.json({ error: 'terminal_result_missing' }, { status: 500 })
  }
  const terminalPayload = terminal.payload as {
    winner_team_id?: string | null
    reason?: WinReason
  }
  const defaultReason: WinReason = terminal.type === 'game_won'
    ? 'flag_returned'
    : 'timeout_points'

  // An offset past the last row is a valid request for an empty page, not a
  // server fault. PostgREST answers `.range()` beyond the row count with
  // "Requested range not satisfiable", which funnelled into the generic 500
  // below — so with 28 events, offset=28 returned 200 while offset=29 returned
  // HTTP 500. Off by exactly one from the page immediately before it, and
  // trivially reachable by a client that keeps paging.
  //
  // `allEvents` is already loaded above for the terminal-event lookup, so the
  // count is free. Short-circuit rather than letting PostgREST decide.
  const totalEvents = allEvents.length
  let pageData: typeof allEvents = []
  if (offset < totalEvents) {
    const { data, error: pageError } = await supabase
      .from('events')
      .select('*')
      .eq('game_id', game.id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + limit - 1)
    if (pageError) {
      return NextResponse.json(
        { error: 'events_lookup_failed', details: pageError.message },
        { status: 500 },
      )
    }
    pageData = data ?? []
  }
  const count = totalEvents
  const total = count ?? allEvents.length
  const timeoutEvent = [...allEvents]
    .reverse()
    .find((event) => event.type === 'game_ended_by_timeout')
  const timeoutScores = (timeoutEvent?.payload as { scores?: unknown } | undefined)?.scores
  const response: GameResultsResponse = {
    game,
    winner_team_id: terminalPayload.winner_team_id ?? null,
    reason: terminalPayload.reason ?? defaultReason,
    scores: Array.isArray(timeoutScores)
      ? (timeoutScores as GameResultsResponse['scores'])
      : computeScores({ events: allEvents, teams, players }),
    timeline_events: (pageData ?? []) as GameEvent[],
    timeline_total: total,
    timeline_offset: offset,
    timeline_next_offset: offset + limit < total ? offset + limit : null,
  }
  return NextResponse.json(response)
}
