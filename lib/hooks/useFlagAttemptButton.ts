'use client'

// Flag-attempt button eligibility hook (rulebook §5.2).
//
// Mirrors useTagButton: pure derivation from inputs. Returns whether the local
// player can currently "Attempt flag" at the nearest enemy candidate landmark
// — and which one. The button (FlagAttemptButton) owns the actual POST.
//
// The server validates at 20 m; we light up the client button when the player
// is within 20 m of the nearest enemy candidate landmark. If that landmark's
// kind is already known (it's in `discoveredEnemyKinds`), we don't enable the
// attempt — there's nothing to discover by attempting again.

import { useMemo } from 'react'
import { haversineMeters } from '@/lib/geo/haversine'
import type {
  EnemyLandmark,
  GameStatus,
  GpsPosition,
  LandmarkKind,
} from '@/lib/types'

// Display-side attempt radius. Server re-validates at 20 m with its own
// tolerance.
export const FLAG_ATTEMPT_RADIUS_M = 20

export type FlagAttemptDisabledReason =
  | 'enabled'
  | 'no_gps'
  | 'respawning'
  | 'not_live'
  | 'no_landmark_in_range'
  | 'already_discovered'

export interface UseFlagAttemptButtonResult {
  enabled: boolean
  target: EnemyLandmark | null
  distance_m: number | null
  reason: FlagAttemptDisabledReason
}

export interface UseFlagAttemptButtonParams {
  myGps: GpsPosition | null
  enemyLandmarks: EnemyLandmark[]
  respawning: boolean
  gameStatus: GameStatus
  discoveredEnemyKinds: Record<string, LandmarkKind>
}

export function useFlagAttemptButton(
  params: UseFlagAttemptButtonParams,
): UseFlagAttemptButtonResult {
  const {
    myGps,
    enemyLandmarks,
    respawning,
    gameStatus,
    discoveredEnemyKinds,
  } = params

  return useMemo<UseFlagAttemptButtonResult>(() => {
    if (!myGps) {
      return { enabled: false, target: null, distance_m: null, reason: 'no_gps' }
    }
    if (respawning) {
      return {
        enabled: false,
        target: null,
        distance_m: null,
        reason: 'respawning',
      }
    }
    if (gameStatus !== 'live') {
      // No attempts during flag_found (the carrier is running home),
      // finished, paused, or setup/lobby.
      return {
        enabled: false,
        target: null,
        distance_m: null,
        reason: 'not_live',
      }
    }

    // Find the nearest enemy landmark.
    let nearest: EnemyLandmark | null = null
    let nearestDist = Number.POSITIVE_INFINITY
    for (const lm of enemyLandmarks) {
      const d = haversineMeters(
        { lat: myGps.lat, lng: myGps.lng },
        { lat: lm.lat, lng: lm.lng },
      )
      if (d < nearestDist) {
        nearestDist = d
        nearest = lm
      }
    }

    if (!nearest || nearestDist > FLAG_ATTEMPT_RADIUS_M) {
      return {
        enabled: false,
        target: null,
        distance_m: null,
        reason: 'no_landmark_in_range',
      }
    }

    if (discoveredEnemyKinds[nearest.ref]) {
      // We've already attempted this landmark and learned its kind. No point
      // burning another attempt.
      return {
        enabled: false,
        target: nearest,
        distance_m: nearestDist,
        reason: 'already_discovered',
      }
    }

    return {
      enabled: true,
      target: nearest,
      distance_m: nearestDist,
      reason: 'enabled',
    }
  }, [myGps, enemyLandmarks, respawning, gameStatus, discoveredEnemyKinds])
}
