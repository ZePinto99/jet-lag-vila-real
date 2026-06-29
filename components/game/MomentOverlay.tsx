'use client'

// MomentOverlay — the animated "big moment" popup: a centred card that pops in
// with concentric rings radiating behind it. Driven by useGameMoments; shows
// one moment at a time and auto-fades (see .moment-* keyframes in globals.css).
// Tap to dismiss early.

import { useEffect } from 'react'
import { cn } from '@/lib/cn'
import { playCue } from '@/lib/sound'
import type { GameMoment, MomentTone } from '@/lib/hooks/useGameMoments'

const TONE: Record<
  MomentTone,
  { ring: string; card: string; title: string }
> = {
  good: {
    ring: 'border-emerald-400/70',
    card: 'border-emerald-400/60 bg-emerald-950/95 text-emerald-50',
    title: 'text-emerald-200',
  },
  bad: {
    ring: 'border-red-400/70',
    card: 'border-red-400/60 bg-red-950/95 text-red-50',
    title: 'text-red-200',
  },
}

export function MomentOverlay({
  moment,
  onDismiss,
}: {
  moment: GameMoment | null
  onDismiss: (id: string) => void
}) {
  // Fire the sound + haptic cue once per moment as it appears. Keyed on the
  // moment id so it triggers exactly when a new moment is shown.
  useEffect(() => {
    if (moment) playCue(moment.cue)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moment?.id])

  if (!moment) return null
  const c = TONE[moment.tone]
  return (
    <div
      key={moment.id}
      className="moment-life pointer-events-none fixed inset-0 z-[1300] flex items-center justify-center px-6"
    >
      {/* radiating rings behind the card */}
      <div className="absolute left-1/2 top-1/2 h-0 w-0">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn(
              'moment-ring absolute left-1/2 top-1/2 h-32 w-32 rounded-full border-2',
              c.ring,
            )}
            style={{ animationDelay: `${i * 240}ms` }}
          />
        ))}
      </div>

      {/* the card */}
      <button
        type="button"
        onClick={() => onDismiss(moment.id)}
        className={cn(
          'moment-card pointer-events-auto relative flex max-w-xs flex-col items-center gap-1 rounded-2xl border px-6 py-5 text-center shadow-2xl backdrop-blur',
          c.card,
        )}
      >
        <span className="moment-icon text-4xl">{moment.icon}</span>
        <span className={cn('text-lg font-extrabold tracking-wide', c.title)}>
          {moment.title}
        </span>
        <span className="text-sm opacity-90">{moment.subtitle}</span>
      </button>
    </div>
  )
}
