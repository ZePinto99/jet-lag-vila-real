'use client'

// Read-only planning map for the setup phase (PLAYTEST_TRIAGE P3-2), now the
// PRIMARY, map-first assignment surface (A2/A3/A4). Shows every candidate
// landmark in both team pools (public info before roles are assigned) plus
// neutrals. The team's own pool markers are TAPPABLE — tapping cycles the
// landmark's role (none → real → decoy → empty → none) via `onCycleRole`,
// staying in sync with the list fallback. No GPS, no actions.
//
// MUST be dynamic-imported with ssr:false — Leaflet touches `window` on import.

import 'leaflet/dist/leaflet.css'
import { MapContainer, TileLayer, CircleMarker, Circle, Tooltip } from 'react-leaflet'
import seedLandmarks from '@/data/landmarks.json'
import {
  PLAY_AREA_CENTRE,
  PLAY_AREA_RADIUS_M,
} from '@/lib/intel/overlays'
import type { FlagRole, SeedLandmark, TeamSide } from '@/lib/types'

const SEED = seedLandmarks as SeedLandmark[]

const TEAM_COLOR: Record<TeamSide, string> = {
  west: '#3b82f6',
  east: '#ec4899',
}
const NEUTRAL_COLOR = '#737373'

// Role tint for own-pool markers — matches the list UI (RoleButton) tones.
const ROLE_COLOR: Record<FlagRole, string> = {
  real: '#10b981', // emerald
  decoy: '#f59e0b', // amber
  empty: '#a3a3a3', // neutral
}
const ROLE_BADGE: Record<FlagRole, string> = {
  real: 'REAL',
  decoy: 'DECOY',
  empty: 'EMPTY',
}

function SetupMap({
  mySide,
  myHomeRef,
  selections,
  poolIds,
  onCycleRole,
}: {
  mySide: TeamSide
  myHomeRef: string | null
  selections: Map<string, FlagRole | null>
  poolIds: string[]
  onCycleRole: (seedId: string) => void
}) {
  const poolSet = new Set(poolIds)

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
          const isPool = poolSet.has(seed.id)
          const role = isPool ? selections.get(seed.id) ?? null : null
          // Own-pool markers are role-tinted (or team color when unassigned);
          // everything else keeps its team/neutral color.
          const baseColor =
            seed.team_pool === 'neutral'
              ? NEUTRAL_COLOR
              : TEAM_COLOR[seed.team_pool as TeamSide]
          const color = role ? ROLE_COLOR[role] : baseColor
          const isHome = seed.id === myHomeRef
          return (
            <CircleMarker
              key={seed.id}
              center={[seed.lat, seed.lng]}
              radius={isHome ? 12 : isPool ? 10 : isMine ? 9 : 7}
              pathOptions={{
                color: '#ffffff',
                fillColor: color,
                fillOpacity: isMine || seed.team_pool === 'neutral' ? 0.9 : 0.45,
                weight: isHome ? 4 : isPool ? 3 : 2,
              }}
              // Only the team's own assignable pool is interactive.
              interactive={isPool}
              eventHandlers={
                isPool ? { click: () => onCycleRole(seed.id) } : undefined
              }
            >
              {isPool ? (
                // Own-pool: permanent label so names stay visible while
                // selecting (A4), with a role badge once assigned.
                <Tooltip
                  permanent
                  direction="top"
                  offset={[0, -8]}
                  className={role ? 'map-label map-label--strong' : 'map-label'}
                >
                  {seed.name}
                  {role ? ` · ${ROLE_BADGE[role]}` : ''}
                </Tooltip>
              ) : (
                // Enemy / neutral markers: hover-only label, non-interactive.
                <Tooltip direction="top" offset={[0, -6]} className="map-label">
                  {seed.name}
                  {isHome ? ' (home)' : ''}
                </Tooltip>
              )}
            </CircleMarker>
          )
        })}
      </MapContainer>
    </div>
  )
}

export default SetupMap
