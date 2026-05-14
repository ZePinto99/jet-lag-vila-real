'use client'

// RespawnBanner — shown at the top of the Map tab whenever the local player
// has player.respawning=true. The player must walk to a neutral landmark and
// tap the confirm button; the server checks position and clears the flag.
//
// We call fetch directly here (instead of apiPost) because the 409
// `not_at_neutral_landmark` response carries a `details.nearest_m` field we
// want to surface — apiPost only exposes the error string.

import { useState } from 'react'
import { cn } from '@/lib/cn'
import { getDeviceId } from '@/lib/device'
import type {
  ApiError,
  GpsPosition,
  RespawnClearRequest,
  RespawnClearResponse,
} from '@/lib/types'

interface RespawnBannerProps {
  gameId: string
  myPlayerId: string
  myGps: GpsPosition | null
  respawning: boolean
  onCleared?: (result: RespawnClearResponse) => void
}

// Display hint mirroring data/landmarks.json neutral pool. Names only — the
// server is the source of truth for which landmarks count.
const NEUTRAL_LANDMARK_NAMES = [
  'Avenida Carvalho Araújo',
  'Ponte Metálica',
  'Teatro de Vila Real',
  'Estação Rodoviária',
] as const

interface RespawnErrorBody extends ApiError {
  details?: {
    nearest_m?: number
  } | unknown
}

export function RespawnBanner({
  gameId,
  myPlayerId,
  myGps,
  respawning,
  onCleared,
}: RespawnBannerProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!respawning) return null

  async function handleConfirm() {
    if (!myGps || busy) return
    setBusy(true)
    setError(null)

    const body: RespawnClearRequest = {
      device_id: getDeviceId(),
      player_id: myPlayerId,
      pos: myGps,
    }

    try {
      const res = await fetch(`/api/games/${gameId}/respawn-clear`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json().catch(() => null)) as
        | RespawnClearResponse
        | RespawnErrorBody
        | null

      if (!res.ok) {
        const errBody = (data ?? {}) as RespawnErrorBody
        const code = errBody.error ?? `request_failed_${res.status}`
        if (code === 'not_at_neutral_landmark') {
          const details = errBody.details
          const nearest =
            details &&
            typeof details === 'object' &&
            'nearest_m' in details &&
            typeof (details as { nearest_m?: number }).nearest_m === 'number'
              ? Math.round((details as { nearest_m: number }).nearest_m)
              : null
          setError(
            nearest != null
              ? `You're ~${nearest} m from the nearest neutral — keep walking.`
              : 'Not at a neutral landmark yet — keep walking.',
          )
        } else {
          setError(code)
        }
        return
      }

      onCleared?.(data as RespawnClearResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown_error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-b border-amber-700 bg-amber-900/40 px-4 py-3 text-sm text-amber-100">
      <p className="font-medium">You were tagged.</p>
      <p className="mt-0.5 text-xs text-amber-200/90">
        Walk to a neutral landmark ({NEUTRAL_LANDMARK_NAMES.join(', ')})
        and tap below when you arrive.
      </p>
      <div className="mt-2 flex flex-col items-stretch gap-1 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!myGps || busy}
          className={cn(
            'rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wider transition',
            myGps && !busy
              ? 'bg-amber-200 text-amber-950 hover:bg-amber-100'
              : 'cursor-not-allowed bg-amber-800/40 text-amber-300/60',
          )}
        >
          {busy ? 'Checking…' : "I'm at a neutral landmark"}
        </button>
        {!myGps && (
          <span className="text-[11px] text-amber-200/80">
            Enable GPS to confirm position.
          </span>
        )}
      </div>
      {error && (
        <p className="mt-2 rounded bg-red-950/60 px-2 py-1 text-[11px] text-red-200">
          {error}
        </p>
      )}
    </div>
  )
}
