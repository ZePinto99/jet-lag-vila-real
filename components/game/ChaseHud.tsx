'use client'

// ChaseHud — a bold, persistent HUD strip rendered under the live header while
// the game is in the flag_found chase. It makes the climax tense for BOTH
// teams by showing the live distances derived in useChaseStatus:
//   - Carrier team (emerald/green): metres to home + nearest hunter distance.
//   - Defenders   (red, urgent):    metres the carrier is from winning.
// The strip pulses subtly when the carrier is < 60 m from home (about to win).

import { cn } from '@/lib/cn'
import type { ChaseStatus } from '@/lib/hooks/useChaseStatus'

interface ChaseHudProps {
  status: ChaseStatus
  iAmOnCarrierTeam: boolean
  t: (key: string, tokens?: Record<string, string | number>) => string
}

export function ChaseHud({ status, iAmOnCarrierTeam, t }: ChaseHudProps) {
  if (status.metersToHome == null) return null

  const home = Math.round(status.metersToHome)
  const hunter =
    status.nearestHunterMeters == null
      ? '—'
      : Math.round(status.nearestHunterMeters)

  const nearWin = status.metersToHome < 60

  return (
    <div
      className={cn(
        'w-full border-b px-4 py-2 text-center text-base font-bold tracking-tight',
        iAmOnCarrierTeam
          ? 'border-emerald-600 bg-emerald-900/50 text-emerald-100'
          : 'border-red-600 bg-red-900/50 text-red-100',
        nearWin && 'animate-pulse',
      )}
    >
      {iAmOnCarrierTeam
        ? t('chase.carrier', { home, hunter })
        : t('chase.defender', { home })}
    </div>
  )
}
