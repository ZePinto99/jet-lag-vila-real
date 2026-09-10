'use client'

// Durable camping enforcement (RULEBOOK §6).
//
// GPS itself remains ephemeral. The server derives only whether the player is
// within 50 m of an own candidate and persists the resulting gameplay-clock
// counters. This makes warning/lock/cooldown survive reloads while weather
// pause and offline gaps cannot manufacture elapsed camping time.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiPost } from '@/lib/api'
import { getDeviceId } from '@/lib/device'
import { haversineMeters } from '@/lib/geo/haversine'
import { isPositionFresh } from '@/lib/geo/positionFreshness'
import type { GpsPosition, Landmark } from '@/lib/types'

export const CAMPING_RADIUS_M = 50
export const CAMPING_WARNING_S = 90
export const CAMPING_LOCK_S = 120
export const CAMPING_COOLDOWN_S = 60
export const CAMPING_HEARTBEAT_MS = 5_000

// The database deliberately caps inference across a missed heartbeat at 15 s.
// Keep the optimistic client readout within that same bound.
const MAX_UNOBSERVED_PROJECTION_S = 15

export type CampingStatus = 'idle' | 'warning' | 'locked'

interface CampingHeartbeatResponse {
  inside_zone: boolean
  seconds_in_zone: number
  seconds_outside: number
  locked: boolean
  last_heartbeat_at: string
}

interface AuthoritativeCampingState extends CampingHeartbeatResponse {
  receivedAtGameClockMs: number
}

export interface UseCampingResult {
  status: CampingStatus
  secondsInZone: number
  secondsOutside: number
  campingLocked: boolean
  warningThresholdSeconds: typeof CAMPING_WARNING_S
  lockThresholdSeconds: typeof CAMPING_LOCK_S
  lastHeartbeatAt: string | null
  syncError: string | null
}

export interface UseCampingParams {
  gameId: string | null
  myPlayerId: string | null
  myGps: GpsPosition | null
  myTeamLandmarks: Landmark[]
  /** Enables durable state fetches in live, flag-found, and paused phases. */
  enabled?: boolean
  /** False while weather-paused: warning and cooldown projections freeze. */
  gameplayActive?: boolean
  /** Pause-aware game clock, used only for the on-screen projection. */
  clockNowMs?: number
  /** Wall clock, used only for GPS freshness. */
  wallNowMs?: number
}

export function useCamping(params: UseCampingParams): UseCampingResult {
  const {
    gameId,
    myPlayerId,
    myGps,
    myTeamLandmarks,
    enabled = true,
    gameplayActive = true,
    clockNowMs = Date.now(),
    wallNowMs = Date.now(),
  } = params

  const [authoritative, setAuthoritative] =
    useState<AuthoritativeCampingState | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const gpsRef = useRef(myGps)
  const gameClockRef = useRef(clockNowMs)
  const requestInFlightRef = useRef(false)
  gpsRef.current = myGps
  gameClockRef.current = clockNowMs

  const locallyInsideZone = useMemo<boolean | null>(() => {
    if (!myGps || myTeamLandmarks.length === 0) return null
    return myTeamLandmarks.some(
      (landmark) => haversineMeters(myGps, landmark) <= CAMPING_RADIUS_M,
    )
  }, [myGps, myTeamLandmarks])

  const gpsReady =
    myGps !== null && isPositionFresh(myGps.updated_at, wallNowMs)

  useEffect(() => {
    setAuthoritative(null)
    setSyncError(null)
  }, [gameId, myPlayerId])

  const sendHeartbeat = useCallback(async () => {
    if (!enabled || !gameId || !myPlayerId || requestInFlightRef.current) return
    const gps = gpsRef.current
    if (!gps || !isPositionFresh(gps.updated_at, Date.now())) return

    requestInFlightRef.current = true
    try {
      const state = await apiPost<CampingHeartbeatResponse>(
        `/api/games/${gameId}/camping-heartbeat`,
        {
          device_id: getDeviceId(),
          player_id: myPlayerId,
          pos: gps,
        },
      )
      setAuthoritative({
        ...state,
        receivedAtGameClockMs: gameClockRef.current,
      })
      setSyncError(null)
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'camping_sync_failed')
    } finally {
      requestInFlightRef.current = false
    }
  }, [enabled, gameId, myPlayerId])

  // Fetch immediately on mount/reload and when crossing the local 50 m edge;
  // the steady heartbeat then advances the authoritative timer. The interval
  // reads the latest GPS from a ref so ordinary location updates do not create
  // a request storm.
  useEffect(() => {
    if (!enabled || !gpsReady) return
    void sendHeartbeat()
    const id = window.setInterval(() => {
      void sendHeartbeat()
    }, CAMPING_HEARTBEAT_MS)
    return () => window.clearInterval(id)
  }, [enabled, gpsReady, locallyInsideZone, sendHeartbeat])

  if (!authoritative) {
    return {
      status: 'idle',
      secondsInZone: 0,
      secondsOutside: 0,
      campingLocked: false,
      warningThresholdSeconds: CAMPING_WARNING_S,
      lockThresholdSeconds: CAMPING_LOCK_S,
      lastHeartbeatAt: null,
      syncError,
    }
  }

  const projectedSeconds = gameplayActive && gpsReady
    ? Math.min(
        MAX_UNOBSERVED_PROJECTION_S,
        Math.max(
          0,
          Math.floor((clockNowMs - authoritative.receivedAtGameClockMs) / 1000),
        ),
      )
    : 0
  const secondsInZone = authoritative.seconds_in_zone +
    (authoritative.inside_zone ? projectedSeconds : 0)
  const secondsOutside = authoritative.seconds_outside +
    (!authoritative.inside_zone ? projectedSeconds : 0)

  let campingLocked = authoritative.locked
  if (authoritative.inside_zone && secondsInZone >= CAMPING_LOCK_S) {
    campingLocked = true
  } else if (
    authoritative.locked &&
    !authoritative.inside_zone &&
    secondsOutside >= CAMPING_COOLDOWN_S
  ) {
    campingLocked = false
  }

  const status: CampingStatus = campingLocked
    ? 'locked'
    : authoritative.inside_zone && secondsInZone >= CAMPING_WARNING_S
      ? 'warning'
      : 'idle'

  return {
    status,
    secondsInZone,
    secondsOutside,
    campingLocked,
    warningThresholdSeconds: CAMPING_WARNING_S,
    lockThresholdSeconds: CAMPING_LOCK_S,
    lastHeartbeatAt: authoritative.last_heartbeat_at,
    syncError,
  }
}
