'use client'

// Leaflet game map for the live phase.
//
// Landmarks are coloured by TEAM, not by kind. So every landmark in West
// team's pool is blue (own or enemy from your POV), every East-team
// landmark is pink, neutrals are gray. The kind (real / decoy / empty) is
// shown in the popup that opens when you click a landmark — only for your
// own landmarks. Enemy landmarks show "Unknown" until you discover them by
// attempting them in step 4 (the `discoveredEnemyKinds` map will be
// populated then; for now it's always empty).
//
// MUST be dynamic-imported by the parent with `ssr: false` — Leaflet touches
// `window` during module init.

import { useMemo } from 'react'
import 'leaflet/dist/leaflet.css'
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Circle,
  Polygon,
  Tooltip,
  Popup,
  useMap,
} from 'react-leaflet'

import seedLandmarks from '@/data/landmarks.json'
import { DEFENSE_ZONE_RADIUS_M } from '@/lib/geo/zones'
import {
  getOutOfBoundsOverlay,
  getIntelOverlays,
  type MapOverlay,
} from '@/lib/intel/overlays'
import type { Card as IntelCard } from '@/lib/types'
import type {
  EnemyLandmark,
  GpsPosition,
  Landmark,
  LandmarkKind,
  PresencePayload,
  SeedLandmark,
  Team,
  TeamSide,
} from '@/lib/types'

const SEED_LANDMARKS = seedLandmarks as SeedLandmark[]

// Team-keyed landmark fill colour. This is the primary visual cue ("which
// team's pool is this landmark in"). Kind is revealed via popup.
const TEAM_COLOR: Record<TeamSide, string> = {
  west: '#3b82f6', // blue-500
  east: '#ec4899', // pink-500
}
const NEUTRAL_COLOR = '#737373' // neutral-500
const ME_COLOR = '#22d3ee' // cyan-400 — high-contrast vs both team colours

const RADIUS = {
  neutral: 8,
  home: 16,
  candidate: 12,
  other: 8,
  me: 11,
} as const

interface GameMapProps {
  myTeamLandmarks: Landmark[]
  enemyLandmarks: EnemyLandmark[]
  myTeam: Team
  enemyTeam: Team
  myGps: GpsPosition | null
  presence: Record<string, PresencePayload>
  myPlayerId: string | null
  /**
   * Enemy landmark refs whose kind has been confirmed by your team via a
   * flag attempt. Keyed by landmark.ref.
   */
  discoveredEnemyKinds?: Record<string, LandmarkKind>
  /**
   * Enemy landmark refs known NOT to be the real flag, derived from intel
   * cards. When `intelFilterEnabled` is true these are rendered in muted grey.
   */
  narrowedOutRefs?: Set<string>
  intelFilterEnabled?: boolean
  onToggleIntelFilter?: () => void
  /**
   * My team's intel cards (kind='intel'). Used to compute geographic
   * overlays — half-planes for N/S + E/W, ring complements for hot-cold.
   */
  myIntelCards?: IntelCard[]
  /** Caller's home base longitude — required for the E/W overlay. */
  myTeamHomeLng?: number | null
}

interface MapPoint {
  lat: number
  lng: number
}

function bounds(points: MapPoint[]): { center: [number, number] } {
  if (points.length === 0) return { center: [41.295, -7.726] }
  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
    if (p.lng < minLng) minLng = p.lng
    if (p.lng > maxLng) maxLng = p.lng
  }
  return { center: [(minLat + maxLat) / 2, (minLng + maxLng) / 2] }
}

function findSeed(ref: string): SeedLandmark | null {
  return SEED_LANDMARKS.find((s) => s.id === ref) ?? null
}

function walkingDirectionsUrl(lat: number, lng: number, label?: string): string {
  const dest = label ? `${lat},${lng}(${encodeURIComponent(label)})` : `${lat},${lng}`
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=walking`
}

function kindHumanLabel(kind: LandmarkKind): string {
  switch (kind) {
    case 'flag_real':
      return 'Real flag'
    case 'flag_decoy':
      return 'Decoy'
    case 'flag_empty':
      return 'Empty'
    case 'home':
      return 'Home base'
    case 'neutral':
      return 'Neutral'
  }
}

function LandmarkPopupBody({
  name,
  lat,
  lng,
  teamLabel,
  status,
  statusTone,
}: {
  name: string
  lat: number
  lng: number
  teamLabel: string
  status: string
  statusTone: 'own' | 'enemy' | 'neutral'
}) {
  const statusClass =
    statusTone === 'own'
      ? 'text-emerald-700'
      : statusTone === 'enemy'
        ? 'text-rose-700'
        : 'text-neutral-700'
  return (
    <div className="min-w-[180px] text-sm">
      <div className="font-medium text-neutral-900">{name}</div>
      <div className="mt-0.5 text-xs uppercase tracking-wider text-neutral-500">{teamLabel}</div>
      <div className={`mt-1.5 text-xs font-semibold ${statusClass}`}>{status}</div>
      <a
        href={walkingDirectionsUrl(lat, lng, name)}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex items-center rounded bg-neutral-900 px-2.5 py-1 text-xs font-medium text-neutral-100 hover:bg-neutral-700"
      >
        Walking directions
      </a>
    </div>
  )
}

function MapControls({
  myGps,
  intelFilterEnabled,
  intelFilterAvailable,
  narrowedCount,
  onToggleIntelFilter,
}: {
  myGps: GpsPosition | null
  intelFilterEnabled: boolean
  intelFilterAvailable: boolean
  narrowedCount: number
  onToggleIntelFilter: () => void
}) {
  const map = useMap()
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-[1000] flex flex-col gap-2">
      <button
        type="button"
        onClick={() => map.flyTo([41.295, -7.726], 14)}
        className="pointer-events-auto rounded-md border border-neutral-700 bg-neutral-900/90 px-3 py-1.5 text-xs font-medium text-neutral-100 shadow-lg backdrop-blur hover:bg-neutral-800"
      >
        Fit Vila Real
      </button>
      <button
        type="button"
        onClick={() => {
          if (myGps) map.flyTo([myGps.lat, myGps.lng], 16)
        }}
        disabled={!myGps}
        className="pointer-events-auto rounded-md border border-neutral-700 bg-neutral-900/90 px-3 py-1.5 text-xs font-medium text-neutral-100 shadow-lg backdrop-blur hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Recenter on me
      </button>
      <button
        type="button"
        onClick={onToggleIntelFilter}
        disabled={!intelFilterAvailable}
        className={
          'pointer-events-auto rounded-md border px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur disabled:cursor-not-allowed disabled:opacity-50 ' +
          (intelFilterEnabled
            ? 'border-amber-400 bg-amber-500/30 text-amber-100 hover:bg-amber-500/40'
            : 'border-neutral-700 bg-neutral-900/90 text-neutral-100 hover:bg-neutral-800')
        }
        title={
          intelFilterAvailable
            ? intelFilterEnabled
              ? `Intel filter ON — ${narrowedCount} ruled out`
              : 'Toggle the intel filter to dim ruled-out enemies'
            : 'Buy intel to enable this filter'
        }
      >
        {intelFilterEnabled ? `Intel filter ON (${narrowedCount})` : 'Intel filter OFF'}
      </button>
    </div>
  )
}

function MapLegend({ myTeamSide, enemyTeamSide }: { myTeamSide: TeamSide; enemyTeamSide: TeamSide }) {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] rounded-md border border-neutral-700 bg-neutral-900/90 px-3 py-2 text-[11px] text-neutral-200 shadow-lg backdrop-blur">
      <div className="font-semibold text-neutral-100 uppercase tracking-wider mb-1">Legend</div>
      <div className="flex items-center gap-2">
        <span className="inline-block h-3 w-3 rounded-full border-2 border-white" style={{ background: TEAM_COLOR[myTeamSide] }} />
        <span>Your team ({myTeamSide.toUpperCase()})</span>
      </div>
      <div className="mt-0.5 flex items-center gap-2">
        <span className="inline-block h-3 w-3 rounded-full border-2 border-white" style={{ background: TEAM_COLOR[enemyTeamSide] }} />
        <span>Enemy team ({enemyTeamSide.toUpperCase()})</span>
      </div>
      <div className="mt-0.5 flex items-center gap-2">
        <span className="inline-block h-3 w-3 rounded-full border-2 border-white" style={{ background: NEUTRAL_COLOR }} />
        <span>Neutral</span>
      </div>
      <div className="mt-0.5 flex items-center gap-2">
        <span className="inline-block h-3 w-3 rounded-full border-2 border-white" style={{ background: ME_COLOR }} />
        <span>You</span>
      </div>
    </div>
  )
}

function GameMap({
  myTeamLandmarks,
  enemyLandmarks,
  myTeam,
  enemyTeam,
  myGps,
  presence,
  myPlayerId,
  discoveredEnemyKinds = {},
  narrowedOutRefs,
  intelFilterEnabled = false,
  onToggleIntelFilter,
  myIntelCards = [],
  myTeamHomeLng = null,
}: GameMapProps) {
  const outOfBoundsOverlay: MapOverlay = useMemo(() => getOutOfBoundsOverlay(), [])
  const intelOverlays: MapOverlay[] = useMemo(
    () =>
      intelFilterEnabled
        ? getIntelOverlays(myIntelCards, myTeamHomeLng)
        : [],
    [intelFilterEnabled, myIntelCards, myTeamHomeLng],
  )
  const filterActive = intelFilterEnabled && narrowedOutRefs != null && narrowedOutRefs.size > 0
  const myHomeSeed = myTeam.home_landmark_id ? findSeed(myTeam.home_landmark_id) : null
  const enemyHomeSeed = enemyTeam.home_landmark_id ? findSeed(enemyTeam.home_landmark_id) : null

  const neutralSeeds = useMemo(
    () => SEED_LANDMARKS.filter((s) => s.team_pool === 'neutral'),
    [],
  )

  const center = useMemo(() => {
    const points: MapPoint[] = []
    for (const lm of myTeamLandmarks) points.push({ lat: lm.lat, lng: lm.lng })
    for (const lm of enemyLandmarks) points.push({ lat: lm.lat, lng: lm.lng })
    if (myHomeSeed) points.push({ lat: myHomeSeed.lat, lng: myHomeSeed.lng })
    if (enemyHomeSeed) points.push({ lat: enemyHomeSeed.lat, lng: enemyHomeSeed.lng })
    return bounds(points).center
  }, [myTeamLandmarks, enemyLandmarks, myHomeSeed, enemyHomeSeed])

  const otherPlayers = useMemo(
    () => Object.values(presence).filter((p) => p.player_id !== myPlayerId),
    [presence, myPlayerId],
  )

  const myAccuracyM = myGps ? Math.min(50, Math.max(5, myGps.accuracy)) : 0

  const myColor = TEAM_COLOR[myTeam.side]
  const enemyColor = TEAM_COLOR[enemyTeam.side]

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={center}
        zoom={14}
        scrollWheelZoom
        className="h-full w-full"
        style={{ background: '#0a0a0a' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Out-of-play overlay — always on; grays everything > 2.5 km from
            city centre. */}
        <Polygon
          positions={outOfBoundsOverlay.rings}
          pathOptions={{
            fillColor: '#000000',
            fillOpacity: 0.55,
            stroke: false,
            interactive: false,
          }}
        />

        {/* Intel overlays — only when the filter is on. Each ruled-out
            region is rendered as a separate semi-transparent polygon; they
            stack naturally where intel narrows further. */}
        {intelOverlays.map((o, i) => (
          <Polygon
            key={`intel-overlay-${i}`}
            positions={o.rings}
            pathOptions={{
              fillColor: '#000000',
              fillOpacity: 0.35,
              stroke: false,
              interactive: false,
            }}
          />
        ))}

        <MapControls
          myGps={myGps}
          intelFilterEnabled={intelFilterEnabled}
          intelFilterAvailable={narrowedOutRefs != null && narrowedOutRefs.size > 0}
          narrowedCount={narrowedOutRefs?.size ?? 0}
          onToggleIntelFilter={() => onToggleIntelFilter?.()}
        />
        <MapLegend myTeamSide={myTeam.side} enemyTeamSide={enemyTeam.side} />

        {/* Defense zones — 200 m circles around each of my candidate landmarks.
            A tag is only valid when the defender is inside one of these. */}
        {myTeamLandmarks.map((lm) => (
          <Circle
            key={`zone-${lm.id}`}
            center={[lm.lat, lm.lng]}
            radius={DEFENSE_ZONE_RADIUS_M}
            pathOptions={{
              color: myColor,
              fillColor: myColor,
              fillOpacity: 0.1,
              weight: 1,
              opacity: 0.45,
              dashArray: '4 4',
            }}
          />
        ))}

        {/* Neutral landmarks. */}
        {neutralSeeds.map((seed) => (
          <CircleMarker
            key={`neutral-${seed.id}`}
            center={[seed.lat, seed.lng]}
            radius={RADIUS.neutral}
            pathOptions={{
              color: '#ffffff',
              fillColor: NEUTRAL_COLOR,
              fillOpacity: 0.85,
              weight: 2,
            }}
          >
            <Tooltip direction="right" offset={[8, 0]} className="map-label">
              {seed.name}
            </Tooltip>
            <Popup>
              <LandmarkPopupBody
                name={seed.name}
                lat={seed.lat}
                lng={seed.lng}
                teamLabel="Neutral landmark"
                status="Safe respawn point"
                statusTone="neutral"
              />
            </Popup>
          </CircleMarker>
        ))}

        {/* My team home base. */}
        {myHomeSeed && (
          <CircleMarker
            center={[myHomeSeed.lat, myHomeSeed.lng]}
            radius={RADIUS.home}
            pathOptions={{
              color: '#ffffff',
              fillColor: myColor,
              fillOpacity: 0.95,
              weight: 4,
            }}
          >
            <Tooltip direction="top" offset={[0, -10]} className="map-label map-label--strong">
              {myHomeSeed.name} (home)
            </Tooltip>
            <Popup>
              <LandmarkPopupBody
                name={myHomeSeed.name}
                lat={myHomeSeed.lat}
                lng={myHomeSeed.lng}
                teamLabel={`${myTeam.side.toUpperCase()} — your team`}
                status="Your home base. Return here with the enemy flag to win."
                statusTone="own"
              />
            </Popup>
          </CircleMarker>
        )}

        {/* Enemy team home base. */}
        {enemyHomeSeed && (
          <CircleMarker
            center={[enemyHomeSeed.lat, enemyHomeSeed.lng]}
            radius={RADIUS.home}
            pathOptions={{
              color: '#ffffff',
              fillColor: enemyColor,
              fillOpacity: 0.75,
              weight: 3,
              dashArray: '4 3',
            }}
          >
            <Tooltip direction="top" offset={[0, -10]} className="map-label map-label--strong">
              {enemyHomeSeed.name} (enemy home)
            </Tooltip>
            <Popup>
              <LandmarkPopupBody
                name={enemyHomeSeed.name}
                lat={enemyHomeSeed.lat}
                lng={enemyHomeSeed.lng}
                teamLabel={`${enemyTeam.side.toUpperCase()} — enemy team`}
                status="Enemy home base."
                statusTone="enemy"
              />
            </Popup>
          </CircleMarker>
        )}

        {/* My team candidate landmarks — coloured by my team's side. */}
        {myTeamLandmarks.map((lm) => {
          const seed = findSeed(lm.ref)
          const name = seed?.name ?? lm.ref
          return (
            <CircleMarker
              key={`mine-${lm.id}`}
              center={[lm.lat, lm.lng]}
              radius={RADIUS.candidate}
              pathOptions={{
                color: '#ffffff',
                fillColor: myColor,
                fillOpacity: 0.92,
                weight: 2,
              }}
            >
              <Tooltip direction="right" offset={[8, 0]} className="map-label">
                {name}
              </Tooltip>
              <Popup>
                <LandmarkPopupBody
                  name={name}
                  lat={lm.lat}
                  lng={lm.lng}
                  teamLabel={`${myTeam.side.toUpperCase()} — your candidate`}
                  status={kindHumanLabel(lm.kind)}
                  statusTone="own"
                />
              </Popup>
            </CircleMarker>
          )
        })}

        {/* Enemy team candidate landmarks — coloured by enemy team's side.
            When the intel filter is on, refs that intel has ruled out get
            rendered in muted grey. */}
        {enemyLandmarks.map((lm) => {
          const seed = findSeed(lm.ref)
          const name = seed?.name ?? lm.ref
          const discovered = discoveredEnemyKinds[lm.ref]
          const isNarrowedOut = filterActive && narrowedOutRefs!.has(lm.ref)
          const fill = isNarrowedOut ? '#404040' : enemyColor
          const stroke = isNarrowedOut ? '#525252' : '#ffffff'
          return (
            <CircleMarker
              key={`enemy-${lm.id}`}
              center={[lm.lat, lm.lng]}
              radius={RADIUS.candidate}
              pathOptions={{
                color: stroke,
                fillColor: fill,
                fillOpacity: isNarrowedOut ? 0.4 : 0.85,
                weight: isNarrowedOut ? 1 : 2,
              }}
            >
              <Tooltip direction="right" offset={[8, 0]} className="map-label">
                {name}
              </Tooltip>
              <Popup>
                <LandmarkPopupBody
                  name={name}
                  lat={lm.lat}
                  lng={lm.lng}
                  teamLabel={`${enemyTeam.side.toUpperCase()} — enemy candidate`}
                  status={
                    discovered
                      ? `Confirmed: ${kindHumanLabel(discovered)}`
                      : isNarrowedOut
                        ? 'Ruled out by intel'
                        : 'Unknown — attempt to discover'
                  }
                  statusTone="enemy"
                />
              </Popup>
            </CircleMarker>
          )
        })}

        {/* Other players from presence. */}
        {otherPlayers.map((p) => {
          const isMine = p.team_id === myTeam.id
          const color = isMine ? myColor : enemyColor
          return (
            <CircleMarker
              key={`p-${p.player_id}`}
              center={[p.lat, p.lng]}
              radius={RADIUS.other}
              pathOptions={{ color: '#ffffff', fillColor: color, fillOpacity: 0.95, weight: 2 }}
            >
              <Tooltip>{isMine ? 'Team-mate' : 'Enemy player'}</Tooltip>
            </CircleMarker>
          )
        })}

        {/* Me. */}
        {myGps && (
          <>
            <Circle
              center={[myGps.lat, myGps.lng]}
              radius={myAccuracyM}
              pathOptions={{ color: ME_COLOR, fillColor: ME_COLOR, fillOpacity: 0.15, weight: 1 }}
            />
            <CircleMarker
              center={[myGps.lat, myGps.lng]}
              radius={RADIUS.me}
              pathOptions={{
                color: '#ffffff',
                fillColor: ME_COLOR,
                fillOpacity: 1,
                weight: 3,
              }}
            >
              <Tooltip direction="top" offset={[0, -8]} className="map-label map-label--strong">
                You
              </Tooltip>
            </CircleMarker>
          </>
        )}
      </MapContainer>
    </div>
  )
}

export default GameMap
