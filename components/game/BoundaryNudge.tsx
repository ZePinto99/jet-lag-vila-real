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

import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n/context'
import type { PlayAreaState } from '@/lib/geo/playArea'

interface BoundaryNudgeProps {
  state: PlayAreaState | null
}

export function BoundaryNudge({ state }: BoundaryNudgeProps) {
  const t = useT()
  if (!state || state.status === 'inside') return null
  const outside = state.status === 'outside'

  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-[1250] flex justify-center px-3">
      <div
        className={cn(
          'pointer-events-auto max-w-sm rounded-full border px-4 py-2 text-center text-xs font-medium shadow-lg backdrop-blur',
          outside
            ? 'border-red-500/60 bg-red-950/90 text-red-100'
            : 'border-amber-500/60 bg-amber-950/90 text-amber-100',
        )}
        role="status"
        aria-live="polite"
      >
        <span>
          {outside
            ? t('bounds.outside', { m: Math.round(state.overshootM) })
            : t('bounds.near_edge', { m: Math.round(state.marginM) })}
        </span>
      </div>
    </div>
  )
}
