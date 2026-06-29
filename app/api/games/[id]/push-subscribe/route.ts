import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Game, Player, Team } from '@/lib/types'

// ---------------------------------------------------------------------------
// POST /api/games/[id]/push-subscribe
//
// The browser obtains a PushSubscription (via the Push API) and POSTs it here
// so the server can later fan out Web Push notifications. Soft-auth on
// device_id (same pattern as expire-curses): the caller must be a player in
// this game. We resolve the player's team and upsert one row per endpoint.
//
// Mirrors the RLS-locked model: writes go through the service-role admin
// client; anon clients can never touch push_subscriptions directly.
// ---------------------------------------------------------------------------

const SubscriptionSchema = z.object({
  endpoint: z.string().min(1).max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
})

const PushSubscribeSchema = z.object({
  device_id: z.string().min(1).max(128),
  player_id: z.string().uuid(),
  subscription: SubscriptionSchema,
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

  const parsed = PushSubscribeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', details: parsed.error.issues },
      { status: 400 },
    )
  }
  const { device_id, player_id, subscription } = parsed.data

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
  if (!caller || caller.id !== player_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // 3. Upsert keyed on the unique endpoint. Re-subscribing or rejoining a new
  // game updates the player/team/game pointers in place.
  const { error: upsertError } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        game_id: game.id,
        player_id: caller.id,
        team_id: caller.team_id,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      { onConflict: 'endpoint' },
    )
  if (upsertError) {
    return NextResponse.json(
      { error: 'subscription_upsert_failed', details: upsertError.message },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true })
}
