import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPushToTeam } from '@/lib/push/server'
import cursesCatalog from '@/data/curses.json'
import type {
  ActiveCurse,
  BuyCurseResponse,
  Card,
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
  params: Record<string, unknown>
}

const CURSES = cursesCatalog as CurseDefinition[]
const CURSE_BY_ID = new Map<string, CurseDefinition>(CURSES.map((c) => [c.id, c]))

// ---------------------------------------------------------------------------
// Cost (RULEBOOK §7.3 / §8.2): 50 coins per die.
// ---------------------------------------------------------------------------

const COIN_COST_PER_DIE = 50

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

  // 6. Select a curse from the rolled tier, preferring ones not already active
  // on the enemy team. We don't filter active_curses by expires_at — the client
  // is expected to have polled /expire-curses first; stale rows are still treated
  // as "active" for the no-stack rule, which is the safer default.
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
  const activeRefs = new Set(activeOnEnemy.map((c) => c.curse_ref))

  const tierCurses = CURSES.filter((c) => c.tier === tier)
  if (tierCurses.length === 0) {
    // Catalog is broken; bail loudly.
    return NextResponse.json(
      { error: 'no_curse_for_tier', details: { tier } },
      { status: 500 },
    )
  }
  const fresh = tierCurses.filter((c) => !activeRefs.has(c.id))
  // Per RULEBOOK §10: "If enemy is already Frozen, a new Frozen does nothing —
  // the app prevents purchase". We interpret "prevents [the same] purchase",
  // i.e. we always cast SOMETHING for the buyer's coins, just not a duplicate
  // if a fresh option exists. If every curse in the tier is already active,
  // we still pick one (caller paid; better to land a no-op than to refund and
  // surprise them — could revisit with product later).
  const candidatePool = fresh.length > 0 ? fresh : tierCurses
  const curse = pickRandom(candidatePool)

  // 7. Side effects in the same canonical order as buy-intel:
  //   a. Insert coins_deducted event for the buyer team.
  //   b. UPDATE teams.coins with optimistic guard.
  //   c. Apply curse effects (ledger drain / intel loss / active_curses row).
  //   d. Insert curse_cast event.

  const { error: coinsEventError } = await supabase.from('events').insert({
    game_id: game.id,
    type: 'coins_deducted',
    actor_player_id: caller.id,
    payload: {
      team_id: buyerTeam.id,
      amount: cost,
      reason: 'buy_curse',
      num_dice,
      dice_total,
    },
  })
  if (coinsEventError) {
    return NextResponse.json(
      { error: 'event_insert_failed', details: coinsEventError.message },
      { status: 500 },
    )
  }

  const newBuyerCoins = buyerTeam.coins - cost
  const { data: updatedBuyerRow, error: buyerUpdateError } = await supabase
    .from('teams')
    .update({ coins: newBuyerCoins })
    .eq('id', buyerTeam.id)
    .eq('coins', buyerTeam.coins) // optimistic: avoid double-debit on retry
    .select()
    .maybeSingle()

  if (buyerUpdateError) {
    return NextResponse.json(
      { error: 'team_update_failed', details: buyerUpdateError.message },
      { status: 500 },
    )
  }
  if (!updatedBuyerRow) {
    const { data: refreshedTeam } = await supabase
      .from('teams')
      .select('coins')
      .eq('id', buyerTeam.id)
      .maybeSingle()
    const currentCoins =
      (refreshedTeam as { coins: number } | null)?.coins ?? 0
    return NextResponse.json(
      {
        error: 'insufficient_coins',
        details: { coins: currentCoins, cost },
      },
      { status: 409 },
    )
  }
  const buyerTeamCoins = (updatedBuyerRow as Team).coins

  // -------------------------------------------------------------------------
  // Compute the expires_at timestamp for timed curses.
  // -------------------------------------------------------------------------

  const now = new Date()
  const expires_at: string | null =
    curse.duration_minutes == null
      ? null
      : new Date(now.getTime() + curse.duration_minutes * 60_000).toISOString()

  // -------------------------------------------------------------------------
  // Apply LEDGER effects immediately on the enemy team.
  // We branch on the curse id because the rulebook defines exactly four
  // [L] curses and each has a different shape:
  //   curse.coin-drain   -> debit params.amount from enemy coins (clamp at 0)
  //   curse.intel-loss   -> expire 1 random in_hand intel card from enemy
  //   curse.full-stop    -> create active_curses row; no immediate effect
  //   curse.check-in     -> create active_curses row; no immediate effect
  // -------------------------------------------------------------------------

  let ledgerEffect: BuyCurseResponse['ledger_effect']

  if (curse.id === 'curse.coin-drain') {
    const amountParam =
      typeof curse.params['amount'] === 'number'
        ? (curse.params['amount'] as number)
        : 50
    const actualAmount = Math.min(amountParam, enemyTeam.coins)
    const newEnemyCoins = enemyTeam.coins - actualAmount

    const { error: drainEventError } = await supabase.from('events').insert({
      game_id: game.id,
      type: 'coins_deducted',
      actor_player_id: caller.id,
      payload: {
        team_id: enemyTeam.id,
        amount: actualAmount,
        reason: 'curse_coin_drain',
      },
    })
    if (drainEventError) {
      return NextResponse.json(
        { error: 'event_insert_failed', details: drainEventError.message },
        { status: 500 },
      )
    }

    if (actualAmount > 0) {
      const { error: enemyUpdateError } = await supabase
        .from('teams')
        .update({ coins: newEnemyCoins })
        .eq('id', enemyTeam.id)
        .eq('coins', enemyTeam.coins)
      if (enemyUpdateError) {
        return NextResponse.json(
          {
            error: 'team_update_failed',
            details: enemyUpdateError.message,
          },
          { status: 500 },
        )
      }
    }

    ledgerEffect = {
      kind: 'coin_drain',
      amount: actualAmount,
      target_team_coins: newEnemyCoins,
    }
  } else if (curse.id === 'curse.intel-loss') {
    // Pick one random in_hand intel card from the enemy team and expire it.
    const { data: intelCardsData, error: intelLookupError } = await supabase
      .from('cards')
      .select('*')
      .eq('game_id', game.id)
      .eq('team_id', enemyTeam.id)
      .eq('kind', 'intel')
      .eq('state', 'in_hand')

    if (intelLookupError) {
      return NextResponse.json(
        { error: 'cards_lookup_failed', details: intelLookupError.message },
        { status: 500 },
      )
    }
    const inHand = (intelCardsData ?? []) as Card[]
    if (inHand.length === 0) {
      ledgerEffect = { kind: 'intel_loss', expired_card_ref: null }
    } else {
      const victim = pickRandom(inHand)
      const { error: expireError } = await supabase
        .from('cards')
        .update({ state: 'expired', updated_at: new Date().toISOString() })
        .eq('id', victim.id)
        .eq('state', 'in_hand')
      if (expireError) {
        return NextResponse.json(
          { error: 'card_update_failed', details: expireError.message },
          { status: 500 },
        )
      }
      const { error: intelLostEventError } = await supabase
        .from('events')
        .insert({
          game_id: game.id,
          type: 'intel_lost',
          actor_player_id: caller.id,
          payload: {
            team_id: enemyTeam.id,
            card_id: victim.id,
            ref: victim.ref,
          },
        })
      if (intelLostEventError) {
        return NextResponse.json(
          {
            error: 'event_insert_failed',
            details: intelLostEventError.message,
          },
          { status: 500 },
        )
      }
      ledgerEffect = { kind: 'intel_loss', expired_card_ref: victim.ref }
    }
  } else if (curse.id === 'curse.full-stop') {
    ledgerEffect = { kind: 'full_stop' }
  } else if (curse.id === 'curse.check-in') {
    ledgerEffect = { kind: 'check_in' }
  }

  // -------------------------------------------------------------------------
  // Insert active_curses row for any timed curse (durations > 0) AND for the
  // ledger-but-timed curses (full-stop, check-in). One-shot ledger effects with
  // duration_minutes === null and no timer purpose (coin-drain, intel-loss) do
  // NOT get an active_curses row — they're already resolved.
  // -------------------------------------------------------------------------

  const isOneShotLedger =
    curse.id === 'curse.coin-drain' || curse.id === 'curse.intel-loss'

  if (!isOneShotLedger) {
    const { error: activeInsertError } = await supabase
      .from('active_curses')
      .insert({
        game_id: game.id,
        target_team_id: enemyTeam.id,
        curse_ref: curse.id,
        started_at: now.toISOString(),
        expires_at,
        params: curse.params,
      })
    if (activeInsertError) {
      return NextResponse.json(
        {
          error: 'active_curse_insert_failed',
          details: activeInsertError.message,
        },
        { status: 500 },
      )
    }
  }

  // 8. Public curse_cast event.
  const { error: castEventError } = await supabase.from('events').insert({
    game_id: game.id,
    type: 'curse_cast',
    actor_player_id: caller.id,
    payload: {
      buyer_team_id: buyerTeam.id,
      target_team_id: enemyTeam.id,
      curse_ref: curse.id,
      tier,
      dice_total,
      dice_rolls,
      expires_at,
    },
  })
  if (castEventError) {
    return NextResponse.json(
      { error: 'event_insert_failed', details: castEventError.message },
      { status: 500 },
    )
  }

  // Lock-screen alert to the cursed team (best-effort; no-op without VAPID).
  void sendPushToTeam(game.id, enemyTeam.id, {
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
