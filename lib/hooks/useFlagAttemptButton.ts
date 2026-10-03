'use client'

// Flag-attempt button eligibility hook (rulebook §5.2).
//
// Mirrors useTagButton: pure derivation from inputs. Returns whether the local
// player can currently "Attempt flag" at the nearest enemy candidate landmark
// — and which one. The button (FlagAttemptButton) owns the actual POST.
//
// The opening signal uses the rulebook's fresh-fix 28 m radius. The server
// revalidates submission and secretly tightens a hardened real flag to 12 m.
// If the nearest landmark's kind is already known, there is nothing to gain by
// exposing another attempt control there.

import { useMemo } from 'react'
import { haversineMeters } from '@/lib/geo/haversine'
import { isPositionFresh } from '@/lib/geo/positionFreshness'
import type { EnemyLandmark, GameStatus, GpsPosition, LandmarkKind } from '@/lib/types'

// Opening the mini-challenge follows RULEBOOK §5.2: a fresh fix within 28 m.
// Submission is revalidated server-side (and a hidden hardened flag requires
// 12 m), so this does not reveal which candidate was hardened.
export const FLAG_ATTEMPT_RADIUS_M = 28

// Start surfacing the contextual control shortly before the player reaches a
// candidate. At a normal walking pace this is roughly one minute of notice;
// far enough to prepare, without leaving a permanent button over the map.
export const FLAG_ATTEMPT_APPROACH_RADIUS_M = 80

export type FlagAttemptDisabledReason =
  | 'enabled'
  | 'no_gps'
  | 'respawning'
  | 'not_live'
  | 'no_landmark_in_range'
  | 'already_discovered'

export interface UseFlagAttemptButtonResult {
  enabled: boolean
  visible: boolean
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
  nowMs: number
}

export function useFlagAttemptButton(
  params: UseFlagAttemptButtonParams,
): UseFlagAttemptButtonResult {
  const { myGps, enemyLandmarks, respawning, gameStatus, discoveredEnemyKinds, nowMs } = params

  return useMemo<UseFlagAttemptButtonResult>(() => {
    if (!myGps || !isPositionFresh(myGps.updated_at, nowMs)) {
      return {
        enabled: false,
        visible: false,
        target: null,
        distance_m: null,
        reason: 'no_gps',
      }
    }
    if (respawning) {
      return {
        enabled: false,
        visible: false,
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
        visible: false,
        target: null,
        distance_m: null,
        reason: 'not_live',
      }
    }

    // Find the nearest enemy landmark.
    let nearest: EnemyLandmark | null = null
    let nearestDist = Number.POSITIVE_INFINITY
    for (const lm of enemyLandmarks) {
      const d = haversineMeters({ lat: myGps.lat, lng: myGps.lng }, { lat: lm.lat, lng: lm.lng })
      if (d < nearestDist) {
        nearestDist = d
        nearest = lm
      }
    }

    if (!nearest) {
      return {
        enabled: false,
        visible: false,
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
        visible: false,
        target: nearest,
        distance_m: nearestDist,
        reason: 'already_discovered',
      }
    }

    if (nearestDist > FLAG_ATTEMPT_RADIUS_M) {
      return {
        enabled: false,
        visible: nearestDist <= FLAG_ATTEMPT_APPROACH_RADIUS_M,
        target: nearest,
        distance_m: nearestDist,
        reason: 'no_landmark_in_range',
      }
    }

    return {
      enabled: true,
      visible: true,
      target: nearest,
      distance_m: nearestDist,
      reason: 'enabled',
    }
  }, [myGps, enemyLandmarks, respawning, gameStatus, discoveredEnemyKinds, nowMs])
}
