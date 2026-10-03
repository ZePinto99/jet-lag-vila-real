'use client'

import { Polygon } from 'react-leaflet'

import { PLAY_AREA_NAVIGATION_RADIUS_M } from '@/lib/geo/playArea'
import { getOutOfBoundsOverlay } from '@/lib/intel/overlays'

// A source-level bounds hint saves unnecessary tile requests, but map tiles
// that cross the edge are still rectangular. This opaque mask is the visible
// hard stop shared by every game map.
const NAVIGATION_BARRIER = getOutOfBoundsOverlay(
  PLAY_AREA_NAVIGATION_RADIUS_M,
  'Map navigation barrier',
)

export function MapNavigationBarrier() {
  return (
    <Polygon
      positions={NAVIGATION_BARRIER.rings}
      pathOptions={{
        fillColor: '#000000',
        fillOpacity: 1,
        stroke: false,
        interactive: false,
      }}
    />
  )
}
