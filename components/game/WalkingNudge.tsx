'use client'

// WalkingNudge — a small, non-punitive amber pill that appears over the map
// when useWalkingSpeed reports vehicle-like speed. The game is walking-only;
// this is a gentle reminder, not a penalty. Renders nothing when not speeding.
//
// Styled to match ToastLayer (amber tone, rounded border, backdrop blur) and
// pinned top-center so it overlays the map without blocking taps.

import { cn } from '@/lib/cn'

interface WalkingNudgeProps {
  speeding: boolean
  speedKmh: number | null
  t: (key: string, tokens?: Record<string, string | number>) => string
}

export function WalkingNudge({ speeding, speedKmh, t }: WalkingNudgeProps) {
  if (!speeding) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-2 z-[1250] flex justify-center px-3">
      <div
        className={cn(
          'pointer-events-auto max-w-sm rounded-full border px-4 py-2 text-center text-xs font-medium shadow-lg backdrop-blur',
          'border-amber-500/60 bg-amber-950/90 text-amber-100',
        )}
      >
        <span>{t('walk.nudge')}</span>
        {speedKmh != null && (
          <span className="ml-1.5 text-amber-300/80">
            {t('walk.speed', { speed: Math.round(speedKmh) })}
          </span>
        )}
      </div>
    </div>
  )
}
