'use client'

// Focused planning map for flag setup. Only the current team's assignable
// pool is rendered: enemy and neutral landmarks are irrelevant to this step
// and made the old overview needlessly dense. Markers use compact numbers;
// the parent renders the selected landmark name and explicit role controls.
//
// MUST be dynamic-imported with ssr:false — Leaflet touches `window` on import.

import 'leaflet/dist/leaflet.css'
import { CircleMarker, MapContainer, Tooltip } from 'react-leaflet'
import seedLandmarks from '@/data/landmarks.json'
import type { FlagRole, SeedLandmark, TeamSide } from '@/lib/types'
import { LibertyBasemap } from '@/components/map/LibertyBasemap'
import { MapNavigationBarrier } from '@/components/map/MapNavigationBarrier'
import {
  getPlayAreaNavigationBounds,
  PLAY_AREA_MAP_MIN_ZOOM,
} from '@/lib/geo/playArea'

const SEED = seedLandmarks as SeedLandmark[]
const SEED_BY_ID = new Map(SEED.map((seed) => [seed.id, seed]))

const TEAM_COLOR: Record<TeamSide, string> = {
  west: '#3b82f6',
  east: '#ec4899',
}

const ROLE_COLOR: Record<FlagRole, string> = {
  real: '#10b981',
  decoy: '#f59e0b',
  empty: '#737373',
}

function SetupMap({
  mySide,
  myHomeRef,
  selections,
  poolIds,
  selectedRef,
  onSelectLandmark,
}: {
  mySide: TeamSide
  myHomeRef: string | null
  selections: Map<string, FlagRole | null>
  poolIds: string[]
  selectedRef: string | null
  onSelectLandmark: (seedId: string) => void
}) {
  const pool = poolIds
    .map((id) => SEED_BY_ID.get(id))
    .filter((seed): seed is SeedLandmark => seed !== undefined)
  const bounds = pool.map((seed) => [seed.lat, seed.lng] as [number, number])

  return (
    <div className="h-72 w-full overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 sm:h-80">
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [36, 36], maxZoom: 15 }}
        minZoom={PLAY_AREA_MAP_MIN_ZOOM}
        maxBounds={getPlayAreaNavigationBounds()}
        maxBoundsViscosity={1}
        bounceAtZoomLimits={false}
        scrollWheelZoom
        className="h-full w-full"
        style={{ background: '#0a0a0a' }}
      >
        <LibertyBasemap />
        <MapNavigationBarrier />

        {pool.map((seed, index) => {
          const role = selections.get(seed.id) ?? null
          const selected = seed.id === selectedRef
          const isHome = seed.id === myHomeRef
          return (
            <CircleMarker
              key={seed.id}
              center={[seed.lat, seed.lng]}
              radius={selected ? 13 : isHome ? 11 : 10}
              pathOptions={{
                color: selected ? '#ffffff' : isHome ? '#d4d4d8' : '#fafafa',
                fillColor: role ? ROLE_COLOR[role] : TEAM_COLOR[mySide],
                fillOpacity: role ? 1 : 0.9,
                weight: selected ? 4 : isHome ? 3 : 2,
              }}
              eventHandlers={{ click: () => onSelectLandmark(seed.id) }}
            >
              <Tooltip
                permanent
                direction="center"
                offset={[0, 0]}
                className="setup-map-index"
              >
                {index + 1}
              </Tooltip>
            </CircleMarker>
          )
        })}
      </MapContainer>
    </div>
  )
}

export default SetupMap
