'use client'

// Read-only planning map for the setup phase (PLAYTEST_TRIAGE P3-2). Shows
// every candidate landmark in both team pools (public info before roles are
// assigned) plus neutrals, so teams can plan their picks. No GPS, no actions.
//
// MUST be dynamic-imported with ssr:false — Leaflet touches `window` on import.

import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, CircleMarker, Circle, Tooltip } from 'react-leaflet'
import seedLandmarks from '@/data/landmarks.json'
import {
  PLAY_AREA_CENTRE,
  PLAY_AREA_RADIUS_M,
} from '@/lib/intel/overlays'
import type { SeedLandmark, TeamSide } from '@/lib/types'

const SEED = seedLandmarks as SeedLandmark[]

const TEAM_COLOR: Record<TeamSide, string> = {
  west: '#3b82f6',
  east: '#ec4899',
}
const NEUTRAL_COLOR = '#737373'

function SetupMap({
  mySide,
  myHomeRef,
}: {
  mySide: TeamSide
  myHomeRef: string | null
}) {
  return (
    <div className="h-72 w-full overflow-hidden rounded-xl border border-neutral-800">
      <MapContainer
        center={[PLAY_AREA_CENTRE.lat, PLAY_AREA_CENTRE.lng]}
        zoom={14}
        scrollWheelZoom
        className="h-full w-full"
        style={{ background: '#0a0a0a' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={20}
        />

        {/* Play-area boundary (matches the live out-of-bounds disk). */}
        <Circle
          center={[PLAY_AREA_CENTRE.lat, PLAY_AREA_CENTRE.lng]}
          radius={PLAY_AREA_RADIUS_M}
          pathOptions={{
            color: '#525252',
            weight: 1,
            fill: false,
            dashArray: '4 4',
          }}
        />

        {SEED.map((seed) => {
          const isMine = seed.team_pool === mySide
          const color =
            seed.team_pool === 'neutral'
              ? NEUTRAL_COLOR
              : TEAM_COLOR[seed.team_pool as TeamSide]
          const isHome = seed.id === myHomeRef
          return (
            <CircleMarker
              key={seed.id}
              center={[seed.lat, seed.lng]}
              radius={isHome ? 12 : isMine ? 9 : 7}
              pathOptions={{
                color: '#ffffff',
                fillColor: color,
                fillOpacity: isMine || seed.team_pool === 'neutral' ? 0.9 : 0.45,
                weight: isHome ? 4 : 2,
              }}
            >
              <Tooltip direction="top" offset={[0, -6]} className="map-label">
                {seed.name}
                {isHome ? ' (home)' : ''}
              </Tooltip>
            </CircleMarker>
          )
        })}
      </MapContainer>
    </div>
  )
}

export default SetupMap
