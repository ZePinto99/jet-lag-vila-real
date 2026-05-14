// Server-only helpers for reading the seed landmark catalog at
// /data/landmarks.json. Next.js inlines JSON imports at build time
// (resolveJsonModule is on in tsconfig). The catalog is a static list of
// candidate landmarks shared by both teams' pools plus neutral landmarks
// used for tag respawns and challenges.

import seedRaw from '@/data/landmarks.json'
import type { SeedLandmark, TeamSide } from '@/lib/types'

const seed = seedRaw as SeedLandmark[]

export function getAllSeedLandmarks(): SeedLandmark[] {
  return seed
}

export function getSeedLandmarksByPool(
  pool: TeamSide | 'neutral',
): SeedLandmark[] {
  return seed.filter((l) => l.team_pool === pool)
}

export function getSeedLandmarkByRef(ref: string): SeedLandmark | undefined {
  return seed.find((l) => l.id === ref)
}
