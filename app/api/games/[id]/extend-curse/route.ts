import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { isPositionFresh } from '@/lib/geo/positionFreshness'
import cursesSeed from '@/data/curses.json'
import type { ActiveCurse, Game, Player, Team } from '@/lib/types'

interface CurseSeed {
  id: string
  duration_minutes: number | null
}
const CURSE_CATALOG = cursesSeed as CurseSeed[]
const MAX_EXTENSION_FACTOR = 4
const MAX_REPORT_INTERVAL_MS = 120_000

const PositionSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().nonnegative(),
  updated_at: z.number().int().nonnegative(),
})

const RequestSchema = z
  .object({
    device_id: z.string().min(1).max(128),
    player_id: z.string().uuid(),
    curse_id: z.string().uuid(),
    anchor_pos: PositionSchema.optional(),
    violation: z
      .object({
        started_at: z.number().int().nonnegative(),
        ended_at: z.number().int().nonnegative(),
      })
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.anchor_pos && !value.violation) {
      ctx.addIssue({ code: 'custom', message: 'anchor_pos_or_violation_required' })
    }
    if (value.violation) {
      const duration = value.violation.ended_at - value.violation.started_at
      if (duration <= 0 || duration > MAX_REPORT_INTERVAL_MS) {
        ctx.addIssue({ code: 'custom', message: 'invalid_violation_interval' })
      }
    }
  })

interface FrozenRpcResult {
  anchor: { lat: number; lng: number }
  added_seconds: number
  total_violation_seconds: number
  expires_at: string
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
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', details: parsed.error.issues },
      { status: 400 },
    )
  }
  const { device_id, player_id, curse_id, anchor_pos, violation } = parsed.data
  const nowMs = Date.now()
  if (anchor_pos && !isPositionFresh(anchor_pos.updated_at, nowMs)) {
    return NextResponse.json({ error: 'stale_anchor_position' }, { status: 409 })
  }
  if (violation && !isPositionFresh(violation.ended_at, nowMs)) {
    return NextResponse.json({ error: 'stale_violation_interval' }, { status: 409 })
  }

  const supabase = createAdminClient()
  const { data: gameRow, error: gameError } = await supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
    .maybeSingle()
  if (gameError) {
    return NextResponse.json({ error: 'game_lookup_failed', details: gameError.message }, { status: 500 })
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
    return NextResponse.json({ error: 'team_lookup_failed', details: teamsError?.message }, { status: 500 })
  }
  const teams = teamsData as Team[]
  const { data: playersData, error: playersError } = await supabase
    .from('players')
    .select('*')
    .in('team_id', teams.map((team) => team.id))
    .eq('device_id', device_id)
  if (playersError) {
    return NextResponse.json({ error: 'player_lookup_failed', details: playersError.message }, { status: 500 })
  }
  const caller = (playersData ?? [])[0] as Player | undefined
  if (!caller || caller.id !== player_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { data: curseRow, error: curseError } = await supabase
    .from('active_curses')
    .select('*')
    .eq('id', curse_id)
    .eq('game_id', game.id)
    .maybeSingle()
  if (curseError) {
    return NextResponse.json({ error: 'curse_lookup_failed', details: curseError.message }, { status: 500 })
  }
  if (!curseRow) return NextResponse.json({ error: 'curse_not_found' }, { status: 404 })
  const curse = curseRow as ActiveCurse
  if (curse.target_team_id !== caller.team_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  if (curse.curse_ref !== 'curse.frozen' || !curse.expires_at) {
    return NextResponse.json({ error: 'not_extendable' }, { status: 409 })
  }

  const nominalMinutes =
    CURSE_CATALOG.find((entry) => entry.id === curse.curse_ref)?.duration_minutes ?? 8
  const { data: rpcData, error: rpcError } = await supabase.rpc('report_frozen_state', {
    p_game_id: game.id,
    p_curse_id: curse.id,
    p_player_id: caller.id,
    p_anchor_lat: anchor_pos?.lat ?? null,
    p_anchor_lng: anchor_pos?.lng ?? null,
    p_violation_start: violation ? new Date(violation.started_at).toISOString() : null,
    p_violation_end: violation ? new Date(violation.ended_at).toISOString() : null,
    p_nominal_duration_seconds: nominalMinutes * 60,
    p_max_extension_factor: MAX_EXTENSION_FACTOR,
  })
  if (rpcError) {
    const message = rpcError.message ?? ''
    if (message.includes('frozen_anchor_required')) {
      return NextResponse.json({ error: 'anchor_required' }, { status: 409 })
    }
    return NextResponse.json({ error: 'frozen_state_failed', details: message }, { status: 500 })
  }

  const result = rpcData as unknown as FrozenRpcResult
  return NextResponse.json({
    ok: true,
    anchor: result.anchor,
    added_seconds: result.added_seconds,
    total_violation_seconds: result.total_violation_seconds,
    curse: { ...curse, expires_at: result.expires_at },
  })
}
