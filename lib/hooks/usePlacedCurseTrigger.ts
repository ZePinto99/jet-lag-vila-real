'use client'

// usePlacedCurseTrigger (PLAYTEST_TRIAGE P2-2) — when the local player enters an
// enemy candidate's defense zone, POST /trigger-placed-curse so the server can
// fire any hidden placement armed there. Fires once per zone entry (resets when
// the player leaves), so we don't spam the endpoint while loitering. The player
// doesn't know whether a trap exists — the server decides and stays silent if
// not.

import { useEffect, useRef } from 'react'
import { apiPost } from '@/lib/api'
import { getDeviceId } from '@/lib/device'
import { haversineMeters } from '@/lib/geo/haversine'
import { DEFENSE_ZONE_RADIUS_M } from '@/lib/geo/zones'
import type { EnemyLandmark, GpsPosition } from '@/lib/types'

export function usePlacedCurseTrigger(
  gameId: string | null,
  myPlayerId: string | null,
  myGps: GpsPosition | null,
  enemyLandmarks: EnemyLandmark[],
  active: boolean,
): void {
  const insideRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!active || !gameId || !myPlayerId || !myGps) {
      insideRef.current = new Set()
      return
    }
    const stillInside = new Set<string>()
    let enteredNew = false
    for (const lm of enemyLandmarks) {
      const d = haversineMeters(
        { lat: myGps.lat, lng: myGps.lng },
        { lat: lm.lat, lng: lm.lng },
      )
      if (d <= DEFENSE_ZONE_RADIUS_M) {
        stillInside.add(lm.ref)
        if (!insideRef.current.has(lm.ref)) enteredNew = true
      }
    }
    insideRef.current = stillInside

    if (enteredNew) {
      apiPost(`/api/games/${gameId}/trigger-placed-curse`, {
        device_id: getDeviceId(),
        player_id: myPlayerId,
        pos: myGps,
      }).catch(() => {})
    }
  }, [gameId, myPlayerId, myGps, enemyLandmarks, active])
}
