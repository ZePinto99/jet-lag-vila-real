'use client'

// BoundaryNudge — out-of-bounds warning pill (RULEBOOK §12.1).
//
// §12 makes the app responsible for "out-of-bounds warnings". Before this, the
// 1.5 km play disk was only drawn on the map (a grey overlay), so a player who
// walked out got no signal at all — and on a phone in a pocket, mid-chase, the
// map is exactly what nobody is looking at.
//
// Two states, deliberately non-punitive (§12's trust-over-enforcement stance,
// and GPS alone cannot tell "left the play area" from "standing under a tall
// building at the edge"):
//   near_edge — amber, "approaching the edge", with metres remaining
//   outside   — red, "outside the play area", with metres to walk back
//
// Mirrors WalkingNudge's placement and styling so the two never fight for the
// same spot: WalkingNudge sits at top-2, this sits just below it.

import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n/context'
import type { PlayAreaState, PlayAreaStatus } from '@/lib/geo/playArea'

interface BoundaryNudgeProps {
  state: PlayAreaState | null
  /** Safe point just inside the legal disk, used for walking directions. */
  returnTarget?: { lat: number; lng: number } | null
}

function directionsBackUrl(target: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=walking`
}

function displayDistance(metres: number): number {
  if (metres <= 0) return 0
  if (metres < 10) return Math.max(1, Math.round(metres))
  return Math.round(metres / 10) * 10
}

export function BoundaryNudge({ state, returnTarget = null }: BoundaryNudgeProps) {
  const t = useT()
  const status: PlayAreaStatus | 'unavailable' = state?.status ?? 'unavailable'
  const previousStatusRef = useRef<PlayAreaStatus | 'unavailable'>('unavailable')
  const [announcement, setAnnouncement] = useState('')

  // Keep the live region mounted and change its content only when the status
  // changes. This announces the transition reliably without repeating a
  // distance every time GPS moves by a few metres.
  useEffect(() => {
    const previousStatus = previousStatusRef.current
    if (status === previousStatus) return

    if (status === 'outside') {
      setAnnouncement(t('bounds.outside_announcement'))
    } else if (status === 'near_edge') {
      setAnnouncement(t('bounds.near_edge_announcement'))
    } else if (
      status === 'inside' &&
      (previousStatus === 'outside' || previousStatus === 'near_edge')
    ) {
      setAnnouncement(t('bounds.returned_announcement'))
    } else {
      setAnnouncement('')
    }
    previousStatusRef.current = status
  }, [status, t])

  const outside = state?.status === 'outside'

  return (
    <>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
      {state && state.status !== 'inside' && (
        <div className="pointer-events-none fixed inset-x-0 top-14 z-[1250] flex justify-center px-3">
          <div
            data-boundary-status={state.status}
            className={cn(
              'pointer-events-auto max-w-sm rounded-full border px-4 py-2 text-center text-xs font-medium shadow-lg backdrop-blur',
              outside
                ? 'border-red-500/60 bg-red-950/90 text-red-100'
                : 'border-amber-500/60 bg-amber-950/90 text-amber-100',
            )}
          >
            <span>
              {outside
                ? t('bounds.outside', { m: displayDistance(state.overshootM) })
                : t('bounds.near_edge', { m: displayDistance(state.marginM) })}
            </span>
            {outside && returnTarget && (
              <a
                href={directionsBackUrl(returnTarget)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('bounds.directions_back')}
                className="ml-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-red-300/40 bg-red-900/70 px-3 py-2 font-semibold text-white underline-offset-2 hover:underline"
              >
                {t('bounds.directions_back')} ↗
              </a>
            )}
          </div>
        </div>
      )}
    </>
  )
}
