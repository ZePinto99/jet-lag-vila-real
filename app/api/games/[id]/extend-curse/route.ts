import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import cursesSeed from '@/data/curses.json'
import type { ActiveCurse, Game, Player, Team } from '@/lib/types'

// ---------------------------------------------------------------------------
// Extend a "stay in place" curse's expiry (playtest item E15).
//
// The Frozen curse (and any other [A] freeze) is only "served" while the target
// actually stays put. The target's own client detects out-of-place time and
// calls this to push expires_at forward by that many seconds — so wandering
// prolongs the freeze instead of running the clock out. Honor-adjacent: only
// the CURSED team can extend its own curse, and we cap total extension so a
// buggy client can't grief.
//
// Ephemeral running state only (active_curses.expires_at); no event is written
// (this isn't a historical fact, and per-tick events would spam the log). The
// active_curses UPDATE broadcasts to the target team's clients via realtime.
// ---------------------------------------------------------------------------

interface CurseSeed {
  id: string
  duration_minutes: number | null
}
const CURSE_CATALOG = cursesSeed as CurseSeed[]

// Curses whose duration is gated on staying in place.
const EXTENDABLE = new Set(['curse.frozen'])

// Never extend a curse to more than this multiple of its nominal duration.
const MAX_EXTENSION_FACTOR = 4

const RequestSchema = z.object({
  device_id: z.string().min(1).max(128),
  curse_id: z.string().uuid(),
  extend_seconds: z.number().int().min(1).max(120),
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
  const { device_id, curse_id, extend_seconds } = parsed.data

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
  if (!gameRow) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const game = gameRow as Game
  if (game.status !== 'live' && game.status !== 'flag_found') {
    return NextResponse.json({ error: 'game_not_in_play' }, { status: 409 })
  }

  // 2. Identify the caller and their team.
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
  if (!caller) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // 3. Load the curse; it must target the caller's own team and be extendable.
  const { data: curseRow, error: curseError } = await supabase
    .from('active_curses')
    .select('*')
    .eq('id', curse_id)
    .eq('game_id', game.id)
    .maybeSingle()
  if (curseError) {
    return NextResponse.json(
      { error: 'curse_lookup_failed', details: curseError.message },
      { status: 500 },
    )
  }
  if (!curseRow) {
    return NextResponse.json({ error: 'curse_not_found' }, { status: 404 })
  }
  const curse = curseRow as ActiveCurse
  if (curse.target_team_id !== caller.team_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  if (!EXTENDABLE.has(curse.curse_ref) || !curse.expires_at) {
    return NextResponse.json({ error: 'not_extendable' }, { status: 409 })
  }

  // 4. Compute the new expiry, capped so wandering can't push it unboundedly.
  const startedMs = new Date(curse.started_at).getTime()
  const currentExpiryMs = new Date(curse.expires_at).getTime()
  const nominalMinutes =
    CURSE_CATALOG.find((c) => c.id === curse.curse_ref)?.duration_minutes ?? 8
  const capMs = startedMs + nominalMinutes * 60_000 * MAX_EXTENSION_FACTOR
  const nowMs = Date.now()
  const base = Math.max(currentExpiryMs, nowMs)
  const newExpiryMs = Math.min(capMs, base + extend_seconds * 1000)
  const newExpiresAt = new Date(newExpiryMs).toISOString()

  const { data: updated, error: updateError } = await supabase
    .from('active_curses')
    .update({ expires_at: newExpiresAt })
    .eq('id', curse.id)
    .eq('game_id', game.id)
    .select()
    .maybeSingle()
  if (updateError) {
    return NextResponse.json(
      { error: 'curse_update_failed', details: updateError.message },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, curse: (updated ?? curse) as ActiveCurse })
}
