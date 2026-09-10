// Map overlays derived from intel cards + the always-on out-of-play boundary.
//
// Each overlay is a polygon with optional holes. The map renders them as
// semi-transparent dark fills, so the visual effect is "everything that's
// covered is ruled out / out of bounds".
//
// Intel that has a clean geographic implication generates an overlay:
//   - intel.north-south: half-plane on the wrong side of the persisted
//                         defending candidate-pool pivot (legacy fallback only
//                         uses the fixed city latitude)
//   - intel.east-west:   half-plane on the wrong side of caller's home lng
//   - intel.hot-cold:    annulus complement (outer ring + inner disk)
//   - intel.direction:   a soft highlight over the matching 90-degree sector
//
// Intel that doesn't (eliminate-one/-two, decoy-reveal, surroundings,
// landmark-type) is handled by marker dimming in GameMap. Direction is kept as
// a non-eliminating visual hint so it cannot identify a sparse candidate pool.

import type { Card, IntelAnswer } from '@/lib/types'
import {
  CITY_MIDLINE_LAT,
  PLAY_AREA_CENTRE,
  PLAY_AREA_RADIUS_M,
} from '@/lib/geo/playArea'

export { PLAY_AREA_CENTRE, PLAY_AREA_RADIUS_M } from '@/lib/geo/playArea'

// Vila Real "action centre" and play-area radius. The out-of-play overlay is
// the world MINUS this disk. Centred on Avenida Carvalho Araújo after the
// Mateus-free map redesign (PLAYTEST_TRIAGE P3-1); 1.5 km comfortably covers
// every remaining seed landmark (the farthest is Parque Florestal at ~1.18 km
// from this centre).
// Lat/lng bounding box of the play disk, for framing the map on Vila Real
// (playtest item C9). Used both for the map's initial fit and the
// "Fit Vila Real" control, so the two never drift apart again.
export function getPlayAreaBounds(): [[number, number], [number, number]] {
  const c = PLAY_AREA_CENTRE
  const latPad = PLAY_AREA_RADIUS_M / 111_320
  const lngPad =
    PLAY_AREA_RADIUS_M / (111_320 * Math.cos((c.lat * Math.PI) / 180))
  return [
    [c.lat - latPad, c.lng - lngPad],
    [c.lat + latPad, c.lng + lngPad],
  ]
}

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

const COMPASS_BEARING: Record<
  'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW',
  number
> = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315,
}

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

function pointAtBearing(
  centre: { lat: number; lng: number },
  radiusM: number,
  bearingDegrees: number,
): [number, number] {
  const angle = (bearingDegrees * Math.PI) / 180
  const latRad = (centre.lat * Math.PI) / 180
  const dLat = (radiusM / EARTH_M) * (180 / Math.PI) * Math.cos(angle)
  const dLng =
    ((radiusM / EARTH_M) * (180 / Math.PI) * Math.sin(angle)) /
    Math.cos(latRad)
  return [centre.lat + dLat, centre.lng + dLng]
}

function directionSectorRing(
  bearing: keyof typeof COMPASS_BEARING,
): Array<[number, number]> {
  const centre: [number, number] = [PLAY_AREA_CENTRE.lat, PLAY_AREA_CENTRE.lng]
  const centreBearing = COMPASS_BEARING[bearing]
  const radiusM = PLAY_AREA_RADIUS_M * 1.1
  const arc: Array<[number, number]> = []
  const steps = 16
  for (let index = 0; index <= steps; index += 1) {
    const bearingDegrees = centreBearing - 45 + (90 * index) / steps
    arc.push(pointAtBearing(PLAY_AREA_CENTRE, radiusM, bearingDegrees))
  }
  return [centre, ...arc, centre]
}

export interface MapOverlay {
  /** First element is the outer ring; remaining elements are holes. */
  rings: Array<Array<[number, number]>>
  /** Human-readable note (for debugging / accessibility / tooltips). */
  reason: string
  /** Optional styling for non-eliminating hints such as Direction. */
  fillColor?: string
  fillOpacity?: number
  strokeColor?: string
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
        const pivotLat = payload.pivot_lat ?? CITY_MIDLINE_LAT
        // Gray the WRONG half. Real is on `direction` side.
        const ring: Array<[number, number]> =
          payload.direction === 'north'
            ? [
                [-89, -180],
                [-89, 180],
                [pivotLat, 180],
                [pivotLat, -180],
              ]
            : [
                [pivotLat, -180],
                [pivotLat, 180],
                [89, 180],
                [89, -180],
              ]
        overlays.push({
          rings: [ring],
          reason: `Ruled out: not ${payload.direction} of enemy candidate-pool midline`,
        })
        break
      }
      case 'intel.east-west': {
        const lng = payload.pivot_lng ?? myTeamHomeLng
        if (lng == null) break
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
      case 'intel.direction': {
        overlays.push({
          rings: [directionSectorRing(payload.bearing)],
          reason: `Hint: ${payload.bearing} quadrant from city centre`,
          fillColor: '#fbbf24',
          fillOpacity: 0.12,
          strokeColor: '#f59e0b',
        })
        break
      }
      default:
        // No geographic overlay for the other intel types.
        break
    }
  }
  return overlays
}
