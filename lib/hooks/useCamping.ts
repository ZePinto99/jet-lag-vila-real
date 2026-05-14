'use client'

// Camping detection (rulebook §6 — "the 50 m camping rule").
//
// Defenders cannot stand within 50 m of any of their own candidate landmarks
// for more than 2 consecutive minutes. The app warns at 90 s and disables the
// Tag button at 120 s. To unlock, the player must leave the 50 m radius for at
// least 60 s.
//
// All state lives in this hook. It exposes a derived view (status + seconds in
// zone) and a `campingLocked` flag the Tag button keys off.

import { useEffect, useRef, useState } from 'react'
import { haversineMeters } from '@/lib/geo/haversine'
import type { GpsPosition, Landmark } from '@/lib/types'

export const CAMPING_RADIUS_M = 50
export const CAMPING_WARNING_S = 90
export const CAMPING_LOCK_S = 120
export const CAMPING_COOLDOWN_S = 60

export type CampingStatus = 'idle' | 'warning' | 'locked'

export interface UseCampingResult {
  status: CampingStatus
  secondsInZone: number
  campingLocked: boolean
  warningThresholdSeconds: typeof CAMPING_WARNING_S
  lockThresholdSeconds: typeof CAMPING_LOCK_S
}

export interface UseCampingParams {
  myGps: GpsPosition | null
  myTeamLandmarks: Landmark[]
}

function nowSeconds(): number {
  return Date.now() / 1000
}

export function useCamping(params: UseCampingParams): UseCampingResult {
  const { myGps, myTeamLandmarks } = params

  // Refs hold the raw state machine. We mutate them on every GPS update and on
  // every 1s tick, then mirror the derived view into state for the renderer.
  const enteredAtRef = useRef<number | null>(null)
  const leftAtRef = useRef<number | null>(null)
  const lockedRef = useRef(false)
  const insideRef = useRef(false)

  const [status, setStatus] = useState<CampingStatus>('idle')
  const [secondsInZone, setSecondsInZone] = useState(0)

  // Update inside/outside state immediately whenever GPS or landmarks change so
  // the state machine doesn't lag a second behind the position fix.
  useEffect(() => {
    if (!myGps || myTeamLandmarks.length === 0) {
      // Lost GPS or no own landmarks: treat as outside the radius but don't
      // touch lockedRef / leftAtRef — we need a real reading to start the
      // 60s cooldown.
      insideRef.current = false
      return
    }
    let minDistance = Number.POSITIVE_INFINITY
    for (const lm of myTeamLandmarks) {
      const d = haversineMeters(
        { lat: myGps.lat, lng: myGps.lng },
        { lat: lm.lat, lng: lm.lng },
      )
      if (d < minDistance) minDistance = d
    }
    const inside = minDistance <= CAMPING_RADIUS_M
    const t = nowSeconds()
    if (inside) {
      if (enteredAtRef.current === null) enteredAtRef.current = t
      leftAtRef.current = null
      insideRef.current = true
    } else {
      enteredAtRef.current = null
      // Start cooldown timer only when the player has just left the zone.
      if (insideRef.current) {
        leftAtRef.current = t
      }
      insideRef.current = false
    }
  }, [myGps, myTeamLandmarks])

  // 1 Hz tick that derives the view: how long we've been inside, and whether
  // the lock should engage / disengage. A separate effect from the GPS one so
  // the camping clock keeps advancing even when GPS hasn't sent a fresh fix.
  useEffect(() => {
    const id = window.setInterval(() => {
      const t = nowSeconds()
      const inside = insideRef.current

      let secs = 0
      if (inside && enteredAtRef.current !== null) {
        secs = Math.max(0, Math.floor(t - enteredAtRef.current))
      }

      // Engage lock when inside for >= 120s.
      if (inside && secs >= CAMPING_LOCK_S) {
        lockedRef.current = true
      }

      // Disengage lock when outside for >= 60s of cooldown.
      if (!inside && lockedRef.current) {
        const leftAt = leftAtRef.current
        if (leftAt !== null && t - leftAt >= CAMPING_COOLDOWN_S) {
          lockedRef.current = false
          leftAtRef.current = null
        }
      }

      let nextStatus: CampingStatus
      if (lockedRef.current) {
        nextStatus = 'locked'
      } else if (inside && secs >= CAMPING_WARNING_S) {
        nextStatus = 'warning'
      } else {
        nextStatus = 'idle'
      }

      setSecondsInZone(secs)
      setStatus((prev) => (prev === nextStatus ? prev : nextStatus))
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  return {
    status,
    secondsInZone,
    campingLocked: status === 'locked',
    warningThresholdSeconds: CAMPING_WARNING_S,
    lockThresholdSeconds: CAMPING_LOCK_S,
  }
}
