import { haversineMeters } from '@/lib/geo/haversine'
import { getSeedLandmarksByPool } from '@/lib/landmarks'
import type { SeedLandmark } from '@/lib/types'

export function nearestNeutralLandmark(pos: {
  lat: number
  lng: number
}): { landmark: SeedLandmark; distance_m: number } | null {
  let best: { landmark: SeedLandmark; distance_m: number } | null = null
  for (const landmark of getSeedLandmarksByPool('neutral')) {
    const distance_m = haversineMeters(pos, landmark)
    if (!best || distance_m < best.distance_m) best = { landmark, distance_m }
  }
  return best
}
