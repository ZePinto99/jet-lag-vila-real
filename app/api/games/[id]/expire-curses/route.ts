import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import type {
  ActiveCurse,
  ExpireCursesResponse,
  Game,
  Player,
  Team,
} from '@/lib/types'

// ---------------------------------------------------------------------------
// Idempotent housekeeping: find expired active_curses rows for this game,
// delete them, and emit a curse_expired event per row.
//
// Safe to call frequently from any player's client. We do a soft auth check:
// the caller's device_id must match a player in the game. That keeps random
// strangers from polluting the event log.
// ---------------------------------------------------------------------------

const ExpireCursesRequestSchema = z.object({
  device_id: z.string().min(1).max(128),
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

  const parsed = ExpireCursesRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', details: parsed.error.issues },
      { status: 400 },
    )
  }
  const { device_id } = parsed.data

  const supabase = createAdminClient()

  // 1. Game must exist.
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

  // 2. Caller must be a player in this game (soft auth on device_id).
  const { data: teamsData, error: teamsError } = await supabase
    .from('teams')
    .select('id')
    .eq('game_id', game.id)

  if (teamsError || !teamsData) {
    return NextResponse.json(
      { error: 'team_lookup_failed', details: teamsError?.message },
      { status: 500 },
    )
  }
  const teamIds = (teamsData as Pick<Team, 'id'>[]).map((t) => t.id)
  if (teamIds.length === 0) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

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

  // 3. Find expired rows.
  const nowIso = new Date().toISOString()
  const { data: expiredRows, error: expiredLookupError } = await supabase
    .from('active_curses')
    .select('*')
    .eq('game_id', game.id)
    .not('expires_at', 'is', null)
    .lt('expires_at', nowIso)

  if (expiredLookupError) {
    return NextResponse.json(
      {
        error: 'active_curse_lookup_failed',
        details: expiredLookupError.message,
      },
      { status: 500 },
    )
  }
  const expired = (expiredRows ?? []) as ActiveCurse[]

  const expired_curse_ids: string[] = []

  // 4. For each: insert curse_expired event, then delete the row.
  // Sequential keeps event ordering predictable for clients listening on
  // postgres_changes. With at most one or two expirations per cron tick this
  // isn't a performance concern.
  for (const row of expired) {
    const { error: eventError } = await supabase.from('events').insert({
      game_id: game.id,
      type: 'curse_expired',
      actor_player_id: caller.id,
      payload: {
        curse_id: row.id,
        target_team_id: row.target_team_id,
        curse_ref: row.curse_ref,
      },
    })
    if (eventError) {
      return NextResponse.json(
        { error: 'event_insert_failed', details: eventError.message },
        { status: 500 },
      )
    }

    const { error: deleteError } = await supabase
      .from('active_curses')
      .delete()
      .eq('id', row.id)
    if (deleteError) {
      return NextResponse.json(
        {
          error: 'active_curse_delete_failed',
          details: deleteError.message,
        },
        { status: 500 },
      )
    }

    expired_curse_ids.push(row.id)
  }

  const response: ExpireCursesResponse = { expired_curse_ids }
  return NextResponse.json(response)
}
