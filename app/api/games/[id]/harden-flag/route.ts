import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { getGameplayActionBlock } from '@/lib/server/actionLock'
import type {
  Game,
  HardenFlagResponse,
  Landmark,
  Player,
  Team,
} from '@/lib/types'

// RULEBOOK §5.3 / §7.3: a team may spend 150 coins ONCE to harden their own
// flag's challenge. We interpret "their own flag's challenge" as referring to
// the real flag specifically — see route handler note for the ambiguity.
const HARDEN_COST = 150

const HardenFlagRequestSchema = z.object({
  device_id: z.string().min(1).max(128),
  player_id: z.string().uuid(),
  landmark_ref: z.string().min(1).max(128),
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

  const parsed = HardenFlagRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', details: parsed.error.issues },
      { status: 400 },
    )
  }
  const { device_id, player_id, landmark_ref } = parsed.data

  const supabase = createAdminClient()

  // 1. Load game; must be 'live'.
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

  if (game.status !== 'live') {
    return NextResponse.json({ error: 'game_not_in_live' }, { status: 409 })
  }

  // 2. Identify caller via device_id + assert player_id match, scoped to game.
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

  // 3. Resolve the landmark row; assert team ownership and that it is the
  // real-flag landmark.
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
  if (!landmarkRow) {
    return NextResponse.json(
      { error: 'landmark_not_in_game' },
      { status: 404 },
    )
  }
  const landmark = landmarkRow as Landmark

  if (landmark.team_id !== callerTeam.id) {
    return NextResponse.json({ error: 'not_own_landmark' }, { status: 409 })
  }
  if (landmark.kind !== 'flag_real') {
    return NextResponse.json({ error: 'not_real_flag' }, { status: 409 })
  }

  // The once-only guard, debit, landmark update and both ledger events are one
  // transaction so simultaneous team-mate taps cannot double-spend.
  const { data: hardenData, error: hardenError } = await supabase.rpc(
    'harden_flag_atomic',
    {
      p_game_id: game.id,
      p_team_id: callerTeam.id,
      p_landmark_id: landmark.id,
      p_landmark_ref: landmark_ref,
      p_actor_player_id: caller.id,
      p_cost: HARDEN_COST,
    },
  )
  if (hardenError) {
    return NextResponse.json(
      { error: 'harden_failed', details: hardenError.message },
      { status: 500 },
    )
  }
  const harden = hardenData as {
    error?: string
    coins?: number
    team_coins?: number
  } | null
  if (!harden || harden.error) {
    const error = harden?.error ?? 'harden_failed'
    return NextResponse.json(
      { error, ...(harden?.coins !== undefined ? { details: { coins: harden.coins } } : {}) },
      { status: error === 'harden_failed' ? 500 : 409 },
    )
  }
  if (harden.team_coins === undefined) {
    return NextResponse.json({ error: 'harden_failed' }, { status: 500 })
  }
  const finalCoins = harden.team_coins

  const response: HardenFlagResponse = {
    landmark_ref,
    team_coins: finalCoins,
  }
  return NextResponse.json(response)
}
