'use client'

// Persists the current game code to localStorage so the landing page can offer
// "Rejoin last game" (PLAYTEST_TRIAGE P3-3). Renders nothing. Covers every way
// into a game — create, join, deep-link, refresh — by living on the game page.

import { useEffect } from 'react'
import { setLastGameCode } from '@/lib/device'

export function RememberGameCode({ code }: { code: string }) {
  useEffect(() => {
    setLastGameCode(code)
  }, [code])
  return null
}
