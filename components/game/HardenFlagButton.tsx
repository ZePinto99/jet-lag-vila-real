'use client'

// HardenFlagButton (rulebook §5.3) — spend 150 coins to upgrade the team's
// own flag challenge to a harder variant. Once per team per game.
//
// Lives in the Status tab. Hidden / disabled when:
//  - game is not 'live'
//  - any of the team's landmarks is already hardened
//  - team coins < 150
//  - the team's real flag is not present (shouldn't happen post-setup)
//
// Server is authoritative: harden state and team coins update via realtime.

import { useMemo, useState } from 'react'
import { apiPost } from '@/lib/api'
import { cn } from '@/lib/cn'
import { getDeviceId } from '@/lib/device'
import { useT } from '@/lib/i18n/context'
import type {
  GameStatus,
  HardenFlagRequest,
  HardenFlagResponse,
  Landmark,
} from '@/lib/types'

export const HARDEN_COST = 150

interface HardenFlagButtonProps {
  gameId: string
  myPlayerId: string
  gameStatus: GameStatus
  myTeamLandmarks: Landmark[]
  teamCoins: number
  actionsLocked?: boolean
}

export function HardenFlagButton({
  gameId,
  myPlayerId,
  gameStatus,
  myTeamLandmarks,
  teamCoins,
  actionsLocked = false,
}: HardenFlagButtonProps) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  // Inline two-step confirm (replaces window.confirm — PWA-unreliable, P0-3).
  const [confirming, setConfirming] = useState(false)

  const realFlag = useMemo<Landmark | null>(
    () => myTeamLandmarks.find((l) => l.kind === 'flag_real') ?? null,
    [myTeamLandmarks],
  )
  const alreadyHardened = useMemo(
    () => myTeamLandmarks.some((l) => l.hardened),
    [myTeamLandmarks],
  )

  const notLive = gameStatus !== 'live'
  const insufficientCoins = teamCoins < HARDEN_COST
  const disabled =
    busy ||
    notLive ||
    alreadyHardened ||
    insufficientCoins ||
    !realFlag ||
    actionsLocked

  const disabledReason = !realFlag
    ? 'No real flag assigned yet'
    : alreadyHardened
      ? 'Already hardened'
      : actionsLocked
        ? t('curse.actions_locked')
        : notLive
          ? 'Not available right now'
          : insufficientCoins
            ? `Costs ${HARDEN_COST} coins — you have ${teamCoins}`
            : null

  async function handleClick() {
    if (disabled || !realFlag) return
    setConfirming(false)
    setBusy(true)
    setError(null)
    setSuccess(null)
    const body: HardenFlagRequest = {
      device_id: getDeviceId(),
      player_id: myPlayerId,
      landmark_ref: realFlag.ref,
    }
    try {
      await apiPost<HardenFlagResponse>(
        `/api/games/${gameId}/harden-flag`,
        body,
      )
      setSuccess('Flag challenge hardened.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown_error')
    } finally {
      setBusy(false)
    }
  }

  // When already hardened we still render the box so the team can see the
  // status. Otherwise it'd look like the button vanished.
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <h2 className="text-sm font-medium text-neutral-100">Harden your flag</h2>
      <p className="mt-1 text-xs text-neutral-400">
        Spend {HARDEN_COST} coins to upgrade your real flag&apos;s challenge to
        a harder variant. Once per game.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {confirming && !disabled ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="flex-1 rounded-md bg-neutral-800 px-4 py-2 text-sm font-semibold uppercase tracking-wider text-neutral-300 transition hover:bg-neutral-700 disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={handleClick}
              disabled={busy}
              className="flex-1 rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold uppercase tracking-wider text-neutral-950 transition hover:bg-amber-400 disabled:opacity-50"
            >
              {busy ? 'Hardening…' : `${t('common.confirm')} · ${HARDEN_COST}`}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (!disabled) setConfirming(true)
            }}
            disabled={disabled}
            className={cn(
              'w-full rounded-md px-4 py-2 text-sm font-semibold uppercase tracking-wider transition',
              disabled
                ? 'cursor-not-allowed bg-neutral-800 text-neutral-500'
                : 'bg-amber-500 text-neutral-950 hover:bg-amber-400',
            )}
          >
            {busy
              ? 'Hardening…'
              : alreadyHardened
                ? 'Already hardened'
                : `Harden flag · ${HARDEN_COST} coins`}
          </button>
        )}
        {disabledReason && !success && (
          <p className="text-[11px] text-neutral-500">{disabledReason}</p>
        )}
        {success && (
          <p className="rounded bg-emerald-950/70 px-2 py-1 text-[11px] text-emerald-200">
            {success}
          </p>
        )}
        {error && (
          <p className="rounded bg-red-950/70 px-2 py-1 text-[11px] text-red-200">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
