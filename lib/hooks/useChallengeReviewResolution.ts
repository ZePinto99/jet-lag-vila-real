'use client'

import { useEffect } from 'react'
import { apiPost } from '@/lib/api'
import { getDeviceId } from '@/lib/device'

const POLL_INTERVAL_MS = 15_000

/** Best-effort housekeeping for the 120-second challenge review deadline. */
export function useChallengeReviewResolution(
  gameId: string | null,
  active: boolean,
): void {
  useEffect(() => {
    if (typeof window === 'undefined' || !gameId || !active) return
    let cancelled = false

    const resolve = async () => {
      if (cancelled || !gameId) return
      try {
        await apiPost(`/api/games/${gameId}/resolve-challenge-reviews`, {
          device_id: getDeviceId(),
        })
      } catch {
        // Another client may win the race; the next poll/realtime snapshot
        // reconciles the durable result.
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void resolve()
    }

    void resolve()
    const timer = window.setInterval(resolve, POLL_INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [active, gameId])
}
