// Compute the set of enemy candidate landmark refs that have been "narrowed
// out" by the team's intel cards — i.e. refs that the team now knows are NOT
// the real flag. The map can dim these out when the player toggles the
// "intel filter" on.
//
// Inputs are read from the live state: my team's intel cards (any state — we
// only consider `in_hand`), the enemy team's visible landmarks (refs + coords
// only), my team's home base lng for I2, and the seed catalog for I9's kind
// lookup.

import { haversineMeters } from '@/lib/geo/haversine'
import type {
  Card,
  EnemyLandmark,
  IntelAnswer,
  SeedLandmark,
} from '@/lib/types'

const CITY_CENTRE_LAT = 41.295
const CITY_CENTRE_LNG = -7.726

function bucketRange(
  bucket: 'under_200m' | 'under_500m' | 'under_1km' | 'over_1km',
): [number, number] {
  switch (bucket) {
    case 'under_200m':
      return [0, 200]
    case 'under_500m':
      return [200, 500]
    case 'under_1km':
      return [500, 1000]
    case 'over_1km':
      return [1000, Infinity]
  }
}

function bearingFromCityCentre(p: { lat: number; lng: number }): string {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const lat1 = toRad(CITY_CENTRE_LAT)
  const lat2 = toRad(p.lat)
  const dLng = toRad(p.lng - CITY_CENTRE_LNG)
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
  if (bearing < 22.5 || bearing >= 337.5) return 'N'
  if (bearing < 67.5) return 'NE'
  if (bearing < 112.5) return 'E'
  if (bearing < 157.5) return 'SE'
  if (bearing < 202.5) return 'S'
  if (bearing < 247.5) return 'SW'
  if (bearing < 292.5) return 'W'
  return 'NW'
}

export interface NarrowingInput {
  intelCards: Card[]
  enemyLandmarks: EnemyLandmark[]
  myTeamHomeLng: number | null
  seedLookup: (ref: string) => SeedLandmark | null
}

/**
 * Returns the set of enemy landmark refs that are KNOWN NOT to be the real
 * flag, derived from in_hand intel cards. The map can render these in muted
 * grey when the "intel filter" toggle is on.
 *
 * Excluded by design:
 *  - intel.surroundings (free-form text; no geographic narrowing)
 *  - Cards in state !== 'in_hand' (they've already been used/expired)
 */
export function computeNarrowedRefs(input: NarrowingInput): Set<string> {
  const { intelCards, enemyLandmarks, myTeamHomeLng, seedLookup } = input
  const narrowed = new Set<string>()

  for (const card of intelCards) {
    if (card.kind !== 'intel') continue
    if (card.state !== 'in_hand') continue
    const payload = card.payload as IntelAnswer

    switch (payload.intel_ref) {
      case 'intel.north-south': {
        for (const e of enemyLandmarks) {
          const isNorth = e.lat > CITY_CENTRE_LAT
          if ((isNorth ? 'north' : 'south') !== payload.direction) {
            narrowed.add(e.ref)
          }
        }
        break
      }
      case 'intel.east-west': {
        if (myTeamHomeLng == null) break
        for (const e of enemyLandmarks) {
          const isEast = e.lng > myTeamHomeLng
          if ((isEast ? 'east' : 'west') !== payload.direction) {
            narrowed.add(e.ref)
          }
        }
        break
      }
      case 'intel.eliminate-one': {
        narrowed.add(payload.not_real.ref)
        break
      }
      case 'intel.eliminate-two': {
        for (const item of payload.not_real) narrowed.add(item.ref)
        break
      }
      case 'intel.decoy-reveal': {
        // Decoy is confirmed not real.
        narrowed.add(payload.decoy.ref)
        break
      }
      case 'intel.hot-cold': {
        const [minD, maxD] = bucketRange(payload.bucket)
        for (const e of enemyLandmarks) {
          const d = haversineMeters(payload.buy_position, e)
          if (d < minD || d >= maxD) narrowed.add(e.ref)
        }
        break
      }
      case 'intel.surroundings':
        // No mechanical narrowing.
        break
      case 'intel.direction': {
        for (const e of enemyLandmarks) {
          if (bearingFromCityCentre(e) !== payload.bearing) {
            narrowed.add(e.ref)
          }
        }
        break
      }
      case 'intel.landmark-type': {
        for (const e of enemyLandmarks) {
          const seed = seedLookup(e.ref)
          if (!seed || seed.kind !== payload.category) {
            narrowed.add(e.ref)
          }
        }
        break
      }
    }
  }

  return narrowed
}
