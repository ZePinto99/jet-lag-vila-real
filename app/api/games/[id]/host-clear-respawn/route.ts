import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Player } from '@/lib/types'

// Finding P7 — host override for a stuck respawn.
//
// The respawn state is geofence-gated: a tagged raider must confirm arrival at
// their assigned neutral landmark, then walk 45 m clear. If GPS will not produce
// a fix good enough to confirm — narrow streets, a wedged phone, a denied
// permission — that player is action-locked with no way out. Migration 0055 adds
// a 10-minute grace-period sweep for the unattended case; this route is the
// attended one, so the host can release someone immediately instead of making
// them sit it out.
//
// Authority: the lobby host only, and only for a player in their own game. The
// RPC re-checks both (a host of another game cannot reach in), so this route's
// job is input validation and a stable HTTP contract.
const Body = z.object({
  device_id: z.string().min(1).max(128),
  host_player_id: z.string().uuid(),
  target_player_id: z.string().uuid(),
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
  const { device_id, host_player_id, target_player_id } = parsed.data

  const supabase = createAdminClient()

  // Bind the claimed host_player_id to the calling device before trusting it,
  // so a client cannot pass someone else's host id.
  const { data: caller, error: callerError } = await supabase
    .from('players')
    .select('id, device_id, team_id, teams!inner(game_id)')
    .eq('id', host_player_id)
    .maybeSingle()
  if (callerError) {
    return NextResponse.json(
      { error: 'player_lookup_failed', details: callerError.message },
      { status: 500 },
    )
  }
  if (!caller || caller.device_id !== device_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { data, error } = await supabase.rpc('host_clear_respawn_atomic', {
    p_game_id: gameId,
    p_host_player_id: host_player_id,
    p_target_player_id: target_player_id,
  })
  if (error) {
    return NextResponse.json(
      { error: 'host_clear_respawn_failed', details: error.message },
      { status: 500 },
    )
  }

  const result = data as { error?: string; player?: Player } | null
  if (!result || result.error) {
    const err = result?.error ?? 'host_clear_respawn_failed'
    // `cannot_clear_own_team` (migration 0057, finding L1) is a legitimate rule
    // refusal, not a server fault — a whitelist ending in `: 500` would report it
    // as a crash, which is exactly the P10/complete-run defect this codebase
    // already fixed once. 403 because it is an authority limit: the host may
    // release the other side, never their own.
    const status =
      err === 'not_found' || err === 'target_not_found'
        ? 404
        : err === 'not_host' || err === 'cannot_clear_own_team'
          ? 403
          : err === 'target_not_respawning'
            ? 409
            : 500
    return NextResponse.json({ error: err }, { status })
  }

  return NextResponse.json({ player: result.player })
}
