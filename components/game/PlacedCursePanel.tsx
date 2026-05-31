'use client'

// PlacedCursePanel (PLAYTEST_TRIAGE P2-2) — arm a curse on one of your own
// candidate landmarks. Hidden from the enemy; triggers when an enemy enters
// the landmark's defense zone. Usable in setup and live; rendered in the live
// Actions tab and the setup view.

import { useState } from 'react'
import { apiPost } from '@/lib/api'
import { cn } from '@/lib/cn'
import { getDeviceId } from '@/lib/device'
import { useT } from '@/lib/i18n/context'
import { getPlacedCurseCatalog } from '@/lib/placedCurses'
import { getSeedLandmarkByRef } from '@/lib/landmarks'
import { useGameStore } from '@/store/gameStore'
import type {
  Landmark,
  PlaceCurseRequest,
  PlaceCurseResponse,
  PlacedCurse,
} from '@/lib/types'

const CATALOG = getPlacedCurseCatalog()

interface PlacedCursePanelProps {
  gameId: string
  myPlayerId: string
  teamCoins: number
  myCandidateLandmarks: Landmark[]
  placedCurses: PlacedCurse[]
  actionsLocked?: boolean
}

function landmarkName(ref: string): string {
  return getSeedLandmarkByRef(ref)?.name ?? ref
}

export function PlacedCursePanel({
  gameId,
  myPlayerId,
  teamCoins,
  myCandidateLandmarks,
  placedCurses,
  actionsLocked = false,
}: PlacedCursePanelProps) {
  const t = useT()
  const addPlacedCurse = useGameStore((s) => s.addPlacedCurse)
  const [busyRef, setBusyRef] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const armedRefs = new Set(placedCurses.map((p) => p.landmark_ref))
  const availableLandmarks = myCandidateLandmarks.filter(
    (l) => !armedRefs.has(l.ref),
  )
  const [selectedRef, setSelectedRef] = useState<string>('')
  const effectiveSelected =
    selectedRef && availableLandmarks.some((l) => l.ref === selectedRef)
      ? selectedRef
      : availableLandmarks[0]?.ref ?? ''

  async function handlePlace(placedRef: string) {
    if (!effectiveSelected || actionsLocked) return
    setError(null)
    setBusyRef(placedRef)
    const body: PlaceCurseRequest = {
      device_id: getDeviceId(),
      player_id: myPlayerId,
      landmark_ref: effectiveSelected,
      placed_ref: placedRef,
    }
    try {
      const res = await apiPost<PlaceCurseResponse>(
        `/api/games/${gameId}/place-curse`,
        body,
      )
      addPlacedCurse(res.placed)
      setSelectedRef('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown_error')
    } finally {
      setBusyRef(null)
    }
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <h2 className="text-sm font-medium text-neutral-100">
        {t('placed.title')}
      </h2>
      <p className="mt-1 text-xs text-neutral-400">{t('placed.hint')}</p>

      {placedCurses.length > 0 && (
        <div className="mt-3 rounded border border-orange-800/40 bg-orange-950/30 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wider text-orange-300/80">
            {t('placed.armed_header')}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {placedCurses.map((p) => (
              <li key={p.id} className="text-[11px] text-orange-100">
                {t('placed.armed_label', { landmark: landmarkName(p.landmark_ref) })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {availableLandmarks.length === 0 ? (
        <p className="mt-3 text-xs text-neutral-500">
          {t('placed.none_available')}
        </p>
      ) : (
        <>
          <label className="mt-3 block text-[11px] uppercase tracking-wider text-neutral-500">
            {t('placed.select_landmark')}
          </label>
          <select
            value={effectiveSelected}
            onChange={(e) => setSelectedRef(e.target.value)}
            disabled={actionsLocked}
            className="mt-1 w-full rounded-md border border-neutral-700 bg-neutral-950 px-2.5 py-2 text-xs text-neutral-100 focus:border-amber-500 focus:outline-none disabled:opacity-50"
          >
            {availableLandmarks.map((l) => (
              <option key={l.ref} value={l.ref}>
                {landmarkName(l.ref)}
              </option>
            ))}
          </select>

          <ul className="mt-3 flex flex-col gap-2">
            {CATALOG.map((def) => {
              const insufficient = teamCoins < def.cost_coins
              const shortfall = Math.max(0, def.cost_coins - teamCoins)
              const disabled =
                busyRef !== null ||
                actionsLocked ||
                insufficient ||
                !effectiveSelected
              const reason = actionsLocked
                ? t('curse.actions_locked')
                : insufficient
                  ? t('placed.need_coins', { n: shortfall })
                  : null
              return (
                <li
                  key={def.id}
                  className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-neutral-100">
                      {def.name}
                    </p>
                    <p className="shrink-0 text-xs font-semibold tabular-nums text-amber-300">
                      {def.cost_coins}
                    </p>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-neutral-400">
                    {def.description}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-neutral-500">
                      {reason ?? ' '}
                    </span>
                    <button
                      type="button"
                      onClick={() => handlePlace(def.id)}
                      disabled={disabled}
                      className={cn(
                        'shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition',
                        disabled
                          ? 'cursor-not-allowed bg-neutral-800 text-neutral-500'
                          : 'bg-amber-500 text-neutral-950 hover:bg-amber-400',
                      )}
                    >
                      {busyRef === def.id
                        ? t('placed.placing')
                        : t('placed.place_button', { cost: def.cost_coins })}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {error && (
        <p className="mt-3 rounded bg-red-950/70 px-2 py-1 text-[11px] text-red-200">
          {error}
        </p>
      )}
    </div>
  )
}
