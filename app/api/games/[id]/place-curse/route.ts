import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPlacedCurseDef } from '@/lib/placedCurses'
import type {
  Game,
  Landmark,
  LandmarkKind,
  PlaceCurseResponse,
  PlacedCurse,
  Player,
  Team,
} from '@/lib/types'

// POST /api/games/[id]/place-curse  (PLAYTEST_TRIAGE P2-2)
//
// A team arms a curse on one of its OWN candidate landmarks. Hidden from the
// enemy (placed_curses has no anon RLS policy and isn't broadcast). Allowed in
// setup or live.

const FLAG_KINDS: LandmarkKind[] = ['flag_real', 'flag_decoy', 'flag_empty']

const PlaceCurseSchema = z.object({
  device_id: z.string().min(1).max(128),
  player_id: z.string().uuid(),
  landmark_ref: z.string().min(1).max(128),
  placed_ref: z.string().min(1).max(128),
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

  const parsed = PlaceCurseSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', details: parsed.error.issues },
      { status: 400 },
    )
  }
  const { device_id, player_id, landmark_ref, placed_ref } = parsed.data

  const def = getPlacedCurseDef(placed_ref)
  if (!def) {
    return NextResponse.json({ error: 'invalid_placed_ref' }, { status: 400 })
  }

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
  if (game.status !== 'live' && game.status !== 'setup') {
    return NextResponse.json({ error: 'game_not_placeable' }, { status: 409 })
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
  const teamIds = teams.map((t) => t.id)
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
  const callerTeam = teams.find((t) => t.id === caller.team_id)
  if (!callerTeam) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Landmark must be the caller's OWN candidate.
  const { data: landmarkRow, error: landmarkError } = await supabase
    .from('landmarks')
    .select('*')
    .eq('game_id', game.id)
    .eq('ref', landmark_ref)
    .maybeSingle()
  if (landmarkError) {
    return NextResponse.json(
      { error: 'landmark_lookup_failed', details: landmarkError.message },
      { status: 500 },
    )
  }
  const landmark = landmarkRow as Landmark | null
  if (
    !landmark ||
    landmark.team_id !== callerTeam.id ||
    !FLAG_KINDS.includes(landmark.kind)
  ) {
    return NextResponse.json({ error: 'not_own_candidate' }, { status: 409 })
  }

  // Already an armed placement here?
  const { data: existingRows, error: existingError } = await supabase
    .from('placed_curses')
    .select('id')
    .eq('game_id', game.id)
    .eq('owner_team_id', callerTeam.id)
    .eq('landmark_ref', landmark_ref)
    .eq('armed', true)
    .limit(1)
  if (existingError) {
    return NextResponse.json(
      { error: 'placed_curse_lookup_failed', details: existingError.message },
      { status: 500 },
    )
  }
  if ((existingRows ?? []).length > 0) {
    return NextResponse.json({ error: 'already_placed_here' }, { status: 409 })
  }

  // Coin check + deduct (events first, then materialized counter — same pattern
  // as buy-curse).
  const cost = def.cost_coins
  if (callerTeam.coins < cost) {
    return NextResponse.json(
      { error: 'insufficient_coins', details: { coins: callerTeam.coins, cost } },
      { status: 409 },
    )
  }

  const { error: coinsEventError } = await supabase.from('events').insert({
    game_id: game.id,
    type: 'coins_deducted',
    actor_player_id: caller.id,
    payload: { team_id: callerTeam.id, amount: cost, reason: 'place_curse' },
  })
  if (coinsEventError) {
    return NextResponse.json(
      { error: 'event_insert_failed', details: coinsEventError.message },
      { status: 500 },
    )
  }

  const { data: updatedTeamRow, error: teamUpdateError } = await supabase
    .from('teams')
    .update({ coins: callerTeam.coins - cost })
    .eq('id', callerTeam.id)
    .eq('coins', callerTeam.coins) // optimistic guard
    .select()
    .maybeSingle()
  if (teamUpdateError) {
    return NextResponse.json(
      { error: 'team_update_failed', details: teamUpdateError.message },
      { status: 500 },
    )
  }
  if (!updatedTeamRow) {
    const { data: refreshed } = await supabase
      .from('teams')
      .select('coins')
      .eq('id', callerTeam.id)
      .maybeSingle()
    return NextResponse.json(
      {
        error: 'insufficient_coins',
        details: { coins: (refreshed as { coins: number } | null)?.coins ?? 0, cost },
      },
      { status: 409 },
    )
  }
  const teamCoins = (updatedTeamRow as Team).coins

  // Insert the (hidden) placement.
  const { data: placedRow, error: placeError } = await supabase
    .from('placed_curses')
    .insert({
      game_id: game.id,
      owner_team_id: callerTeam.id,
      landmark_ref,
      placed_ref,
      curse_ref: def.casts_curse_ref,
      armed: true,
    })
    .select()
    .maybeSingle()
  if (placeError || !placedRow) {
    return NextResponse.json(
      { error: 'placed_curse_insert_failed', details: placeError?.message },
      { status: 500 },
    )
  }

  // Public event — deliberately WITHOUT landmark_ref so it can't leak which
  // candidate (likely the real flag) was armed.
  const { error: armedEventError } = await supabase.from('events').insert({
    game_id: game.id,
    type: 'placed_curse_armed',
    actor_player_id: caller.id,
    payload: { team_id: callerTeam.id, placed_ref },
  })
  if (armedEventError) {
    return NextResponse.json(
      { error: 'event_insert_failed', details: armedEventError.message },
      { status: 500 },
    )
  }

  const response: PlaceCurseResponse = {
    placed: placedRow as PlacedCurse,
    team_coins: teamCoins,
  }
  return NextResponse.json(response)
}
