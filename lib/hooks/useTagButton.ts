'use client'

// Tag button eligibility hook (rulebook §6).
//
// Computes — every render — whether the Tag button should be enabled for the
// local player, and which enemy presences are currently within the 5 m tag
// radius. The actual POST to /tag is owned by the TagButton component; this
// hook is pure derivation so the button can also render the reason for being
// disabled.

import { useMemo } from 'react'
import { haversineMeters } from '@/lib/geo/haversine'
import { isInDefenseZone } from '@/lib/geo/zones'
import type { GpsPosition, Landmark, PresencePayload } from '@/lib/types'

// Display-side tag radius. The server re-validates at 10 m to account for GPS
// drift, but the button only lights up at the rulebook's 5 m.
export const TAG_RADIUS_M = 5

export type TagDisabledReason =
  | 'enabled'
  | 'no_gps'
  | 'respawning'
  | 'out_of_zone'
  | 'no_enemies_nearby'
  | 'camping_locked'

export interface TagTarget {
  player_id: string
  pos: GpsPosition
}

export interface UseTagButtonResult {
  enabled: boolean
  targets: TagTarget[]
  reason: TagDisabledReason
  inDefenseZone: boolean
}

export interface UseTagButtonParams {
  myGps: GpsPosition | null
  myPlayerId: string | null
  myTeamId: string | null
  myTeamLandmarks: Landmark[]
  presence: Record<string, PresencePayload>
  respawning: boolean
  campingLocked: boolean
}

export function useTagButton(params: UseTagButtonParams): UseTagButtonResult {
  const {
    myGps,
    myPlayerId,
    myTeamId,
    myTeamLandmarks,
    presence,
    respawning,
    campingLocked,
  } = params

  return useMemo<UseTagButtonResult>(() => {
    if (!myGps) {
      return {
        enabled: false,
        targets: [],
        reason: 'no_gps',
        inDefenseZone: false,
      }
    }

    const inDefenseZone = isInDefenseZone(
      { lat: myGps.lat, lng: myGps.lng },
      myTeamLandmarks.map((l) => ({ lat: l.lat, lng: l.lng })),
    )

    if (respawning) {
      return { enabled: false, targets: [], reason: 'respawning', inDefenseZone }
    }

    if (!inDefenseZone) {
      return { enabled: false, targets: [], reason: 'out_of_zone', inDefenseZone }
    }

    // Filter presence to opposing-team players within 5 m of me, skipping self.
    const targets: TagTarget[] = []
    for (const entry of Object.values(presence)) {
      if (!entry) continue
      if (entry.player_id === myPlayerId) continue
      if (myTeamId && entry.team_id === myTeamId) continue
      const distance = haversineMeters(
        { lat: myGps.lat, lng: myGps.lng },
        { lat: entry.lat, lng: entry.lng },
      )
      if (distance <= TAG_RADIUS_M) {
        targets.push({
          player_id: entry.player_id,
          pos: {
            lat: entry.lat,
            lng: entry.lng,
            accuracy: entry.accuracy,
            updated_at: entry.updated_at,
          },
        })
      }
    }

    if (targets.length === 0) {
      return {
        enabled: false,
        targets: [],
        reason: 'no_enemies_nearby',
        inDefenseZone,
      }
    }

    // Camping check runs LAST so the user sees "camping locked" only when they
    // otherwise would have been allowed to tag. Otherwise the reason cascade
    // ("no GPS" / "out of zone" / "no enemies") is more informative.
    if (campingLocked) {
      return {
        enabled: false,
        targets: [],
        reason: 'camping_locked',
        inDefenseZone,
      }
    }

    return { enabled: true, targets, reason: 'enabled', inDefenseZone }
  }, [
    myGps,
    myPlayerId,
    myTeamId,
    myTeamLandmarks,
    presence,
    respawning,
    campingLocked,
  ])
}
