'use client'

// CursePurchasePanel (rulebook §8.2, §10) — lets the player's team spend
// coins to roll 1–3 d6s, drawing a curse from the corresponding tier
// (1–3 minor, 4–8 medium, 9+ major). The server is authoritative for the
// dice roll and curse selection. Lives in the Actions tab.
//
// Rules surfaced in the UI:
//  - Cost is 50 coins per die.
//  - Game must be in 'live' or 'flag_found'.
//  - Team coins must cover the cost.
//
// On success we show a transient result card with the rolled dice, the curse
// drawn (name, enforcement tag, description), and the ledger summary if the
// curse was a one-shot [L] effect. The active curse will also propagate to
// the enemy team via realtime — and back to us as `curse_cast` in the events
// timeline.

import { useState } from 'react'
import cursesSeed from '@/data/curses.json'
import { apiPost } from '@/lib/api'
import { cn } from '@/lib/cn'
import { getDeviceId } from '@/lib/device'
import type {
  BuyCurseRequest,
  BuyCurseResponse,
  CurseEnforcement,
  CurseTier,
  GameStatus,
} from '@/lib/types'

interface CurseSeed {
  id: string
  name: string
  tier: CurseTier
  enforcement: CurseEnforcement
  duration_minutes: number | null
  description: string
  params: Record<string, unknown>
}

const CURSE_CATALOG: CurseSeed[] = cursesSeed as CurseSeed[]

const COIN_PER_DIE = 50
const DICE_OPTIONS: Array<{ num: 1 | 2 | 3; label: string; hint: string }> = [
  { num: 1, label: '1 die', hint: '1d6 → 50c (favours minor)' },
  { num: 2, label: '2 dice', hint: '2d6 → 100c (favours medium)' },
  { num: 3, label: '3 dice', hint: '3d6 → 150c (favours major)' },
]

interface CursePurchasePanelProps {
  gameId: string
  gameStatus: GameStatus
  teamCoins: number
  myPlayerId: string
}

export function CursePurchasePanel({
  gameId,
  gameStatus,
  teamCoins,
  myPlayerId,
}: CursePurchasePanelProps) {
  const [numDice, setNumDice] = useState<1 | 2 | 3>(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BuyCurseResponse | null>(null)

  const cost = COIN_PER_DIE * numDice
  const gameNotLive = gameStatus !== 'live' && gameStatus !== 'flag_found'
  const insufficient = teamCoins < cost
  const coinShortfall = Math.max(0, cost - teamCoins)

  const disabledReason: string | null = gameNotLive
    ? 'Available during live game'
    : insufficient
      ? `Need ${coinShortfall} more coins`
      : null

  const disabled = busy || disabledReason !== null

  async function handleCast() {
    setError(null)
    setResult(null)
    const ok =
      typeof window === 'undefined' ||
      window.confirm(
        `Spend ${cost} coins to roll ${numDice} ${
          numDice === 1 ? 'die' : 'dice'
        } and cast a curse on the enemy team?`,
      )
    if (!ok) return

    setBusy(true)
    const body: BuyCurseRequest = {
      device_id: getDeviceId(),
      player_id: myPlayerId,
      num_dice: numDice,
    }
    try {
      const res = await apiPost<BuyCurseResponse>(
        `/api/games/${gameId}/buy-curse`,
        body,
      )
      setResult(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown_error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <h2 className="text-sm font-medium text-neutral-100">Cast a Curse</h2>
      <p className="mt-1 text-xs text-neutral-400">
        Cost: 50 coins per die. Higher rolls = stronger curse.
      </p>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {DICE_OPTIONS.map((opt) => {
          const optCost = COIN_PER_DIE * opt.num
          const selected = numDice === opt.num
          return (
            <button
              key={opt.num}
              type="button"
              onClick={() => setNumDice(opt.num)}
              title={opt.hint}
              disabled={busy}
              className={cn(
                'flex flex-col items-center gap-0.5 rounded-md border px-2 py-2 text-xs font-semibold transition',
                selected
                  ? 'border-amber-400 bg-amber-500/20 text-amber-100'
                  : 'border-neutral-800 bg-neutral-950 text-neutral-300 hover:border-neutral-700 hover:text-neutral-100',
                busy && 'cursor-not-allowed opacity-60',
              )}
            >
              <span>{opt.label}</span>
              <span className="text-[10px] font-normal tabular-nums text-neutral-400">
                {optCost} coins
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <button
          type="button"
          onClick={handleCast}
          disabled={disabled}
          className={cn(
            'w-full rounded-md px-4 py-2 text-sm font-semibold uppercase tracking-wider transition',
            disabled
              ? 'cursor-not-allowed bg-neutral-800 text-neutral-500'
              : 'bg-amber-500 text-neutral-950 hover:bg-amber-400',
          )}
        >
          {busy ? 'Rolling…' : `Cast Curse · ${cost} coins`}
        </button>
        {disabledReason && (
          <p className="text-[11px] text-neutral-500">{disabledReason}</p>
        )}
        {error && (
          <p className="rounded bg-red-950/70 px-2 py-1 text-[11px] text-red-200">
            {error}
          </p>
        )}
      </div>

      {result && (
        <CurseResultCard result={result} onDismiss={() => setResult(null)} />
      )}
    </div>
  )
}

function CurseResultCard({
  result,
  onDismiss,
}: {
  result: BuyCurseResponse
  onDismiss: () => void
}) {
  const rollsStr = result.dice_rolls.join(' + ')
  const seedEntry = CURSE_CATALOG.find((c) => c.id === result.curse_ref)
  const description = result.description || seedEntry?.description || ''
  return (
    <div className="mt-3 rounded-md border border-amber-700/60 bg-amber-950/40 px-3 py-3 text-amber-100">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-mono text-amber-200">
          Rolled: {rollsStr} = {result.dice_total} ({result.tier})
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="text-[11px] uppercase tracking-wider text-amber-300/80 hover:text-amber-200"
        >
          Dismiss
        </button>
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="rounded bg-amber-700/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-200">
          [{result.enforcement}]
        </span>
        <p className="text-sm font-semibold text-amber-50">
          {result.curse_name}
        </p>
      </div>
      {description && (
        <p className="mt-1 text-[11px] leading-snug text-amber-200/90">
          {description}
        </p>
      )}
      {result.ledger_effect && (
        <p className="mt-2 rounded bg-amber-900/40 px-2 py-1 text-[11px] text-amber-100">
          {summariseLedgerEffect(result.ledger_effect)}
        </p>
      )}
      {result.duration_minutes != null && (
        <p className="mt-1 text-[11px] text-amber-300/80">
          Duration: {result.duration_minutes} min
        </p>
      )}
    </div>
  )
}

function summariseLedgerEffect(
  effect: NonNullable<BuyCurseResponse['ledger_effect']>,
): string {
  switch (effect.kind) {
    case 'coin_drain':
      return `Enemy team lost ${effect.amount} coins (now ${effect.target_team_coins}).`
    case 'intel_loss':
      return effect.expired_card_ref
        ? `Enemy team lost an intel card (${effect.expired_card_ref}).`
        : 'Enemy team had no intel cards to lose.'
    case 'full_stop':
      return 'Enemy team is locked out of app actions for the duration.'
    case 'check_in':
      return 'Enemy team must respond to in-app prompts every minute.'
  }
}
