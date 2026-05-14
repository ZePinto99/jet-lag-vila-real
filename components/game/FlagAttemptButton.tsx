'use client'

// Flag-attempt button (rulebook §5.2).
//
// Companion to TagButton — same UX shape, big amber button when enabled. The
// useFlagAttemptButton hook does all the proximity / state checks; this
// component renders the result, asks for confirmation, POSTs to
// /api/games/[id]/attempt-flag, and surfaces a short status line summarising
// the outcome (real / decoy / empty).
//
// On 'real', the realtime games update will flip status to 'flag_found' and
// the parent will swap in the FlagCarrierBanner.
// On 'decoy', the team's intel cards are expired server-side; the realtime
// card updates propagate that.

import { useState } from 'react'
import seedLandmarks from '@/data/landmarks.json'
import { apiPost } from '@/lib/api'
import { cn } from '@/lib/cn'
import { getDeviceId } from '@/lib/device'
import type {
  AttemptFlagRequest,
  AttemptFlagResponse,
  EnemyLandmark,
  FlagAttemptResult,
  GpsPosition,
  SeedLandmark,
} from '@/lib/types'
import type {
  FlagAttemptDisabledReason,
} from '@/lib/hooks/useFlagAttemptButton'

const SEED = seedLandmarks as SeedLandmark[]

function landmarkName(ref: string): string {
  return SEED.find((s) => s.id === ref)?.name ?? ref
}

interface FlagAttemptButtonProps {
  gameId: string
  myPlayerId: string
  myGpsPos: GpsPosition | null
  meState: {
    enabled: boolean
    target: EnemyLandmark | null
    distance_m: number | null
    reason: FlagAttemptDisabledReason
  }
  onResult?: (result: AttemptFlagResponse) => void
}

function reasonLabel(reason: FlagAttemptDisabledReason): string {
  switch (reason) {
    case 'no_gps':
      return 'Enable GPS to attempt'
    case 'respawning':
      return 'You are respawning'
    case 'not_live':
      return 'No attempts right now'
    case 'no_landmark_in_range':
      return 'Walk within 20 m of an enemy candidate'
    case 'already_discovered':
      return 'This landmark is already revealed'
    case 'enabled':
    default:
      return ''
  }
}

type ResultTone = 'real' | 'decoy' | 'empty'

function resultMessage(result: FlagAttemptResult): {
  text: string
  tone: ResultTone
} {
  switch (result) {
    case 'real':
      return { text: 'REAL FLAG — RUN HOME', tone: 'real' }
    case 'decoy':
      return { text: 'Decoy! All intel lost.', tone: 'decoy' }
    case 'empty':
      return { text: 'Empty. Nothing here.', tone: 'empty' }
  }
}

export function FlagAttemptButton({
  gameId,
  myPlayerId,
  myGpsPos,
  meState,
  onResult,
}: FlagAttemptButtonProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<AttemptFlagResponse | null>(null)

  const { enabled, target, distance_m, reason } = meState
  const targetName = target ? landmarkName(target.ref) : ''
  const targetDistanceLabel =
    distance_m != null ? `${Math.round(distance_m)} m` : ''

  async function handleTap() {
    if (!enabled || !target || !myGpsPos || busy) return
    const confirmMsg = `Attempt flag at ${targetName}?`
    if (typeof window !== 'undefined' && !window.confirm(confirmMsg)) return

    setBusy(true)
    setError(null)
    setLastResult(null)

    const body: AttemptFlagRequest = {
      device_id: getDeviceId(),
      player_id: myPlayerId,
      landmark_ref: target.ref,
      pos: myGpsPos,
    }

    try {
      const res = await apiPost<AttemptFlagResponse>(
        `/api/games/${gameId}/attempt-flag`,
        body,
      )
      setLastResult(res)
      onResult?.(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown_error')
    } finally {
      setBusy(false)
    }
  }

  const result = lastResult ? resultMessage(lastResult.result) : null

  return (
    <div className="pointer-events-auto flex w-full flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={handleTap}
        disabled={!enabled || busy}
        className={cn(
          'w-full max-w-sm rounded-2xl px-6 py-4 text-base font-semibold uppercase tracking-wider shadow-lg transition focus:outline-none',
          enabled
            ? 'animate-pulse bg-amber-500 text-neutral-950 shadow-amber-900/40 hover:bg-amber-400 focus-visible:ring-2 focus-visible:ring-amber-200'
            : 'cursor-not-allowed bg-neutral-800 text-neutral-500 shadow-none',
          busy && 'opacity-75',
        )}
        aria-label={
          enabled
            ? `Attempt flag at ${targetName}, ${targetDistanceLabel} away`
            : 'Attempt flag button disabled'
        }
      >
        {enabled
          ? `ATTEMPT FLAG · ${targetName} (${targetDistanceLabel})`
          : 'ATTEMPT FLAG'}
      </button>
      {!enabled && (
        <p className="rounded bg-neutral-950/80 px-2 py-0.5 text-[11px] text-neutral-400">
          {reasonLabel(reason)}
        </p>
      )}
      {result && (
        <p
          className={cn(
            'rounded px-2 py-0.5 text-[11px] font-medium',
            result.tone === 'real' &&
              'bg-emerald-900/80 text-emerald-100',
            result.tone === 'decoy' &&
              'bg-red-950/80 text-red-200',
            result.tone === 'empty' && 'bg-neutral-900/80 text-neutral-300',
          )}
        >
          {result.text}
        </p>
      )}
      {error && (
        <p className="rounded bg-red-950/80 px-2 py-0.5 text-[11px] text-red-200">
          {error}
        </p>
      )}
    </div>
  )
}
