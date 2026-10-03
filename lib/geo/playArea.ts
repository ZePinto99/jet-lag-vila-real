/** Canonical centre of the current Mateus-free Vila Real play disk. */
import { haversineMeters } from './haversine'

export const PLAY_AREA_CENTRE = { lat: 41.2955, lng: -7.7461 } as const

/** Stable city N/S split used by I1 (intentionally just south of the centre). */
export const CITY_MIDLINE_LAT = 41.295

export const PLAY_AREA_RADIUS_M = 1500

/**
 * The camera gets a small recovery belt beyond the actual play disk. A player
 * who crosses the line can still see the nearby streets needed to turn around,
 * while arbitrary panning (or a wildly wrong GPS fix) can never expand the map
 * across the rest of Portugal.
 */
export const PLAY_AREA_NAVIGATION_BUFFER_M = 300
export const PLAY_AREA_NAVIGATION_RADIUS_M =
  PLAY_AREA_RADIUS_M + PLAY_AREA_NAVIGATION_BUFFER_M

/** Keep a clamped player marker comfortably visible inside the opaque edge. */
export const PLAY_AREA_MAP_EDGE_INSET_M = 40

/** Walking directions finish just inside the real play-area boundary. */
export const PLAY_AREA_RETURN_INSET_M = 50

/** Prevent zooming out until unrelated geography fills the viewport. */
export const PLAY_AREA_MAP_MIN_ZOOM = 13.5

/** Above this uncertainty, only a position provably outside remains useful. */
export const PLAY_AREA_MAX_UNCERTAIN_ACCURACY_M = 250

/** Prevent GPS jitter from flipping boundary states on every fix. */
export const PLAY_AREA_STATUS_HYSTERESIS_M = 15
export const PLAY_AREA_ACCURACY_HYSTERESIS_M = 50

/**
 * Distance inside the boundary at which we start warning. Chosen so a walker
 * at ~1.3 m/s gets roughly two minutes of notice before they are actually out,
 * which is enough to turn around without a scramble.
 */
export const PLAY_AREA_WARN_MARGIN_M = 150

export type PlayAreaStatus = 'inside' | 'near_edge' | 'outside'

export interface PlayAreaState {
  status: PlayAreaStatus
  /** Distance from the play-area centre, metres. */
  distanceM: number
  /**
   * Metres still available before crossing the boundary (0 once outside).
   * Negative distance past the edge is reported via `overshootM`.
   */
  marginM: number
  /** Metres beyond the boundary; 0 while inside. */
  overshootM: number
}

export interface MapDisplayPosition {
  lat: number
  lng: number
  /** True when the real GPS point is too close to or beyond the opaque edge. */
  isClamped: boolean
  /** Real distance from the centre, even when the displayed point is clamped. */
  distanceM: number
}

const EARTH_RADIUS_M = 6_371_000

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI
}

/** A bounding box centred on the play disk for Leaflet framing/constraints. */
export function getPlayAreaBounds(
  radiusM: number = PLAY_AREA_RADIUS_M,
  centre: { lat: number; lng: number } = PLAY_AREA_CENTRE,
): [[number, number], [number, number]] {
  const latPad = radiusM / 111_320
  const lngPad = radiusM / (111_320 * Math.cos(toRadians(centre.lat)))
  return [
    [centre.lat - latPad, centre.lng - lngPad],
    [centre.lat + latPad, centre.lng + lngPad],
  ]
}

/** Fixed camera fence; importantly, it never incorporates a player's GPS. */
export function getPlayAreaNavigationBounds(): [[number, number], [number, number]] {
  return getPlayAreaBounds(PLAY_AREA_NAVIGATION_RADIUS_M)
}

/**
 * Follow the great-circle bearing from the centre to `position`, stopping at
 * `radiusM`. This is used only for display/wayfinding; the real GPS coordinate
 * remains untouched for every game rule and API request.
 */
function pointOnRadius(
  position: { lat: number; lng: number },
  radiusM: number,
  centre: { lat: number; lng: number } = PLAY_AREA_CENTRE,
): { lat: number; lng: number } {
  const centreLat = toRadians(centre.lat)
  const positionLat = toRadians(position.lat)
  const deltaLng = toRadians(position.lng - centre.lng)
  const bearing = Math.atan2(
    Math.sin(deltaLng) * Math.cos(positionLat),
    Math.cos(centreLat) * Math.sin(positionLat) -
      Math.sin(centreLat) * Math.cos(positionLat) * Math.cos(deltaLng),
  )
  const angularDistance = radiusM / EARTH_RADIUS_M
  const destinationLat = Math.asin(
    Math.sin(centreLat) * Math.cos(angularDistance) +
      Math.cos(centreLat) * Math.sin(angularDistance) * Math.cos(bearing),
  )
  const destinationLng =
    toRadians(centre.lng) +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(centreLat),
      Math.cos(angularDistance) - Math.sin(centreLat) * Math.sin(destinationLat),
    )

  return {
    lat: toDegrees(destinationLat),
    lng: ((toDegrees(destinationLng) + 540) % 360) - 180,
  }
}

/**
 * Coordinate used by the camera and the local-player marker. Most points in
 * the recovery belt remain exact; the final inset and farther points become
 * an edge indicator so the marker never gets cut in half by the opaque mask.
 */
export function getMapDisplayPosition(
  position: { lat: number; lng: number },
): MapDisplayPosition {
  const distanceM = haversineMeters(position, PLAY_AREA_CENTRE)
  const displayRadiusM = PLAY_AREA_NAVIGATION_RADIUS_M - PLAY_AREA_MAP_EDGE_INSET_M
  if (distanceM <= displayRadiusM) {
    return { ...position, isClamped: false, distanceM }
  }
  return {
    ...pointOnRadius(position, displayRadiusM),
    isClamped: true,
    distanceM,
  }
}

/** Nearest useful walking destination, slightly inside the legal play disk. */
export function getPlayAreaReturnPoint(position: {
  lat: number
  lng: number
}): { lat: number; lng: number } {
  return pointOnRadius(position, PLAY_AREA_RADIUS_M - PLAY_AREA_RETURN_INSET_M)
}

/**
 * Boundary state for a GPS fix, accounting for its reported uncertainty.
 *
 * A fix turns red only when its entire accuracy circle is outside the play
 * disk. If the circle straddles the edge, we show the amber near-edge state.
 * Very imprecise fixes inside/near the disk are ignored rather than crying
 * wolf; a far-away fix is still usable when even its nearest possible point is
 * unquestionably outside.
 */
export function getPlayAreaStateForGps(
  position: { lat: number; lng: number; accuracy: number },
  centre: { lat: number; lng: number } = PLAY_AREA_CENTRE,
  radiusM: number = PLAY_AREA_RADIUS_M,
  previousStatus: PlayAreaStatus | null = null,
): PlayAreaState | null {
  if (
    !Number.isFinite(position.lat) ||
    !Number.isFinite(position.lng) ||
    !Number.isFinite(position.accuracy) ||
    position.accuracy < 0
  ) {
    return null
  }

  const distanceM = haversineMeters(position, centre)
  const nearestPossibleDistanceM = Math.max(0, distanceM - position.accuracy)
  const farthestPossibleDistanceM = distanceM + position.accuracy

  const outsideThresholdM =
    previousStatus === 'outside'
      ? radiusM - PLAY_AREA_STATUS_HYSTERESIS_M
      : previousStatus
        ? radiusM + PLAY_AREA_STATUS_HYSTERESIS_M
        : radiusM

  if (nearestPossibleDistanceM > outsideThresholdM) {
    return {
      status: 'outside',
      distanceM,
      marginM: 0,
      // During the small hysteresis band the nearest possible point may be a
      // few metres inside. Keep the instruction non-zero until re-entry is
      // confident, rather than flashing between red and amber every second.
      overshootM: Math.max(1, nearestPossibleDistanceM - radiusM),
    }
  }

  const maximumUsefulAccuracyM =
    PLAY_AREA_MAX_UNCERTAIN_ACCURACY_M +
    (previousStatus ? PLAY_AREA_ACCURACY_HYSTERESIS_M : 0)
  if (position.accuracy > maximumUsefulAccuracyM) return null

  const conservativeMarginM = Math.max(0, radiusM - farthestPossibleDistanceM)
  const warnThresholdM =
    previousStatus === 'inside'
      ? PLAY_AREA_WARN_MARGIN_M - PLAY_AREA_STATUS_HYSTERESIS_M
      : previousStatus === 'near_edge' || previousStatus === 'outside'
        ? PLAY_AREA_WARN_MARGIN_M + PLAY_AREA_STATUS_HYSTERESIS_M
        : PLAY_AREA_WARN_MARGIN_M
  return {
    status: conservativeMarginM <= warnThresholdM ? 'near_edge' : 'inside',
    distanceM,
    marginM: conservativeMarginM,
    overshootM: 0,
  }
}

/**
 * Out-of-bounds state for one position.
 *
 * RULEBOOK §12.1 makes the app responsible for "out-of-bounds warnings", and
 * §3.1 defines the play area as a ~1.5 km disk. Until now PLAY_AREA_RADIUS_M
 * was only ever used to DRAW the grey overlay (lib/intel/overlays.ts:134), so
 * the warning half of §12.1 was unimplemented — a player could walk out of the
 * play area and the app would say nothing.
 *
 * Deliberately a warning only, never a penalty: §12's closing paragraph sets a
 * trust-over-enforcement stance, and GPS alone cannot distinguish "left the
 * play area" from "standing next to a tall building at the edge". Pure function
 * so it is trivially testable and callable from either side.
 */
export function getPlayAreaState(
  position: { lat: number; lng: number },
  centre: { lat: number; lng: number } = PLAY_AREA_CENTRE,
  radiusM: number = PLAY_AREA_RADIUS_M,
): PlayAreaState {
  const distanceM = haversineMeters(position, centre)
  const marginM = radiusM - distanceM
  if (marginM < 0) {
    return { status: 'outside', distanceM, marginM: 0, overshootM: -marginM }
  }
  return {
    status: marginM <= PLAY_AREA_WARN_MARGIN_M ? 'near_edge' : 'inside',
    distanceM,
    marginM,
    overshootM: 0,
  }
}
