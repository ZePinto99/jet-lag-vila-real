'use client'

// IntelPurchasePanel (rulebook §11) — lists all 8 intel cards and lets the
// player's team buy one. Lives in the Actions tab.
//
// Rules enforced in the UI (server is authoritative for everything):
//  - Game must be in 'live' or 'flag_found'
//  - Team has a 4-card cap (any intel state counts; both in_hand and expired)
//  - The same intel_ref cannot be bought twice by the same team
//  - Team coins must cover the cost
//  - intel.hot-cold needs a live GPS reading (server uses it to compute bucket)
//
// On success, the realtime cards subscription propagates the new card into
// the store and it appears in the Status tab via IntelCardDisplay.

import { useState } from 'react'
import intelSeed from '@/data/intel.json'
import { apiPost } from '@/lib/api'
import { cn } from '@/lib/cn'
import { INTEL_CAP } from '@/lib/gameConstants'
import { getDeviceId } from '@/lib/device'
import { useI18n } from '@/lib/i18n/context'
import { localizeCatalogField } from '@/lib/i18n/gameCatalog'
import { ConfirmSpendModal } from '@/components/game/ConfirmSpendModal'
import type {
  BuyIntelRequest,
  BuyIntelResponse,
  Card,
  GameStatus,
  GpsPosition,
} from '@/lib/types'

interface IntelSeed {
  id: string
  name: string
  reveals: string
  cost_coins: number
}

const INTEL_CATALOG: IntelSeed[] = intelSeed as IntelSeed[]

const HOT_COLD_REF = 'intel.hot-cold'

interface IntelPurchasePanelProps {
  gameId: string
  myPlayerId: string
  gameStatus: GameStatus
  teamCoins: number
  myIntelCards: Card[]
  myGps: GpsPosition | null
  actionsLocked?: boolean
  onPurchased?: (purchase: BuyIntelResponse) => void
}

export function IntelPurchasePanel({
  gameId,
  myPlayerId,
  gameStatus,
  teamCoins,
  myIntelCards,
  myGps,
  actionsLocked = false,
  onPurchased,
}: IntelPurchasePanelProps) {
  const { t, locale } = useI18n()
  const [busyRef, setBusyRef] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  // Confirm-spend modal (G21): a tapped Buy opens the modal; the actual spend
  // fires on confirm.
  const [pending, setPending] = useState<IntelSeed | null>(null)

  const ownedRefs = new Set(myIntelCards.map((c) => c.ref))
  const intelCount = myIntelCards.length
  const capReached = intelCount >= INTEL_CAP
  const gameNotLive = gameStatus !== 'live' && gameStatus !== 'flag_found'
  const lockedLabel = actionsLocked ? t('curse.actions_locked') : null

  async function handleBuy(intel: IntelSeed) {
    setError(null)
    setSuccess(null)

    setBusyRef(intel.id)
    const body: BuyIntelRequest = {
      device_id: getDeviceId(),
      player_id: myPlayerId,
      intel_ref: intel.id,
    }
    // We always include player_pos for hot-cold (the only intel where the
    // server needs it). Other intels ignore it.
    if (intel.id === HOT_COLD_REF && myGps) {
      body.player_pos = myGps
    }
    try {
      const purchase = await apiPost<BuyIntelResponse>(`/api/games/${gameId}/buy-intel`, body)
      // Apply the authoritative response immediately. Realtime still keeps
      // team-mates in sync, but the buyer's map must not depend on a websocket
      // event arriving after the purchase request has already succeeded.
      onPurchased?.(purchase)
      setSuccess(t('intel.acquired'))
      setPending(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown_error')
    } finally {
      setBusyRef(null)
    }
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-neutral-100">{t('intel.panel_title')}</h2>
        <p className="text-[11px] text-neutral-500">
          {t('intel.cap', { used: intelCount, cap: INTEL_CAP })}
        </p>
      </div>
      <p className="mt-1 text-xs text-neutral-400">{t('intel.panel_hint')}</p>

      <ul className="mt-3 flex flex-col gap-2">
        {INTEL_CATALOG.map((intel) => (
          <IntelRow
            key={intel.id}
            intel={intel}
            owned={ownedRefs.has(intel.id)}
            capReached={capReached}
            gameNotLive={gameNotLive}
            teamCoins={teamCoins}
            myGps={myGps}
            busy={busyRef === intel.id}
            anyBusy={busyRef !== null}
            lockedLabel={lockedLabel}
            locale={locale}
            onBuy={(i) => {
              setError(null)
              setPending(i)
            }}
          />
        ))}
      </ul>

      {success && (
        <p className="mt-3 rounded bg-emerald-950/70 px-2 py-1 text-[11px] text-emerald-200">
          {success}
        </p>
      )}
      {error && !pending && (
        <p className="mt-3 rounded bg-red-950/70 px-2 py-1 text-[11px] text-red-200">
          {error}
        </p>
      )}

      <ConfirmSpendModal
        open={pending !== null}
        itemName={pending ? localizeCatalogField(pending.id, 'name', pending.name, locale) : ''}
        cost={pending?.cost_coins ?? 0}
        balance={teamCoins}
        busy={busyRef !== null}
        error={error}
        onConfirm={() => {
          if (pending) void handleBuy(pending)
        }}
        onCancel={() => {
          setPending(null)
          setError(null)
        }}
      />
    </div>
  )
}

function IntelRow({
  intel,
  owned,
  capReached,
  gameNotLive,
  teamCoins,
  myGps,
  busy,
  anyBusy,
  lockedLabel,
  locale,
  onBuy,
}: {
  intel: IntelSeed
  owned: boolean
  capReached: boolean
  gameNotLive: boolean
  teamCoins: number
  myGps: GpsPosition | null
  busy: boolean
  anyBusy: boolean
  lockedLabel: string | null
  locale: import('@/lib/i18n/messages').Locale
  onBuy: (intel: IntelSeed) => void
}) {
  const { t } = useI18n()
  const needsGps = intel.id === HOT_COLD_REF && !myGps
  const insufficient = teamCoins < intel.cost_coins
  const coinShortfall = Math.max(0, intel.cost_coins - teamCoins)

  // Priority order for the disabled reason message.
  const disabledReason: string | null = lockedLabel
    ? lockedLabel
    : gameNotLive
    ? t('intel.reason_not_live')
    : owned
      ? t('intel.reason_already_purchased')
      : capReached
        ? t('intel.reason_cap_reached')
        : insufficient
          ? t('intel.reason_insufficient', { n: coinShortfall })
          : needsGps
            ? t('intel.reason_needs_gps')
            : null

  const disabled = busy || anyBusy || disabledReason !== null

  return (
    <li className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-medium text-neutral-100">
              {localizeCatalogField(intel.id, 'name', intel.name, locale)}
            </p>
            <p className="shrink-0 text-xs font-semibold text-amber-300 tabular-nums">
              {intel.cost_coins} {t('common.coins')}
            </p>
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-neutral-400">
            {localizeCatalogField(intel.id, 'reveals', intel.reveals, locale)}
          </p>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p
          className={cn(
            'text-[11px]',
            disabledReason ? 'text-neutral-500' : 'text-neutral-600',
          )}
        >
          {disabledReason ?? ' '}
        </p>
        <button
          type="button"
          onClick={() => onBuy(intel)}
          disabled={disabled}
          className={cn(
            'shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition',
            disabled
              ? 'cursor-not-allowed bg-neutral-800 text-neutral-500'
              : 'bg-amber-500 text-neutral-950 hover:bg-amber-400',
          )}
        >
          {busy ? t('intel.buying') : owned ? t('intel.owned') : t('intel.buy')}
        </button>
      </div>
    </li>
  )
}
