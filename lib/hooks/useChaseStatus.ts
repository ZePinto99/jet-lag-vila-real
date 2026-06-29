'use client'

// useChaseStatus — derives the live distances that drive the cinematic chase
// HUD shown during game.status === 'flag_found'. From the flag carrier's
// position it computes:
//   - metersToHome:        how far the carrier is from their own home base
//   - nearestHunterMeters: distance to the closest enemy (hunter) currently
//                          broadcasting presence
// All inputs are ephemeral Presence-derived positions; nothing is persisted.

import { haversineMeters } from '@/lib/geo/haversine'
import type { GpsPosition, PresencePayload } from '@/lib/types'

export interface ChaseStatus {
  metersToHome: number | null
  nearestHunterMeters: number | null
}

interface UseChaseStatusParams {
  active: boolean
  carrierPos: GpsPosition | null
  carrierHome: { lat: number; lng: number } | null
  carrierTeamId: string | null
  presence: Record<string, PresencePayload>
}

export function useChaseStatus({
  active,
  carrierPos,
  carrierHome,
  carrierTeamId,
  presence,
}: UseChaseStatusParams): ChaseStatus {
  if (!active) {
    return { metersToHome: null, nearestHunterMeters: null }
  }

  const metersToHome =
    carrierPos && carrierHome ? haversineMeters(carrierPos, carrierHome) : null

  let nearestHunterMeters: number | null = null
  if (carrierPos) {
    for (const payload of Object.values(presence)) {
      if (payload.team_id === carrierTeamId) continue
      const d = haversineMeters(carrierPos, payload)
      if (nearestHunterMeters === null || d < nearestHunterMeters) {
        nearestHunterMeters = d
      }
    }
  }

  return { metersToHome, nearestHunterMeters }
}
