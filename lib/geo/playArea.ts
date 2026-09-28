/** Canonical centre of the current Mateus-free Vila Real play disk. */
import { haversineMeters } from './haversine'

export const PLAY_AREA_CENTRE = { lat: 41.2955, lng: -7.7461 } as const

/** Stable city N/S split used by I1 (intentionally just south of the centre). */
export const CITY_MIDLINE_LAT = 41.295

export const PLAY_AREA_RADIUS_M = 1500

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
