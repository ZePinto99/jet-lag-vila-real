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
import { useI18n } from '@/lib/i18n/context'
import { localizeCatalogField } from '@/lib/i18n/gameCatalog'
import { ConfirmSpendModal } from '@/components/game/ConfirmSpendModal'
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
  actionsLocked?: boolean
}

export function CursePurchasePanel({
  gameId,
  gameStatus,
  teamCoins,
  myPlayerId,
  actionsLocked = false,
}: CursePurchasePanelProps) {
  const { t } = useI18n()
  const [numDice, setNumDice] = useState<1 | 2 | 3>(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BuyCurseResponse | null>(null)
  // Inline two-step confirm (replaces window.confirm — PWA-unreliable, P0-3).
  const [confirming, setConfirming] = useState(false)

  const cost = COIN_PER_DIE * numDice
  const gameNotLive = gameStatus !== 'live' && gameStatus !== 'flag_found'
  const insufficient = teamCoins < cost
  const coinShortfall = Math.max(0, cost - teamCoins)

  const disabledReason: string | null = actionsLocked
    ? t('curse.actions_locked')
    : gameNotLive
      ? t('curse.reason_not_live')
      : insufficient
        ? t('curse.reason_insufficient', { n: coinShortfall })
        : null

  const disabled = busy || disabledReason !== null

  async function handleCast() {
    setError(null)
    setResult(null)
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
      setConfirming(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown_error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <h2 className="text-sm font-medium text-neutral-100">{t('curse.panel_title')}</h2>
      <p className="mt-1 text-xs text-neutral-400">{t('curse.panel_hint')}</p>

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
              <span>
                {t('curse.dice', {
                  n: opt.num,
                  dice_word: t(opt.num === 1 ? 'curse.die_singular' : 'curse.die_plural'),
                })}
              </span>
              <span className="text-[10px] font-normal tabular-nums text-neutral-400">
                {optCost} {t('common.coins')}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => {
            if (!disabled) {
              setError(null)
              setConfirming(true)
            }
          }}
          disabled={disabled}
          className={cn(
            'w-full rounded-md px-4 py-2 text-sm font-semibold uppercase tracking-wider transition',
            disabled
              ? 'cursor-not-allowed bg-neutral-800 text-neutral-500'
              : 'bg-amber-500 text-neutral-950 hover:bg-amber-400',
          )}
        >
          {busy ? t('curse.rolling') : t('curse.cast_button', { cost })}
        </button>
        <ConfirmSpendModal
          open={confirming}
          itemName={t('curse.panel_title')}
          cost={cost}
          balance={teamCoins}
          busy={busy}
          error={error}
          onConfirm={handleCast}
          onCancel={() => {
            setConfirming(false)
            setError(null)
          }}
        />
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
  const { t, locale } = useI18n()
  const rollsStr = result.dice_rolls.join(' + ')
  const seedEntry = CURSE_CATALOG.find((c) => c.id === result.curse_ref)
  const fallbackDescription = result.description || seedEntry?.description || ''
  const description = localizeCatalogField(
    result.curse_ref,
    'description',
    fallbackDescription,
    locale,
  )
  const curseName = localizeCatalogField(
    result.curse_ref,
    'name',
    result.curse_name,
    locale,
  )
  return (
    <div className="mt-3 rounded-md border border-amber-700/60 bg-amber-950/40 px-3 py-3 text-amber-100">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-mono text-amber-200">
          {t('curse.rolled', {
            rolls: rollsStr,
            total: result.dice_total,
            tier: t(`curse.tier_${result.tier}`),
          })}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="text-[11px] uppercase tracking-wider text-amber-300/80 hover:text-amber-200"
        >
          {t('curse.dismiss')}
        </button>
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="rounded bg-amber-700/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-200">
          [{result.enforcement}]
        </span>
        <p className="text-sm font-semibold text-amber-50">
          {curseName}
        </p>
      </div>
      {description && (
        <p className="mt-1 text-[11px] leading-snug text-amber-200/90">
          {description}
        </p>
      )}
      {result.ledger_effect && (
        <p className="mt-2 rounded bg-amber-900/40 px-2 py-1 text-[11px] text-amber-100">
          {summariseLedgerEffect(result.ledger_effect, t, locale)}
        </p>
      )}
      {result.duration_minutes != null && (
        <p className="mt-1 text-[11px] text-amber-300/80">
          {t('curse.duration', { n: result.duration_minutes })}
        </p>
      )}
    </div>
  )
}

function summariseLedgerEffect(
  effect: NonNullable<BuyCurseResponse['ledger_effect']>,
  t: (key: string, tokens?: Record<string, string | number>) => string,
  locale: import('@/lib/i18n/messages').Locale,
): string {
  switch (effect.kind) {
    case 'coin_drain':
      return t('curse.ledger_coin_drain', {
        amount: effect.amount,
        balance: effect.target_team_coins,
      })
    case 'intel_loss':
      return effect.expired_card_ref
        ? t('curse.ledger_intel_loss', {
            name: localizeCatalogField(
              effect.expired_card_ref,
              'name',
              effect.expired_card_ref,
              locale,
            ),
          })
        : t('curse.ledger_no_intel')
    case 'full_stop':
      return t('curse.ledger_full_stop')
    case 'check_in':
      return t('curse.ledger_check_in')
  }
}
