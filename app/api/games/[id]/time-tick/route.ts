import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { dueTimeBonusIntervals } from '@/lib/timeBonuses'
import type { Game, Player, Team } from '@/lib/types'

// ---------------------------------------------------------------------------
// Idempotent housekeeping: time bonus (RULEBOOK §7.2).
//
// Every 30 minutes of elapsed game time, EACH team earns coins automatically.
// The idempotency marker for interval N is a single `time_bonus` event with
// payload `{ interval: N, ... }`. We count how many such events exist and only
// credit intervals that haven't been credited yet. Safe to call repeatedly
// from any player's client (soft auth on device_id), like expire-curses.
// ---------------------------------------------------------------------------

const TimeTickRequestSchema = z.object({
  device_id: z.string().min(1).max(128),
})

const TIME_BONUS = 20
const DEFAULT_DURATION_MIN = 180

interface TimeTickResponse {
  credited_intervals: number[]
  is_power_hour: boolean
}

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

  const parsed = TimeTickRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', details: parsed.error.issues },
      { status: 400 },
    )
  }
  const { device_id } = parsed.data

  const supabase = createAdminClient()

  // 1. Game must exist and be in play.
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

  // 3. Caller must be a player in this game (soft auth on device_id).
  const { data: playersData, error: playersError } = await supabase
    .from('players')
    .select('id')
    .in('team_id', teamIds)
    .eq('device_id', device_id)
    .limit(1)

  if (playersError) {
    return NextResponse.json(
      { error: 'player_lookup_failed', details: playersError.message },
      { status: 500 },
    )
  }
  const caller = (playersData ?? [])[0] as Pick<Player, 'id'> | undefined
  if (!caller) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // 4. Need a start time to measure elapsed game time against.
  if (!game.started_at) {
    return NextResponse.json({ error: 'game_not_started' }, { status: 409 })
  }
  const startedMs = new Date(game.started_at).getTime()
  if (Number.isNaN(startedMs)) {
    return NextResponse.json({ error: 'game_not_started' }, { status: 409 })
  }

  const intervalsElapsed = dueTimeBonusIntervals(
    startedMs,
    Date.now(),
    game.config?.duration_minutes ?? DEFAULT_DURATION_MIN,
  )

  if (intervalsElapsed <= 0) {
    const empty: TimeTickResponse = {
      credited_intervals: [],
      is_power_hour: false,
    }
    return NextResponse.json(empty)
  }

  // 5. Load credited interval ids. The atomic RPC below is the authoritative
  // idempotency guard; this read only avoids unnecessary calls in the common
  // case and lets us repair a rare missing interval instead of assuming event
  // count always equals the highest interval.
  const { data: bonusEventsData, error: bonusEventsError } = await supabase
    .from('events')
    .select('payload')
    .eq('game_id', game.id)
    .eq('type', 'time_bonus')

  if (bonusEventsError) {
    return NextResponse.json(
      { error: 'event_lookup_failed', details: bonusEventsError.message },
      { status: 500 },
    )
  }
  const alreadyCredited = new Set(
    (bonusEventsData ?? [])
      .map((event) => Number(event.payload?.interval))
      .filter((interval) => Number.isInteger(interval) && interval > 0),
  )

  // 6. Credit each newly-elapsed interval. Both teams, sequentially, to keep
  // event ordering predictable for clients listening on postgres_changes.
  const credited_intervals: number[] = []

  for (let interval = 1; interval <= intervalsElapsed; interval++) {
    if (alreadyCredited.has(interval)) continue
    const amount = TIME_BONUS
    const { data: applied, error: applyError } = await supabase.rpc(
      'apply_time_bonus_interval',
      {
        p_game_id: game.id,
        p_actor_player_id: caller.id,
        p_interval: interval,
        p_amount: amount,
        p_is_power_hour: false,
      },
    )
    if (applyError) {
      return NextResponse.json(
        { error: 'time_bonus_failed', details: applyError.message },
        { status: 500 },
      )
    }
    if (applied === true) credited_intervals.push(interval)
  }

  const response: TimeTickResponse = {
    credited_intervals,
    is_power_hour: false,
  }
  return NextResponse.json(response)
}

// Re-export for callers/tests that want the response shape without redeclaring.
export type { TimeTickResponse }
