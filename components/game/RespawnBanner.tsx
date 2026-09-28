'use client'

// RespawnBanner — shown at the top of the Map tab whenever the local player
// has player.respawning=true. The player must walk to a neutral landmark and
// tap the confirm button; the server checks position and clears the flag.
//
// We call fetch directly here because 409 responses carry the exact required
// target/distance details that apiPost intentionally collapses to an error.
//
// P7: walking to the assigned target and confirming is the PRIMARY exit, and
// the player is action-locked until it happens (lib/server/actionLock.ts
// short-circuits before every other check). Migration 0055 added two fallbacks
// for the player whose GPS will not confirm: a 10-minute grace sweep
// (sweep_stuck_respawns, on the 30 s pg_cron job) and a host override
// (/host-clear-respawn). Migration 0056 shifts respawning_since on a weather
// pause so paused time is not charged against that grace.
//
// This banner must state the lock, show the live distance to the exact required
// landmark, AND name the fallbacks — an earlier version told the player "this
// does not time out… nothing else clears it", which was true when written and
// became a lie the moment 0055 shipped. Keep this copy in step with the
// migrations.

import { useState } from 'react'
import { cn } from '@/lib/cn'
import { getDeviceId } from '@/lib/device'
import { NEUTRAL_LEAVE_RADIUS_M } from '@/lib/gameConstants'
import { haversineMeters } from '@/lib/geo/haversine'
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

  // Live distance to the exact assigned landmark. Derived, never stored: this is
  // guidance, so it must not wait on a server round-trip. Null when GPS is off
  // or the assigned ref is not in the seed catalog.
  const distanceM =
    myGps && target
      ? haversineMeters({ lat: myGps.lat, lng: myGps.lng }, { lat: target.lat, lng: target.lng })
      : null
  const rounded = distanceM == null ? null : Math.round(distanceM)
  // Stage 2 inverts the goal: the player must now get AWAY from the landmark.
  const metresStillNeeded =
    rounded == null ? null : Math.max(0, NEUTRAL_LEAVE_RADIUS_M - rounded)

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
      {/* The action lock is the single most surprising part of being tagged:
          every other button in the app goes dead. Say so explicitly. */}
      <p className="mt-1 rounded bg-amber-950/50 px-2 py-1 text-[11px] font-semibold text-amber-100">
        {t('respawn.locked_notice')}
      </p>
      {/* Live distance to the exact required landmark — stage 1 counts down to
          it, stage 2 counts away from it. */}
      <p className="mt-1 font-mono text-[11px] tabular-nums text-amber-200">
        {rounded == null
          ? t('respawn.distance_unknown')
          : respawnArrived
            ? metresStillNeeded === 0
              ? t('respawn.leave_ready', { target: targetName })
              : t('respawn.leave_progress', {
                  distance: rounded,
                  target: targetName,
                  needed: metresStillNeeded ?? NEUTRAL_LEAVE_RADIUS_M,
                })
            : t('respawn.distance_to_target', { distance: rounded, target: targetName })}
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
        <>
          <p role="alert" className="mt-2 rounded bg-red-950/60 px-2 py-1 text-[11px] text-red-200">
            {error}
          </p>
          {/* Only after a failed confirm: the player has now actually hit the
              stuck case, so the recovery advice is relevant rather than noise. */}
          <p className="mt-1 text-[11px] text-amber-200/80">
            {t('respawn.gps_stuck_hint', { target: targetName })}
          </p>
        </>
      )}
      <p className="mt-1 text-[11px] text-amber-200/70">{t('respawn.timeout_hint')}</p>
    </div>
  )
}
