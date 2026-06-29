'use client'

// useTimeTick — while the game is in play, this hook POSTs
// /api/games/[id]/time-tick once on mount and then every 30 s. The route is
// idempotent housekeeping: it credits the time bonus (+20, or +40 on a Power
// Hour) to BOTH teams for any 30-min interval that has elapsed but not yet
// been credited. Any player can poke it.
//
// Mirrors useCurseExpiryPoll. SSR-safe: setInterval only runs in the browser.
// Errors are swallowed — this is best-effort and retries on the next tick.

import { useEffect } from 'react'
import { apiPost } from '@/lib/api'
import { getDeviceId } from '@/lib/device'
import type { TimeTickResponse } from '@/app/api/games/[id]/time-tick/route'

const POLL_INTERVAL_MS = 30_000

export function useTimeTick(gameId: string | null, active: boolean): void {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!gameId) return
    if (!active) return

    let cancelled = false

    async function poke() {
      if (cancelled || !gameId) return
      const body = { device_id: getDeviceId() }
      try {
        await apiPost<TimeTickResponse>(
          `/api/games/${gameId}/time-tick`,
          body,
        )
      } catch {
        // Swallow errors; best-effort housekeeping, retries next tick.
      }
    }

    // Fire once on mount so a freshly-loaded client immediately reconciles any
    // intervals that elapsed while nobody was polling.
    void poke()

    const id = window.setInterval(poke, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [gameId, active])
}
