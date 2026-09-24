import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPushToTeam } from '@/lib/push/server'
import { getGameplayActionBlock } from '@/lib/server/actionLock'
import { buildCurseCastParams } from '@/lib/curses/castParams'
import { supportsTeamSize } from '@/lib/teamSizeEligibility'
import cursesCatalog from '@/data/curses.json'
import { COIN_COST_PER_DIE } from '@/lib/gameConstants'
import type {
  ActiveCurse,
  BuyCurseResponse,
  CurseEnforcement,
  CurseTier,
  Game,
  Player,
  Team,
} from '@/lib/types'

// ---------------------------------------------------------------------------
// Catalog typing (mirrors data/curses.json)
// ---------------------------------------------------------------------------

interface CurseDefinition {
  id: string
  name: string
  tier: CurseTier
  enforcement: CurseEnforcement
  duration_minutes: number | null
  description: string
  min_team_size?: number
  enabled?: boolean
  params: Record<string, unknown>
}

const CURSES = cursesCatalog as CurseDefinition[]
const CURSE_BY_ID = new Map<string, CurseDefinition>(CURSES.map((c) => [c.id, c]))

// ---------------------------------------------------------------------------
// Cost (RULEBOOK §7.3 / §8.2): COIN_COST_PER_DIE coins per die, in
// lib/gameConstants.ts so the player guide quotes the same figure.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Body validation
// ---------------------------------------------------------------------------

const BuyCurseRequestSchema = z.object({
  device_id: z.string().min(1).max(128),
  player_id: z.string().uuid(),
  num_dice: z.union([z.literal(1), z.literal(2), z.literal(3)]),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rollD6(): number {
  return Math.floor(Math.random() * 6) + 1
}

function rollDice(n: number): number[] {
  const rolls: number[] = []
  for (let i = 0; i < n; i++) rolls.push(rollD6())
  return rolls
}

function tierFromTotal(total: number): CurseTier {
  if (total <= 3) return 'minor'
  if (total <= 8) return 'medium'
  return 'major'
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

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

  const parsed = BuyCurseRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', details: parsed.error.issues },
      { status: 400 },
    )
  }
  const { device_id, player_id, num_dice } = parsed.data

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
  if (!gameRow) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const game = gameRow as Game

  if (game.status !== 'live' && game.status !== 'flag_found') {
    return NextResponse.json({ error: 'game_not_in_play' }, { status: 409 })
  }

  // 2. Load both teams.
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

  // 3. Identify caller via device_id, scoped to this game's teams. Assert the
  // supplied player_id matches the device.
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

  const buyerTeam = teams.find((t) => t.id === caller.team_id)
  const enemyTeam = teams.find((t) => t.id !== caller.team_id)
  if (!buyerTeam || !enemyTeam) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const actionBlock = await getGameplayActionBlock(supabase, game.id, caller)
  if (actionBlock) return NextResponse.json({ error: actionBlock }, { status: 409 })

  const { count: enemyTeamSizeCount, error: enemyTeamSizeError } = await supabase
    .from('players')
    .select('id', { count: 'exact', head: true })
    .eq('team_id', enemyTeam.id)
  if (enemyTeamSizeError) {
    return NextResponse.json(
      { error: 'player_lookup_failed', details: enemyTeamSizeError.message },
      { status: 500 },
    )
  }
  const enemyTeamSize = enemyTeamSizeCount ?? 0

  // 4. Coin check against the materialized counter.
  const cost = COIN_COST_PER_DIE * num_dice
  if (buyerTeam.coins < cost) {
    return NextResponse.json(
      {
        error: 'insufficient_coins',
        details: { coins: buyerTeam.coins, cost },
      },
      { status: 409 },
    )
  }

  // 5. Roll the dice server-side.
  const dice_rolls = rollDice(num_dice)
  const dice_total = dice_rolls.reduce((a, b) => a + b, 0)
  const tier: CurseTier = tierFromTotal(dice_total)

  // 6. Select a curse from the rolled tier, excluding effects that are still
  // active on the enemy team. Expired rows may remain until housekeeping runs;
  // the atomic cast RPC serializes their expiry/event cleanup before inserting
  // a same-ref replacement.
  const { data: activeCurseRows, error: activeCursesError } = await supabase
    .from('active_curses')
    .select('*')
    .eq('game_id', game.id)
    .eq('target_team_id', enemyTeam.id)

  if (activeCursesError) {
    return NextResponse.json(
      {
        error: 'active_curse_lookup_failed',
        details: activeCursesError.message,
      },
      { status: 500 },
    )
  }
  const activeOnEnemy = (activeCurseRows ?? []) as ActiveCurse[]
  const selectionNow = Date.now()
  const activeRefs = new Set(
    activeOnEnemy
      .filter((active) => {
        if (active.expires_at === null) return true
        const expiresAt = Date.parse(active.expires_at)
        return !Number.isFinite(expiresAt) || expiresAt > selectionNow
      })
      .map((active) => active.curse_ref),
  )

  const { count: enemyIntelCount, error: enemyIntelError } = await supabase
    .from('cards')
    .select('id', { count: 'exact', head: true })
    .eq('game_id', game.id)
    .eq('team_id', enemyTeam.id)
    .eq('kind', 'intel')
    .eq('state', 'in_hand')
  if (enemyIntelError) {
    return NextResponse.json(
      { error: 'cards_lookup_failed', details: enemyIntelError.message },
      { status: 500 },
    )
  }

  const tierCurses = CURSES.filter(
    (candidate) =>
      candidate.tier === tier &&
      candidate.enabled !== false &&
      supportsTeamSize(candidate, enemyTeamSize) &&
      !activeRefs.has(candidate.id) &&
      (candidate.id !== 'curse.coin-drain' || enemyTeam.coins > 0) &&
      (candidate.id !== 'curse.intel-loss' || (enemyIntelCount ?? 0) > 0),
  )
  if (tierCurses.length === 0) {
    return NextResponse.json(
      { error: 'no_available_curse', details: { tier } },
      { status: 409 },
    )
  }
  const curse = pickRandom(tierCurses)

  // GPS curses need the server to choose and persist a concrete target. Never
  // let each browser roll independently: every cursed teammate must receive
  // the same street/landmark after reconnecting.
  let castParams: Record<string, unknown>
  try {
    castParams = buildCurseCastParams(curse.id, curse.params)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'curse_params_failed' },
      { status: 500 },
    )
  }

  // -------------------------------------------------------------------------
  // Compute the expires_at timestamp for timed curses.
  // -------------------------------------------------------------------------

  const now = new Date()
  const expires_at: string | null =
    curse.duration_minutes == null
      ? null
      : new Date(now.getTime() + curse.duration_minutes * 60_000).toISOString()

  const { data: castData, error: castError } = await supabase.rpc(
    'buy_curse_atomic',
    {
      p_game_id: game.id,
      p_buyer_team_id: buyerTeam.id,
      p_target_team_id: enemyTeam.id,
      p_actor_player_id: caller.id,
      p_cost: cost,
      p_num_dice: num_dice,
      p_dice_total: dice_total,
      p_dice_rolls: dice_rolls,
      p_curse_ref: curse.id,
      p_tier: tier,
      p_expires_at: expires_at,
      p_params: castParams,
    },
  )
  if (castError) {
    return NextResponse.json(
      { error: 'curse_purchase_failed', details: castError.message },
      { status: 500 },
    )
  }
  const cast = castData as {
    error?: string
    coins?: number
    buyer_team_coins?: number
    ledger_effect?: BuyCurseResponse['ledger_effect']
  } | null
  if (!cast || cast.error) {
    const error = cast?.error ?? 'curse_purchase_failed'
    return NextResponse.json(
      {
        error,
        ...(cast?.coins !== undefined ? { details: { coins: cast.coins, cost } } : {}),
      },
      { status: error === 'curse_purchase_failed' ? 500 : 409 },
    )
  }
  if (cast.buyer_team_coins === undefined) {
    return NextResponse.json({ error: 'curse_purchase_failed' }, { status: 500 })
  }
  const buyerTeamCoins = cast.buyer_team_coins
  const ledgerEffect = cast.ledger_effect

  // Lock-screen alert to the cursed team (best-effort; no-op without VAPID).
  await sendPushToTeam(game.id, enemyTeam.id, {
    title: 'Your team has been cursed',
    body: `Your team has been cursed: ${curse.name}`,
    tag: 'cursed',
    url: `/game/${game.code}`,
  })

  const response: BuyCurseResponse = {
    curse_ref: curse.id,
    curse_name: curse.name,
    tier,
    enforcement: curse.enforcement,
    description: curse.description,
    dice_total,
    dice_rolls,
    duration_minutes: curse.duration_minutes,
    expires_at,
    ...(ledgerEffect !== undefined ? { ledger_effect: ledgerEffect } : {}),
    buyer_team_coins: buyerTeamCoins,
  }
  return NextResponse.json(response)
}

// Reference the catalog map so the unused-import linter doesn't complain when
// we don't end up using direct id lookups. Keeps the map available for future
// extensions (e.g. validating curse_ref params at runtime).
void CURSE_BY_ID
