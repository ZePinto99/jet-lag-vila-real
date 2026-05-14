import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
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

  // 4. Already-hardened check: any of this team's landmarks already hardened?
  const { data: hardenedRows, error: hardenedLookupError } = await supabase
    .from('landmarks')
    .select('id')
    .eq('game_id', game.id)
    .eq('team_id', callerTeam.id)
    .eq('hardened', true)
    .limit(1)

  if (hardenedLookupError) {
    return NextResponse.json(
      {
        error: 'landmark_lookup_failed',
        details: hardenedLookupError.message,
      },
      { status: 500 },
    )
  }
  if ((hardenedRows ?? []).length > 0) {
    return NextResponse.json({ error: 'already_hardened' }, { status: 409 })
  }

  // 5. Coin check (uses materialized teams.coins counter per CLAUDE.md).
  if (callerTeam.coins < HARDEN_COST) {
    return NextResponse.json(
      {
        error: 'insufficient_coins',
        details: { coins: callerTeam.coins },
      },
      { status: 409 },
    )
  }

  // 6. Side effects, in order: event first, then coin debit, then mark
  // hardened, then flag_hardened event (per CLAUDE.md: write event before
  // coin mutation in same logical txn — Supabase admin client lacks tx
  // primitives, so we sequence carefully).
  const { error: coinsEventError } = await supabase.from('events').insert({
    game_id: game.id,
    type: 'coins_deducted',
    actor_player_id: caller.id,
    payload: {
      team_id: callerTeam.id,
      amount: HARDEN_COST,
      reason: 'harden_flag',
    },
  })
  if (coinsEventError) {
    return NextResponse.json(
      { error: 'event_insert_failed', details: coinsEventError.message },
      { status: 500 },
    )
  }

  // Debit coins. Use coins = coins - 150 via update with where guard.
  const newCoins = callerTeam.coins - HARDEN_COST
  const { data: updatedTeamRow, error: teamUpdateError } = await supabase
    .from('teams')
    .update({ coins: newCoins })
    .eq('id', callerTeam.id)
    .eq('coins', callerTeam.coins) // optimistic: avoid double-debit on retry
    .select()
    .maybeSingle()

  if (teamUpdateError) {
    return NextResponse.json(
      { error: 'team_update_failed', details: teamUpdateError.message },
      { status: 500 },
    )
  }
  if (!updatedTeamRow) {
    // Coins changed under us — re-fetch and surface insufficient_coins so the
    // client can refresh and decide.
    const { data: refreshedTeam } = await supabase
      .from('teams')
      .select('coins')
      .eq('id', callerTeam.id)
      .maybeSingle()
    const currentCoins = (refreshedTeam as { coins: number } | null)?.coins ?? 0
    return NextResponse.json(
      {
        error: 'insufficient_coins',
        details: { coins: currentCoins },
      },
      { status: 409 },
    )
  }
  const finalCoins = (updatedTeamRow as Team).coins

  // Mark the landmark hardened.
  const { error: landmarkUpdateError } = await supabase
    .from('landmarks')
    .update({ hardened: true })
    .eq('id', landmark.id)
    .eq('hardened', false) // belt-and-braces guard

  if (landmarkUpdateError) {
    return NextResponse.json(
      { error: 'landmark_update_failed', details: landmarkUpdateError.message },
      { status: 500 },
    )
  }

  // Append flag_hardened event.
  const { error: hardenEventError } = await supabase.from('events').insert({
    game_id: game.id,
    type: 'flag_hardened',
    actor_player_id: caller.id,
    payload: {
      team_id: callerTeam.id,
      landmark_ref,
    },
  })
  if (hardenEventError) {
    return NextResponse.json(
      { error: 'event_insert_failed', details: hardenEventError.message },
      { status: 500 },
    )
  }

  const response: HardenFlagResponse = {
    landmark_ref,
    team_coins: finalCoins,
  }
  return NextResponse.json(response)
}
