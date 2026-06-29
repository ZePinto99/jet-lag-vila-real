'use client'

// Lightweight read-only Leaflet map for the spectator view.
//
// Plots each landmark as a small circle marker coloured by team
// (west = blue, east = pink, unowned/neutral = gray). It deliberately does NOT
// reuse the player GameMap (which is heavily coupled to a player perspective:
// own/enemy split, GPS marker, defense zones, intel overlays). Spectators see a
// flat, redacted board — coords + team only, no kind/hardened.
//
// MUST be dynamic-imported by the parent with `ssr: false` — Leaflet touches
// `window` during module init.

import { useEffect, useMemo } from 'react'
import 'leaflet/dist/leaflet.css'
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Tooltip,
  useMap,
} from 'react-leaflet'
import type { LatLngBoundsExpression } from 'leaflet'
import type { Team } from '@/lib/types'

interface ObserverLandmark {
  id: string
  ref: string
  lat: number
  lng: number
  team_id: string | null
}

const WEST_COLOR = '#3b82f6'
const EAST_COLOR = '#ec4899'
const NEUTRAL_COLOR = '#737373'

// Carto Voyager basemap — matches the gamified look used elsewhere.
const TILE_URL =
  'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'

export default function ObserverMap({
  landmarks,
  teams,
}: {
  landmarks: ObserverLandmark[]
  teams: Team[]
}) {
  const sideById = useMemo(() => {
    const m = new Map<string, 'west' | 'east'>()
    for (const t of teams) m.set(t.id, t.side)
    return m
  }, [teams])

  const center = useMemo<[number, number]>(() => {
    if (landmarks.length === 0) return [41.3006, -7.7441] // Vila Real fallback.
    const lat =
      landmarks.reduce((acc, l) => acc + l.lat, 0) / landmarks.length
    const lng =
      landmarks.reduce((acc, l) => acc + l.lng, 0) / landmarks.length
    return [lat, lng]
  }, [landmarks])

  const bounds = useMemo<LatLngBoundsExpression | null>(() => {
    if (landmarks.length === 0) return null
    return landmarks.map((l) => [l.lat, l.lng]) as LatLngBoundsExpression
  }, [landmarks])

  const colorFor = (l: ObserverLandmark): string => {
    if (!l.team_id) return NEUTRAL_COLOR
    const side = sideById.get(l.team_id)
    if (side === 'west') return WEST_COLOR
    if (side === 'east') return EAST_COLOR
    return NEUTRAL_COLOR
  }

  return (
    <MapContainer
      center={center}
      zoom={14}
      scrollWheelZoom
      className="h-full min-h-[300px] w-full"
      style={{ background: '#0a0a0a' }}
    >
      <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />
      <FitToBounds bounds={bounds} />
      {landmarks.map((l) => {
        const color = colorFor(l)
        return (
          <CircleMarker
            key={l.id}
            center={[l.lat, l.lng]}
            radius={7}
            pathOptions={{
              color,
              fillColor: color,
              fillOpacity: 0.85,
              weight: 2,
            }}
          >
            <Tooltip>{prettyRef(l.ref)}</Tooltip>
          </CircleMarker>
        )
      })}
    </MapContainer>
  )
}

// Imperatively fit the map to the landmark bounds once mounted.
function FitToBounds({ bounds }: { bounds: LatLngBoundsExpression | null }) {
  const map = useMap()
  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 })
    }
  }, [bounds, map])
  return null
}

// Turn a landmark ref like "landmark.se-catedral" into "Se Catedral".
function prettyRef(ref: string): string {
  const tail = ref.includes('.') ? ref.split('.').slice(1).join('.') : ref
  return tail
    .split('-')
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}
