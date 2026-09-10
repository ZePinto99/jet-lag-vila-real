import { haversineMeters } from './haversine'

// Defense zone radius for the tag rule (rulebook §6).
// A player is "defending" when they are within this distance of any of their
// own 5 candidate landmarks. Replaced the old longitude-based midline because
// Vila Real's compact ridge-and-valley geography does not admit a clean
// longitude divider between the two team pools.
export const DEFENSE_ZONE_RADIUS_M = 200

// Overlapping 200 m unions must never make an attacker immune while standing
// on the opponent's objective. Within 50 m of a defending candidate, an enemy
// counts as a raider even if their own team's defense union overlaps there.
export const ENEMY_CANDIDATE_RAID_RADIUS_M = 50

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

export function isRaiderForDefendingTeam(
  position: LatLng,
  raiderOwnCandidates: LatLng[],
  defendingCandidates: LatLng[],
): boolean {
  return (
    !isInDefenseZone(position, raiderOwnCandidates) ||
    isInDefenseZone(
      position,
      defendingCandidates,
      ENEMY_CANDIDATE_RAID_RADIUS_M,
    )
  )
}
