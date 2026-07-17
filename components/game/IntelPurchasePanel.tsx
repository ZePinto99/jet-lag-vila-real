'use client'

// IntelPurchasePanel (rulebook §11) — lists all 9 intel cards and lets the
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
import { getDeviceId } from '@/lib/device'
import { useT } from '@/lib/i18n/context'
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

const INTEL_CAP = 4
const HOT_COLD_REF = 'intel.hot-cold'

interface IntelPurchasePanelProps {
  gameId: string
  myPlayerId: string
  gameStatus: GameStatus
  teamCoins: number
  myIntelCards: Card[]
  myGps: GpsPosition | null
  actionsLocked?: boolean
}

export function IntelPurchasePanel({
  gameId,
  myPlayerId,
  gameStatus,
  teamCoins,
  myIntelCards,
  myGps,
  actionsLocked = false,
}: IntelPurchasePanelProps) {
  const t = useT()
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
      await apiPost<BuyIntelResponse>(`/api/games/${gameId}/buy-intel`, body)
      setSuccess(`${intel.name} acquired — see Status tab.`)
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
        <h2 className="text-sm font-medium text-neutral-100">Buy intel</h2>
        <p className="text-[11px] text-neutral-500">
          {intelCount}/{INTEL_CAP} cards used
        </p>
      </div>
      <p className="mt-1 text-xs text-neutral-400">
        Each card reveals one clue about the enemy real flag. The 4-card cap is
        for the whole game.
      </p>

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
        itemName={pending?.name ?? ''}
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
  onBuy: (intel: IntelSeed) => void
}) {
  const needsGps = intel.id === HOT_COLD_REF && !myGps
  const insufficient = teamCoins < intel.cost_coins
  const coinShortfall = Math.max(0, intel.cost_coins - teamCoins)

  // Priority order for the disabled reason message.
  const disabledReason: string | null = lockedLabel
    ? lockedLabel
    : gameNotLive
    ? 'Available during live game'
    : owned
      ? 'Already purchased'
      : capReached
        ? `Intel cap reached (${INTEL_CAP})`
        : insufficient
          ? `Need ${coinShortfall} more coins`
          : needsGps
            ? 'Enable GPS to buy'
            : null

  const disabled = busy || anyBusy || disabledReason !== null

  return (
    <li className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-medium text-neutral-100">
              {intel.name}
            </p>
            <p className="shrink-0 text-xs font-semibold text-amber-300 tabular-nums">
              {intel.cost_coins} coins
            </p>
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-neutral-400">
            {intel.reveals}
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
          {busy ? 'Buying…' : owned ? 'Owned' : 'Buy'}
        </button>
      </div>
    </li>
  )
}
