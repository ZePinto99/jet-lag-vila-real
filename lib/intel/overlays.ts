// Map overlays derived from intel cards + the always-on out-of-play boundary.
//
// Each overlay is a polygon with optional holes. The map renders them as
// semi-transparent dark fills, so the visual effect is "everything that's
// covered is ruled out / out of bounds".
//
// Intel that has a clean geographic implication generates an overlay:
//   - intel.north-south: half-plane on the wrong side of lat 41.295
//   - intel.east-west:   half-plane on the wrong side of caller's home lng
//   - intel.hot-cold:    annulus complement (outer ring + inner disk)
//
// Intel that doesn't (eliminate-one/-two, decoy-reveal, surroundings,
// direction, landmark-type) is handled by marker dimming in GameMap.

import type { Card, IntelAnswer } from '@/lib/types'

// Vila Real "action centre" and play-area radius. The out-of-play overlay
// is the world MINUS this disk. 2.5 km comfortably covers every seed
// landmark (the farthest is Mercado Municipal at ~1.9 km from this centre).
export const PLAY_AREA_CENTRE = { lat: 41.295, lng: -7.726 }
export const PLAY_AREA_RADIUS_M = 2500

// Used for I1 N/S half-plane split.
const CITY_CENTRE_LAT = 41.295

// World-sized outer ring for "everywhere" polygons. The actual map view will
// only show a tiny corner of this; we just need it bigger than any sane
// zoom-out so the gray fills the whole viewport.
const WORLD_RING: Array<[number, number]> = [
  [-89, -180],
  [-89, 180],
  [89, 180],
  [89, -180],
]

const EARTH_M = 6_371_000

function circleToRing(
  centre: { lat: number; lng: number },
  radiusM: number,
  numPoints = 64,
): Array<[number, number]> {
  const ring: Array<[number, number]> = []
  const latRad = (centre.lat * Math.PI) / 180
  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * 2 * Math.PI
    const dLat = (radiusM / EARTH_M) * (180 / Math.PI) * Math.cos(angle)
    const dLng =
      ((radiusM / EARTH_M) * (180 / Math.PI) * Math.sin(angle)) /
      Math.cos(latRad)
    ring.push([centre.lat + dLat, centre.lng + dLng])
  }
  // Close the ring explicitly so Leaflet renders a clean polygon.
  ring.push(ring[0])
  return ring
}

export interface MapOverlay {
  /** First element is the outer ring; remaining elements are holes. */
  rings: Array<Array<[number, number]>>
  /** Human-readable note (for debugging / accessibility / tooltips). */
  reason: string
}

export function getOutOfBoundsOverlay(): MapOverlay {
  const playDisk = circleToRing(PLAY_AREA_CENTRE, PLAY_AREA_RADIUS_M, 96)
  return {
    rings: [WORLD_RING, playDisk],
    reason: 'Out of play area',
  }
}

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

export function getIntelOverlays(
  intelCards: Card[],
  myTeamHomeLng: number | null,
): MapOverlay[] {
  const overlays: MapOverlay[] = []
  for (const card of intelCards) {
    if (card.kind !== 'intel') continue
    if (card.state !== 'in_hand') continue
    const payload = card.payload as IntelAnswer

    switch (payload.intel_ref) {
      case 'intel.north-south': {
        // Gray the WRONG half. Real is on `direction` side.
        const ring: Array<[number, number]> =
          payload.direction === 'north'
            ? [
                [-89, -180],
                [-89, 180],
                [CITY_CENTRE_LAT, 180],
                [CITY_CENTRE_LAT, -180],
              ]
            : [
                [CITY_CENTRE_LAT, -180],
                [CITY_CENTRE_LAT, 180],
                [89, 180],
                [89, -180],
              ]
        overlays.push({
          rings: [ring],
          reason: `Ruled out: not ${payload.direction} of city centre`,
        })
        break
      }
      case 'intel.east-west': {
        if (myTeamHomeLng == null) break
        const lng = myTeamHomeLng
        const ring: Array<[number, number]> =
          payload.direction === 'east'
            ? [
                [-89, -180],
                [-89, lng],
                [89, lng],
                [89, -180],
              ]
            : [
                [-89, lng],
                [-89, 180],
                [89, 180],
                [89, lng],
              ]
        overlays.push({
          rings: [ring],
          reason: `Ruled out: not ${payload.direction} of home base`,
        })
        break
      }
      case 'intel.hot-cold': {
        const [minD, maxD] = bucketRange(payload.bucket)
        // Outside the max radius: ruled out.
        if (maxD !== Infinity) {
          const hole = circleToRing(payload.buy_position, maxD)
          overlays.push({
            rings: [WORLD_RING, hole],
            reason: `Ruled out: > ${maxD} m from buy position`,
          })
        }
        // Inside the min radius: also ruled out (filled disk).
        if (minD > 0) {
          const disk = circleToRing(payload.buy_position, minD)
          overlays.push({
            rings: [disk],
            reason: `Ruled out: < ${minD} m from buy position`,
          })
        }
        break
      }
      default:
        // No geographic overlay for the other intel types.
        break
    }
  }
  return overlays
}
