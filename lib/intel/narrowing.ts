// Compute the set of enemy candidate landmark refs that have been "narrowed
// out" by the team's intel cards — i.e. refs that the team now knows are NOT
// the real flag. The map can dim these out when the player toggles the
// "intel filter" on.
//
// Inputs are read from the live state: my team's intel cards (any state — we
// only consider `in_hand`), the enemy team's visible landmarks (refs + coords
// only), and my team's home-base longitude for legacy I2 payloads. The
// seed lookup remains in the shared call contract for compatibility with map
// consumers that predate the removal of I9.

import { haversineMeters } from '@/lib/geo/haversine'
import { CITY_MIDLINE_LAT } from '@/lib/geo/playArea'
import type {
  Card,
  EnemyLandmark,
  IntelAnswer,
  SeedLandmark,
} from '@/lib/types'

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
        const pivotLat = payload.pivot_lat ?? CITY_MIDLINE_LAT
        for (const e of enemyLandmarks) {
          const isNorth = e.lat > pivotLat
          if ((isNorth ? 'north' : 'south') !== payload.direction) {
            narrowed.add(e.ref)
          }
        }
        break
      }
      case 'intel.east-west': {
        const pivotLng = payload.pivot_lng ?? myTeamHomeLng
        if (pivotLng == null) break
        for (const e of enemyLandmarks) {
          const isEast = e.lng > pivotLng
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
        // Direction is intentionally a soft map hint. Automatically dimming
        // every candidate outside the sector made a 50-coin card reveal the
        // answer outright in sparse pools. The map highlights the broad
        // quadrant while leaving candidate interpretation to the players.
        break
      }
    }
  }

  return narrowed
}
