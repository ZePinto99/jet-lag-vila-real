'use client'

// useCurseExpiryPoll — while there is at least one active curse on either
// team, this hook POSTs /api/games/[id]/expire-curses every 20 s. The route
// is idempotent housekeeping: it deletes expired curse rows and emits one
// 'curse_expired' event per row. Any player can poke it.
//
// SSR-safe: setInterval only runs in the browser. The interval is torn down
// when the count drops to 0 or the component unmounts.

import { useEffect } from 'react'
import { apiPost } from '@/lib/api'
import { getDeviceId } from '@/lib/device'
import type {
  ExpireCursesRequest,
  ExpireCursesResponse,
} from '@/lib/types'

const POLL_INTERVAL_MS = 20_000

export function useCurseExpiryPoll(
  gameId: string | null,
  activeCurseCount: number,
): void {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!gameId) return
    if (activeCurseCount <= 0) return

    let cancelled = false

    async function poke() {
      if (cancelled || !gameId) return
      const body: ExpireCursesRequest = { device_id: getDeviceId() }
      try {
        await apiPost<ExpireCursesResponse>(
          `/api/games/${gameId}/expire-curses`,
          body,
        )
      } catch {
        // Swallow errors; this is best-effort housekeeping and will retry
        // on the next tick.
      }
    }

    const id = window.setInterval(poke, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [gameId, activeCurseCount])
}
