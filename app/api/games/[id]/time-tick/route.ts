import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Game, Player, Team } from '@/lib/types'

// ---------------------------------------------------------------------------
// Idempotent housekeeping: time bonus + Power Hour (RULEBOOK §7.2, elevated).
//
// Every 30 minutes of elapsed game time, EACH team earns coins automatically.
// Every 2nd tick (i.e. every 60 minutes) is a "Power Hour" worth +40 instead
// of the normal +20.
//
// The idempotency marker for interval N is a single `time_bonus` event with
// payload `{ interval: N, ... }`. We count how many such events exist and only
// credit intervals that haven't been credited yet. Safe to call repeatedly
// from any player's client (soft auth on device_id), like expire-curses.
// ---------------------------------------------------------------------------

const TimeTickRequestSchema = z.object({
  device_id: z.string().min(1).max(128),
})

// Coins per regular tick / per Power Hour tick.
const BONUS_REGULAR = 20
const BONUS_POWER_HOUR = 40
// Tick cadence in minutes.
const TICK_INTERVAL_MIN = 30

interface TimeTickResponse {
  credited_intervals: number[]
  is_power_hour: boolean
}

// A Power Hour is every 2nd tick (interval index even: 2, 4, 6, …).
function isPowerHourInterval(interval: number): boolean {
  return interval % 2 === 0
}

function bonusForInterval(interval: number): number {
  return isPowerHourInterval(interval) ? BONUS_POWER_HOUR : BONUS_REGULAR
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

  const nowMs = Date.now()
  const elapsedMin = (nowMs - startedMs) / 60_000
  const intervalsElapsed = Math.floor(elapsedMin / TICK_INTERVAL_MIN)

  if (intervalsElapsed <= 0) {
    const empty: TimeTickResponse = {
      credited_intervals: [],
      is_power_hour: false,
    }
    return NextResponse.json(empty)
  }

  // 5. Count how many intervals we've already credited. Each carries one
  // `time_bonus` event — these are the idempotency markers.
  const { data: bonusEventsData, error: bonusEventsError } = await supabase
    .from('events')
    .select('*')
    .eq('game_id', game.id)
    .eq('type', 'time_bonus')

  if (bonusEventsError) {
    return NextResponse.json(
      { error: 'event_lookup_failed', details: bonusEventsError.message },
      { status: 500 },
    )
  }
  const alreadyCredited = (bonusEventsData ?? []).length

  if (alreadyCredited >= intervalsElapsed) {
    // Nothing new this window.
    const empty: TimeTickResponse = {
      credited_intervals: [],
      is_power_hour: false,
    }
    return NextResponse.json(empty)
  }

  // 6. Credit each newly-elapsed interval. Both teams, sequentially, to keep
  // event ordering predictable for clients listening on postgres_changes.
  const credited_intervals: number[] = []

  for (let interval = alreadyCredited + 1; interval <= intervalsElapsed; interval++) {
    const amount = bonusForInterval(interval)
    const powerHour = isPowerHourInterval(interval)

    for (const team of teams) {
      // 6a. Append the coins_credited ledger event FIRST.
      const { error: coinsEventError } = await supabase.from('events').insert({
        game_id: game.id,
        type: 'coins_credited',
        actor_player_id: caller.id,
        payload: {
          team_id: team.id,
          amount,
          reason: 'time_bonus',
          interval,
        },
      })
      if (coinsEventError) {
        return NextResponse.json(
          { error: 'event_insert_failed', details: coinsEventError.message },
          { status: 500 },
        )
      }

      // 6b. Then bump the materialized counter. coins is monotonic here; a
      // plain add is fine (re-runs are guarded by the time_bonus marker below,
      // so we never re-enter this interval).
      const { error: teamUpdateError } = await supabase
        .from('teams')
        .update({ coins: team.coins + amount })
        .eq('id', team.id)
      if (teamUpdateError) {
        return NextResponse.json(
          { error: 'team_update_failed', details: teamUpdateError.message },
          { status: 500 },
        )
      }
      // Keep our in-memory snapshot current in case both teams share a row in
      // future (they don't today, but this keeps the add correct if a team
      // appears twice for any reason).
      team.coins += amount
    }

    // 6c. Single idempotency marker for this interval (also the broadcast the
    // clients listen for to flash the Power Hour banner).
    const { error: markerError } = await supabase.from('events').insert({
      game_id: game.id,
      type: 'time_bonus',
      actor_player_id: caller.id,
      payload: {
        interval,
        amount,
        is_power_hour: powerHour,
      },
    })
    if (markerError) {
      return NextResponse.json(
        { error: 'event_insert_failed', details: markerError.message },
        { status: 500 },
      )
    }

    credited_intervals.push(interval)
  }

  const latest = credited_intervals[credited_intervals.length - 1]
  const response: TimeTickResponse = {
    credited_intervals,
    is_power_hour:
      typeof latest === 'number' ? isPowerHourInterval(latest) : false,
  }
  return NextResponse.json(response)
}

// Re-export for callers/tests that want the response shape without redeclaring.
export type { TimeTickResponse }
