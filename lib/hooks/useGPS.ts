'use client'

import { useEffect, useRef, useState } from 'react'
import { haversineMeters } from '@/lib/geo/haversine'
import type { GpsPosition } from '@/lib/types'

// Minimum movement (metres) since the last published position to publish a new one.
const MIN_MOVE_METRES = 3
// Minimum elapsed time (ms) since the last published position to publish anyway.
const MIN_ELAPSED_MS = 5_000

type WakeLockSentinelLike = {
  released: boolean
  release: () => Promise<void>
  addEventListener: (type: 'release', listener: () => void) => void
  removeEventListener: (type: 'release', listener: () => void) => void
}

type WakeLockApiLike = {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>
}

function getWakeLockApi(): WakeLockApiLike | null {
  if (typeof navigator === 'undefined') return null
  const nav = navigator as Navigator & { wakeLock?: WakeLockApiLike }
  return nav.wakeLock ?? null
}

function mapGeolocationError(err: GeolocationPositionError): string {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'gps_permission_denied'
    case err.POSITION_UNAVAILABLE:
      return 'gps_unavailable'
    case err.TIMEOUT:
      return 'gps_timeout'
    default:
      return 'gps_error'
  }
}

// Wraps navigator.geolocation.watchPosition with throttled updates and a
// screen wake lock so the GPS stream survives a screen-dimmed tab.
//
// position is null until the first reading arrives.
// error is set to a short string on any geolocation failure.
// wakeActive is true while the screen wake lock is held.
export function useGPS(enabled: boolean): {
  position: GpsPosition | null
  error: string | null
  wakeActive: boolean
} {
  const [position, setPosition] = useState<GpsPosition | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wakeActive, setWakeActive] = useState(false)

  // Last position we actually surfaced (used for the move-distance throttle).
  const lastPublishedRef = useRef<GpsPosition | null>(null)
  // Wake lock sentinel (so we can release on cleanup).
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null)

  useEffect(() => {
    if (!enabled) return
    if (typeof navigator === 'undefined' || typeof window === 'undefined') {
      return
    }
    if (!navigator.geolocation) {
      setError('gps_unsupported')
      return
    }

    let cancelled = false

    const handleSuccess = (pos: GeolocationPosition) => {
      if (cancelled) return
      const next: GpsPosition = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        updated_at: Date.now(),
      }
      const prev = lastPublishedRef.current
      if (prev) {
        const movedMeters = haversineMeters(prev, next)
        const elapsedMs = next.updated_at - prev.updated_at
        if (movedMeters < MIN_MOVE_METRES && elapsedMs < MIN_ELAPSED_MS) {
          return
        }
      }
      lastPublishedRef.current = next
      setError(null)
      setPosition(next)
    }

    const handleError = (err: GeolocationPositionError) => {
      if (cancelled) return
      setError(mapGeolocationError(err))
    }

    const watchId = navigator.geolocation.watchPosition(
      handleSuccess,
      handleError,
      {
        enableHighAccuracy: true,
        maximumAge: 10_000,
        timeout: 20_000,
      },
    )

    // Wake lock: request now and re-request when the tab becomes visible
    // (the browser releases it on tab blur / screen off).
    const wakeApi = getWakeLockApi()

    const handleWakeRelease = () => {
      setWakeActive(false)
    }

    const acquireWakeLock = async () => {
      if (!wakeApi) return
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return
      }
      try {
        const sentinel = await wakeApi.request('screen')
        if (cancelled) {
          await sentinel.release().catch(() => {})
          return
        }
        wakeLockRef.current = sentinel
        sentinel.addEventListener('release', handleWakeRelease)
        setWakeActive(true)
      } catch {
        // Wake Lock can fail if the tab isn't focused; ignore silently.
      }
    }

    const handleVisibilityChange = () => {
      if (typeof document === 'undefined') return
      if (document.visibilityState === 'visible' && !wakeLockRef.current?.released) {
        // If we still have a live sentinel, do nothing.
        if (wakeLockRef.current && !wakeLockRef.current.released) return
        void acquireWakeLock()
      }
    }

    void acquireWakeLock()
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }

    return () => {
      cancelled = true
      navigator.geolocation.clearWatch(watchId)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
      const sentinel = wakeLockRef.current
      wakeLockRef.current = null
      if (sentinel) {
        sentinel.removeEventListener('release', handleWakeRelease)
        sentinel.release().catch(() => {})
      }
      setWakeActive(false)
    }
  }, [enabled])

  return { position, error, wakeActive }
}
