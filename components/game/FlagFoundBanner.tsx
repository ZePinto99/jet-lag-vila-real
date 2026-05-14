'use client'

// FlagFoundBanner — shown to every player EXCEPT the flag carrier while
// game.status === 'flag_found'. Two variants:
//  - Team-mate of the carrier: cheer them on.
//  - Enemy of the carrier: intercept warning, includes the enemy home base
//    name so the team knows where to set up the ambush.

import seedLandmarks from '@/data/landmarks.json'
import { cn } from '@/lib/cn'
import type { Player, SeedLandmark, Team } from '@/lib/types'

const SEED = seedLandmarks as SeedLandmark[]

interface FlagFoundBannerProps {
  carrier: Player
  carrierTeam: Team | null
  myTeam: Team
}

function homeBaseName(team: Team | null): string {
  if (!team || !team.home_landmark_id) return 'their home base'
  const seed = SEED.find((s) => s.id === team.home_landmark_id)
  return seed?.name ?? 'their home base'
}

export function FlagFoundBanner({
  carrier,
  carrierTeam,
  myTeam,
}: FlagFoundBannerProps) {
  const carrierIsMine = carrierTeam ? carrierTeam.id === myTeam.id : false
  const enemyHomeLabel = homeBaseName(carrierTeam)

  return (
    <div
      className={cn(
        'border-b px-4 py-2 text-center text-sm font-medium',
        carrierIsMine
          ? 'border-emerald-700 bg-emerald-900/40 text-emerald-100'
          : 'border-red-700 bg-red-900/40 text-red-100',
      )}
    >
      {carrierIsMine
        ? `Your team found the flag! ${carrier.display_name} is running to home base.`
        : `Enemy found your flag! ${carrier.display_name} is running back to ${enemyHomeLabel}. Intercept them!`}
    </div>
  )
}
