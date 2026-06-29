'use client'

// Walking-speed estimator for the "walking only" gentle-enforcement nudge.
//
// This is a soft, non-punitive signal: the game is meant to be played on foot,
// so if a player's GPS track shows vehicle-like speed we surface a friendly
// "please slow down" pill. There is no penalty and nothing is sent to the
// server — it's purely a local UI hint.
//
// Speed is noisy on phones in narrow streets, so we:
//   • keep a small rolling history of distinct fixes,
//   • smooth the instantaneous speed over the last ~3 samples,
//   • discard implausible jumps (> 60 km/h → almost certainly a GPS glitch),
//   • require the smoothed speed to stay high for ≥2 consecutive samples before
//     flagging, and apply hysteresis so the pill doesn't flicker.

import { useEffect, useRef, useState } from 'react'
import { haversineMeters } from '@/lib/geo/haversine'
import type { GpsPosition } from '@/lib/types'

// Above this smoothed speed we consider the player to be in a vehicle (a brisk
// run tops out around 10–12 km/h).
export const SPEEDING_ON_KMH = 12
// Hysteresis: once flagged, only clear when speed drops back below this.
export const SPEEDING_OFF_KMH = 9
// Single-sample speed above this is treated as a GPS glitch and skipped.
export const GLITCH_MAX_KMH = 60
// Consecutive smoothed samples above SPEEDING_ON_KMH before we flag.
export const SPEEDING_MIN_SAMPLES = 2
// How many recent instantaneous speeds we average over.
export const SMOOTHING_WINDOW = 3
// Discard fixes closer together than this in time — too short to be reliable.
const MIN_DELTA_MS = 250

interface SpeedSample {
  lat: number
  lng: number
  updated_at: number
}

export interface UseWalkingSpeedResult {
  speedKmh: number | null
  speeding: boolean
}

function msToKmh(metres: number, ms: number): number {
  const seconds = ms / 1000
  if (seconds <= 0) return 0
  return (metres / seconds) * 3.6
}

export function useWalkingSpeed(
  position: GpsPosition | null,
): UseWalkingSpeedResult {
  // Last position we accepted into the history (used to compute the next leg).
  const lastSampleRef = useRef<SpeedSample | null>(null)
  // Rolling window of recent instantaneous speeds (km/h) for smoothing.
  const speedHistoryRef = useRef<number[]>([])
  // Count of consecutive smoothed samples above the ON threshold.
  const aboveCountRef = useRef(0)
  // Latched flag the hysteresis logic toggles.
  const speedingRef = useRef(false)

  const [speedKmh, setSpeedKmh] = useState<number | null>(null)
  const [speeding, setSpeeding] = useState(false)

  useEffect(() => {
    if (!position) return

    const next: SpeedSample = {
      lat: position.lat,
      lng: position.lng,
      updated_at: position.updated_at,
    }

    const prev = lastSampleRef.current

    // First fix: seed the history, nothing to compare against yet.
    if (!prev) {
      lastSampleRef.current = next
      return
    }

    const dtMs = next.updated_at - prev.updated_at
    // Ignore duplicate / out-of-order / too-close-together fixes.
    if (dtMs < MIN_DELTA_MS) return

    const metres = haversineMeters(prev, next)
    const instantKmh = msToKmh(metres, dtMs)

    // Drop glitchy teleports — keep the previous sample as the anchor so the
    // next real fix measures from a sane origin.
    if (instantKmh > GLITCH_MAX_KMH) {
      lastSampleRef.current = next
      return
    }

    lastSampleRef.current = next

    const history = speedHistoryRef.current
    history.push(instantKmh)
    if (history.length > SMOOTHING_WINDOW) history.shift()

    const smoothed =
      history.reduce((sum, v) => sum + v, 0) / history.length

    // Need at least two fixes (one leg) before reporting a speed.
    setSpeedKmh(Math.round(smoothed * 10) / 10)

    // Hysteresis state machine on the smoothed speed.
    if (smoothed >= SPEEDING_ON_KMH) {
      aboveCountRef.current += 1
      if (aboveCountRef.current >= SPEEDING_MIN_SAMPLES) {
        speedingRef.current = true
      }
    } else {
      aboveCountRef.current = 0
      if (smoothed < SPEEDING_OFF_KMH) {
        speedingRef.current = false
      }
    }

    setSpeeding((prevFlag) =>
      prevFlag === speedingRef.current ? prevFlag : speedingRef.current,
    )
  }, [position])

  return { speedKmh, speeding }
}
