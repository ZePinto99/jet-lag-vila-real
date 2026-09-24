'use client'

// Non-interactive map of one team's candidate pool, for the guide's "where you
// play" section. The point is to show the real geography: how far apart the
// candidates actually are, and how their 200 m defense circles overlap on the
// streets of Vila Real. A schematic could not teach that honestly.
//
// A separate component from SetupMap rather than new props on it: SetupMap takes
// selection state, a selected ref and a click handler, all of which the guide
// has none of. Making those optional would mean changing live gameplay code to
// serve a docs page. The overlap is ~15 lines of marker styling, and the two
// will diverge — this one draws the defense-zone circles, which setup must not.
//
// MUST be dynamic-imported with ssr:false — Leaflet touches `window` on import.

import 'leaflet/dist/leaflet.css'
import { Circle, CircleMarker, MapContainer, Tooltip } from 'react-leaflet'
import { LibertyBasemap } from '@/components/map/LibertyBasemap'
import { getSeedLandmarksByPool } from '@/lib/landmarks'
import { DEFENSE_ZONE_RADIUS_M } from '@/lib/geo/zones'
import { DIAGRAM_COLORS } from './diagramTokens'
import type { TeamSide } from '@/lib/types'

function GuidePoolMap({
  side,
  homeRef,
  homeLabel,
}: {
  side: TeamSide
  /** The team's home-base landmark, drawn slightly larger. */
  homeRef: string
  /** Translated word for "home base", shown on the home marker. */
  homeLabel: string
}) {
  // getSeedLandmarksByPool filters BY pool, so the five retired landmarks can
  // never appear here. Never swap this for getAllSeedLandmarks().
  const pool = getSeedLandmarksByPool(side)
  const color = DIAGRAM_COLORS[side]
  const bounds = pool.map((seed) => [seed.lat, seed.lng] as [number, number])

  return (
    <div className="h-64 w-full overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [30, 30], maxZoom: 15 }}
        scrollWheelZoom={false}
        dragging={false}
        doubleClickZoom={false}
        zoomControl={false}
        keyboard={false}
        touchZoom={false}
        className="h-full w-full"
        style={{ background: '#0a0a0a' }}
      >
        <LibertyBasemap />

        {/* The defense-zone circles, which are the reason this is a real map:
            you can see them overlap across actual streets. */}
        {pool.map((seed) => (
          <Circle
            key={`zone-${seed.id}`}
            center={[seed.lat, seed.lng]}
            radius={DEFENSE_ZONE_RADIUS_M}
            pathOptions={{
              color,
              opacity: 0.45,
              weight: 1,
              fillColor: color,
              fillOpacity: 0.08,
            }}
          />
        ))}

        {pool.map((seed) => {
          const isHome = seed.id === homeRef
          return (
            <CircleMarker
              key={seed.id}
              center={[seed.lat, seed.lng]}
              radius={isHome ? 8 : 6}
              pathOptions={{
                color: isHome ? '#fafafa' : '#d4d4d8',
                fillColor: color,
                fillOpacity: 1,
                weight: isHome ? 3 : 2,
              }}
            >
              {isHome && (
                <Tooltip permanent direction="top" offset={[0, -6]} className="map-label">
                  {homeLabel}
                </Tooltip>
              )}
            </CircleMarker>
          )
        })}
      </MapContainer>
    </div>
  )
}

export default GuidePoolMap
