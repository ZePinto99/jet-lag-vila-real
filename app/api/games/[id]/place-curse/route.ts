import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPlacedCurseDef } from '@/lib/placedCurses'
import { getGameplayActionBlock } from '@/lib/server/actionLock'
import { supportsTeamSize } from '@/lib/teamSizeEligibility'
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
  const actionBlock = await getGameplayActionBlock(supabase, game.id, caller)
  if (actionBlock) return NextResponse.json({ error: actionBlock }, { status: 409 })

  const targetTeam = teams.find((team) => team.id !== callerTeam.id)
  if (!targetTeam) {
    return NextResponse.json({ error: 'target_team_not_found' }, { status: 409 })
  }
  const { count: targetTeamSize, error: targetTeamSizeError } = await supabase
    .from('players')
    .select('id', { count: 'exact', head: true })
    .eq('team_id', targetTeam.id)
  if (targetTeamSizeError) {
    return NextResponse.json(
      { error: 'player_lookup_failed', details: targetTeamSizeError.message },
      { status: 500 },
    )
  }
  if (!supportsTeamSize(def, targetTeamSize ?? 0)) {
    return NextResponse.json({ error: 'placed_curse_not_available_for_team_size' }, { status: 409 })
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

  const cost = def.cost_coins
  const { data: placeData, error: placeError } = await supabase.rpc(
    'place_curse_atomic',
    {
      p_game_id: game.id,
      p_team_id: callerTeam.id,
      p_landmark_ref: landmark_ref,
      p_placed_ref: placed_ref,
      p_curse_ref: def.casts_curse_ref,
      p_actor_player_id: caller.id,
      p_cost: cost,
    },
  )
  if (placeError) {
    return NextResponse.json(
      { error: 'placed_curse_insert_failed', details: placeError.message },
      { status: 500 },
    )
  }
  const placement = placeData as {
    error?: string
    coins?: number
    placed?: PlacedCurse
    team_coins?: number
  } | null
  if (!placement || placement.error) {
    const error = placement?.error ?? 'placed_curse_insert_failed'
    return NextResponse.json(
      {
        error,
        ...(placement?.coins !== undefined
          ? { details: { coins: placement.coins, cost } }
          : {}),
      },
      { status: error === 'placed_curse_insert_failed' ? 500 : 409 },
    )
  }
  if (!placement.placed || placement.team_coins === undefined) {
    return NextResponse.json(
      { error: 'placed_curse_insert_failed' },
      { status: 500 },
    )
  }

  const response: PlaceCurseResponse = {
    placed: placement.placed,
    team_coins: placement.team_coins,
  }
  return NextResponse.json(response)
}
