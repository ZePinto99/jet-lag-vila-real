'use client'

// FlagCarrierBanner — shown to the player who is carrying the real flag while
// game.status === 'flag_found'. Tells them where home base is, the live
// distance, and auto-fires POST /api/games/[id]/complete-run when they cross
// the 30 m home-base geofence.
//
// Auto-fire is gated by a ref so we only POST once per crossing. On success
// the realtime games update flips status='finished' and the parent's
// GameOverOverlay takes over.

import { useEffect, useRef, useState } from 'react'
import seedLandmarks from '@/data/landmarks.json'
import { apiPost } from '@/lib/api'
import { haversineMeters } from '@/lib/geo/haversine'
import { getDeviceId } from '@/lib/device'
import type {
  CompleteRunRequest,
  CompleteRunResponse,
  GpsPosition,
  SeedLandmark,
  Team,
} from '@/lib/types'

const SEED = seedLandmarks as SeedLandmark[]

// Mirrors the server-side threshold for the home-base geofence.
export const HOME_BASE_RADIUS_M = 30

interface FlagCarrierBannerProps {
  gameId: string
  myPlayerId: string
  myTeam: Team
  myGps: GpsPosition | null
}

function findSeed(id: string | null): SeedLandmark | null {
  if (!id) return null
  return SEED.find((s) => s.id === id) ?? null
}

export function FlagCarrierBanner({
  gameId,
  myPlayerId,
  myTeam,
  myGps,
}: FlagCarrierBannerProps) {
  const homeSeed = findSeed(myTeam.home_landmark_id)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submittedRef = useRef(false)

  const distanceM =
    myGps && homeSeed
      ? haversineMeters(
          { lat: myGps.lat, lng: myGps.lng },
          { lat: homeSeed.lat, lng: homeSeed.lng },
        )
      : null

  useEffect(() => {
    // Fire complete-run exactly once when the carrier first crosses the
    // home-base geofence. The ref prevents re-submission if the GPS jitter
    // bounces in and out of the radius.
    if (submittedRef.current) return
    if (!myGps || distanceM == null) return
    if (distanceM > HOME_BASE_RADIUS_M) return
    submittedRef.current = true

    setSubmitting(true)
    setError(null)
    const body: CompleteRunRequest = {
      device_id: getDeviceId(),
      player_id: myPlayerId,
      pos: myGps,
    }
    apiPost<CompleteRunResponse>(`/api/games/${gameId}/complete-run`, body)
      .catch((err) => {
        // Allow retry on failure: clear the ref so a fresh GPS fix can try
        // again. Surface the error inline meanwhile.
        submittedRef.current = false
        setError(err instanceof Error ? err.message : 'unknown_error')
      })
      .finally(() => setSubmitting(false))
  }, [gameId, myPlayerId, myGps, distanceM])

  const homeName = homeSeed?.name ?? 'home base'

  return (
    <div className="border-b border-emerald-700 bg-emerald-900/60 px-4 py-3 text-sm text-emerald-50">
      <p className="text-sm font-semibold uppercase tracking-wider">
        You have the flag — run to {homeName}
      </p>
      <div className="mt-1 flex items-center justify-between gap-3 text-xs text-emerald-100/90">
        {myGps ? (
          distanceM != null ? (
            <span>
              <span className="font-mono tabular-nums text-base font-semibold text-white">
                {Math.round(distanceM)} m
              </span>{' '}
              to {homeName}
            </span>
          ) : (
            <span>Locating home base…</span>
          )
        ) : (
          <span>Enable GPS to track distance.</span>
        )}
        {submitting && (
          <span className="rounded bg-emerald-950/70 px-2 py-0.5 font-medium text-emerald-100">
            Submitting…
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
