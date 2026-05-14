import { haversineMeters } from './haversine'

// Defense zone radius for the tag rule (rulebook §6).
// A player is "defending" when they are within this distance of any of their
// own 5 candidate landmarks. Replaced the old longitude-based midline because
// Vila Real's geography (UTAD + historic centre both west, Mateus far east)
// doesn't admit a clean longitude divider between the two team pools.
export const DEFENSE_ZONE_RADIUS_M = 200

interface LatLng {
  lat: number
  lng: number
}

export function isInDefenseZone(
  position: LatLng,
  ownCandidates: LatLng[],
  radiusM = DEFENSE_ZONE_RADIUS_M,
): boolean {
  return ownCandidates.some((lm) => haversineMeters(position, lm) <= radiusM)
}
