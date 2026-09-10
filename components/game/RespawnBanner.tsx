'use client'

// RespawnBanner — shown at the top of the Map tab whenever the local player
// has player.respawning=true. The player must walk to a neutral landmark and
// tap the confirm button; the server checks position and clears the flag.
//
// We call fetch directly here because 409 responses carry the exact required
// target/distance details that apiPost intentionally collapses to an error.

import { useState } from 'react'
import { cn } from '@/lib/cn'
import { getDeviceId } from '@/lib/device'
import { getSeedLandmarkByRef } from '@/lib/landmarks'
import { useT } from '@/lib/i18n/context'
import type {
  ApiError,
  GpsPosition,
  Player,
  RespawnClearRequest,
  RespawnClearResponse,
} from '@/lib/types'

interface RespawnBannerProps {
  gameId: string
  myPlayerId: string
  myGps: GpsPosition | null
  respawning: boolean
  respawnTargetRef?: string | null
  respawnArrived?: boolean
  lockedLabel?: string | null
  onPlayerUpdate?: (player: Player) => void
  onCleared?: (result: RespawnClearResponse) => void
}

interface RespawnErrorBody extends ApiError {
  details?: {
    required_ref?: string
    required_name?: string
    distance_m?: number
    leave_radius_m?: number
  } | unknown
}

export function RespawnBanner({
  gameId,
  myPlayerId,
  myGps,
  respawning,
  respawnTargetRef = null,
  respawnArrived = false,
  lockedLabel = null,
  onPlayerUpdate,
  onCleared,
}: RespawnBannerProps) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const target = respawnTargetRef ? getSeedLandmarkByRef(respawnTargetRef) : null
  const targetName = target?.name ?? respawnTargetRef ?? t('respawn.assigned_neutral')

  if (!respawning) return null

  async function handleConfirm() {
    if (!myGps || busy || lockedLabel) return
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
        if (
          code === 'wrong_respawn_landmark' ||
          code === 'not_at_respawn_landmark' ||
          code === 'must_leave_neutral'
        ) {
          const details = errBody.details
          const safe = details && typeof details === 'object'
            ? details as { required_name?: unknown; distance_m?: unknown; leave_radius_m?: unknown }
            : null
          const requiredName = typeof safe?.required_name === 'string' ? safe.required_name : targetName
          const distance = typeof safe?.distance_m === 'number' ? Math.round(safe.distance_m) : null
          const leaveRadius = typeof safe?.leave_radius_m === 'number' ? Math.round(safe.leave_radius_m) : 45
          if (code === 'wrong_respawn_landmark') {
            setError(t('respawn.wrong_target', {
              target: requiredName,
              distance: distance == null ? '—' : distance,
            }))
          } else if (code === 'must_leave_neutral') {
            setError(t('respawn.must_leave', { target: requiredName, distance: leaveRadius }))
          } else {
            setError(t('respawn.go_to_target', {
              target: requiredName,
              distance: distance == null ? '—' : distance,
            }))
          }
        } else {
          setError(code)
        }
        return
      }

      onPlayerUpdate?.((data as RespawnClearResponse).player)
      onCleared?.(data as RespawnClearResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown_error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-b border-amber-700 bg-amber-900/40 px-4 py-3 text-sm text-amber-100">
      <p className="font-medium">{t('respawn.tagged')}</p>
      <p className="mt-0.5 text-xs text-amber-200/90">
        {respawnArrived
          ? t('respawn.arrived_hint', { target: targetName })
          : t('respawn.target_hint', { target: targetName })}
      </p>
      <div className="mt-2 flex flex-col items-stretch gap-1 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={!myGps || busy || lockedLabel !== null}
          className={cn(
            'rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wider transition',
            myGps && !busy && !lockedLabel
              ? 'bg-amber-200 text-amber-950 hover:bg-amber-100'
              : 'cursor-not-allowed bg-amber-800/40 text-amber-300/60',
          )}
        >
          {busy
            ? t('respawn.checking')
            : respawnArrived
              ? t('respawn.left_target', { target: targetName })
              : t('respawn.reached_target', { target: targetName })}
        </button>
        {!myGps && (
          <span className="text-[11px] text-amber-200/80">
            {t('respawn.enable_gps')}
          </span>
        )}
        {lockedLabel && <span className="text-[11px] text-amber-200/80">{lockedLabel}</span>}
      </div>
      {error && (
        <p role="alert" className="mt-2 rounded bg-red-950/60 px-2 py-1 text-[11px] text-red-200">
          {error}
        </p>
      )}
    </div>
  )
}
