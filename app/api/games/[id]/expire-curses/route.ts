import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ExpireCursesResponse, Game, Player, Team } from '@/lib/types'

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
  if (game.status === 'paused') {
    const response: ExpireCursesResponse = { expired_curse_ids: [] }
    return NextResponse.json(response)
  }

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

  const { data: expiredData, error: expiredError } = await supabase.rpc(
    'expire_curses_atomic',
    { p_game_id: game.id, p_actor_player_id: caller.id },
  )
  if (expiredError) {
    return NextResponse.json(
      { error: 'active_curse_expiry_failed', details: expiredError.message },
      { status: 500 },
    )
  }
  const expired_curse_ids = (expiredData ?? []) as string[]

  const response: ExpireCursesResponse = { expired_curse_ids }
  return NextResponse.json(response)
}
