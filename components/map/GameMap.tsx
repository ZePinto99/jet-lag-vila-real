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

import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  MapContainer,
  CircleMarker,
  Circle,
  Marker,
  Polygon,
  Tooltip,
  Popup,
  useMap,
  useMapEvents,
} from 'react-leaflet'

import seedLandmarks from '@/data/landmarks.json'
import { LibertyBasemap } from '@/components/map/LibertyBasemap'
import { MapNavigationBarrier } from '@/components/map/MapNavigationBarrier'
import { useI18n } from '@/lib/i18n/context'
import { localizeCatalogField } from '@/lib/i18n/gameCatalog'
import { DEFENSE_ZONE_RADIUS_M, isInDefenseZone } from '@/lib/geo/zones'
import { radarPingVisible } from '@/lib/geo/radar'
import { isPositionFresh } from '@/lib/geo/positionFreshness'
import type { ChallengeMarker } from '@/lib/hooks/useActiveChallenges'
import type { EnemyLandmarkLock } from '@/lib/hooks/useEnemyLandmarkLocks'
import {
  getOutOfBoundsOverlay,
  getIntelOverlays,
  type MapOverlay,
} from '@/lib/intel/overlays'
import {
  getMapDisplayPosition,
  getPlayAreaBounds,
  getPlayAreaNavigationBounds,
  getPlayAreaStateForGps,
  PLAY_AREA_CENTRE,
  PLAY_AREA_MAP_MIN_ZOOM,
  PLAY_AREA_RADIUS_M,
  type MapDisplayPosition,
  type PlayAreaState,
} from '@/lib/geo/playArea'
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
  mapCommand?: { type: 'fit' | 'recenter'; requestId: number } | null
  /**
   * My team's intel cards (kind='intel'). Used to compute geographic
   * overlays — half-planes for N/S + E/W, ring complements for hot-cold.
   */
  myIntelCards?: IntelCard[]
  /** Caller's home base longitude — required for the E/W overlay. */
  myTeamHomeLng?: number | null
  /** During the 30-min protection window, enemy candidates render "locked". */
  attemptsLocked?: boolean
  /**
   * Per-landmark lockout state for enemy candidates my team has attempted
   * (decoy/empty → 15-min lockout). Drives the grey-out + countdown.
   */
  enemyLocks?: Record<string, EnemyLandmarkLock>
  /** Ticking clock (ms) so the lockout countdown + radar pulse update. */
  nowMs?: number
  /** Wall clock for rejecting stale GPS before showing boundary alarms. */
  wallNowMs?: number
  /** Stabilized boundary state from the live screen; computed locally in tests/other callers. */
  boundaryState?: PlayAreaState | null
  /** Active challenges (with resolved coords) → gold star markers. */
  challenges?: ChallengeMarker[]
}

function findSeed(ref: string): SeedLandmark | null {
  return SEED_LANDMARKS.find((s) => s.id === ref) ?? null
}

// Gold star marker for a challenge location (playtest item C10). A divIcon so
// it can be a real ★ glyph with a dark halo for legibility on the basemap.
function challengeStarIcon(): L.DivIcon {
  return L.divIcon({
    className: 'challenge-star-icon',
    html: '<div class="challenge-star">★</div>',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
}

// Radar blip for a revealed enemy: a pulsing dot + expanding sweep ring,
// animated purely in CSS so it stays smooth between the 1 Hz clock ticks.
function radarBlipIcon(color: string): L.DivIcon {
  return L.divIcon({
    className: 'radar-blip-icon',
    html:
      `<div class="radar-blip">` +
      `<span class="radar-blip__ring" style="border-color:${color}"></span>` +
      `<span class="radar-blip__dot" style="background:${color}"></span>` +
      `</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  })
}

// Start in a street-level game view. The previous full 3 km play-disk fit made
// the player feel detached from the immediate hunt. If GPS arrives after the
// map mounts, focus it once; subsequent fixes never fight manual panning.
function InitialViewport({ myPosition }: { myPosition: MapDisplayPosition | null }) {
  const focusedOnPlayerRef = useRef(false)
  const userMovedMapRef = useRef(false)
  const map = useMapEvents({
    dragstart() {
      userMovedMapRef.current = true
    },
    zoomstart() {
      userMovedMapRef.current = true
    },
  })
  useEffect(() => {
    if (!myPosition || focusedOnPlayerRef.current || userMovedMapRef.current)
      return
    focusedOnPlayerRef.current = true
    // setView avoids an animated excursion beyond maxBounds when the real GPS
    // point has been projected onto the recovery edge.
    map.setView([myPosition.lat, myPosition.lng], 16, { animate: false })
  }, [map, myPosition])
  return null
}

// m:ss for the lockout countdown shown inside a landmark circle.
function fmtCountdown(ms: number): string {
  const rem = Math.max(0, ms)
  const m = Math.floor(rem / 60_000)
  const s = Math.floor((rem % 60_000) / 1000)
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

// Eliminated (attempted decoy/empty) enemy landmarks render in this grey.
const ELIMINATED_COLOR = '#6b7280' // gray-500

function walkingDirectionsUrl(lat: number, lng: number, label?: string): string {
  const dest = label ? `${lat},${lng}(${encodeURIComponent(label)})` : `${lat},${lng}`
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=walking`
}

type Translate = (key: string, tokens?: Record<string, string | number>) => string

function kindHumanLabel(kind: LandmarkKind, t: Translate): string {
  switch (kind) {
    case 'flag_real':
      return t('map.real_flag')
    case 'flag_decoy':
      return t('map.decoy')
    case 'flag_empty':
      return t('map.empty')
    case 'home':
      return t('map.home_base')
    case 'neutral':
      return t('map.legend_neutral')
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
  const { t } = useI18n()
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
        {t('map.walking_directions')}
      </a>
    </div>
  )
}

function MapCommandController({
  command,
  myPosition,
}: {
  command: GameMapProps['mapCommand']
  myPosition: MapDisplayPosition | null
}) {
  const map = useMap()
  const handledRequestRef = useRef<number | null>(null)
  useEffect(() => {
    if (!command || handledRequestRef.current === command.requestId) return
    handledRequestRef.current = command.requestId
    if (command.type === 'fit') {
      map.flyToBounds(getPlayAreaBounds(), { padding: [24, 24] })
    } else if (myPosition) {
      map.setView([myPosition.lat, myPosition.lng], 16)
    }
  }, [command, map, myPosition])
  return null
}

function MapLegend({
  myTeamSide,
  enemyTeamSide,
}: {
  myTeamSide: TeamSide
  enemyTeamSide: TeamSide
}) {
  const { t } = useI18n()
  const mySide = t(myTeamSide === 'west' ? 'common.west' : 'common.east')
  const enemySide = t(enemyTeamSide === 'west' ? 'common.west' : 'common.east')
  return (
    <div
      aria-label={t('map.legend_title')}
      className="pointer-events-none absolute left-3 top-3 z-[1000] grid grid-cols-2 gap-x-3 gap-y-1 rounded-full border border-neutral-700 bg-neutral-900/90 px-3 py-2 text-[10px] text-neutral-200 shadow-lg backdrop-blur"
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full border border-white"
          style={{ background: TEAM_COLOR[myTeamSide] }}
        />
        <span>
          {t('map.legend_your_team')} ({mySide})
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full border border-white"
          style={{ background: TEAM_COLOR[enemyTeamSide] }}
        />
        <span>
          {t('map.legend_enemy_team')} ({enemySide})
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full border border-white"
          style={{ background: NEUTRAL_COLOR }}
        />
        <span>{t('map.legend_neutral')}</span>
      </div>
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full border border-white"
          style={{ background: ME_COLOR }}
        />
        <span>{t('map.legend_you')}</span>
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
  mapCommand = null,
  myIntelCards = [],
  myTeamHomeLng = null,
  attemptsLocked = false,
  enemyLocks = {},
  nowMs,
  wallNowMs,
  boundaryState,
  challenges = [],
}: GameMapProps) {
  const { locale, t } = useI18n()
  const outOfBoundsOverlay: MapOverlay = useMemo(() => getOutOfBoundsOverlay(), [])
  const navigationBounds = useMemo(() => getPlayAreaNavigationBounds(), [])
  const intelOverlays: MapOverlay[] = useMemo(
    () => (intelFilterEnabled ? getIntelOverlays(myIntelCards, myTeamHomeLng) : []),
    [intelFilterEnabled, myIntelCards, myTeamHomeLng],
  )
  const filterActive = intelFilterEnabled && narrowedOutRefs != null && narrowedOutRefs.size > 0
  const myHomeSeed = myTeam.home_landmark_id ? findSeed(myTeam.home_landmark_id) : null
  const enemyHomeSeed = enemyTeam.home_landmark_id ? findSeed(enemyTeam.home_landmark_id) : null
  const myHomeName = myHomeSeed
    ? localizeCatalogField(myHomeSeed.id, 'name', myHomeSeed.name, locale)
    : null
  const enemyHomeName = enemyHomeSeed
    ? localizeCatalogField(enemyHomeSeed.id, 'name', enemyHomeSeed.name, locale)
    : null

  const neutralSeeds = useMemo(() => SEED_LANDMARKS.filter((s) => s.team_pool === 'neutral'), [])

  const otherPlayers = useMemo(
    () => Object.values(presence).filter((p) => p.player_id !== myPlayerId),
    [presence, myPlayerId],
  )

  // My candidate landmarks as bare points — the union of 200 m circles around
  // these is my defense zone, which gates which enemies the radar reveals.
  const myZonePoints = useMemo(
    () => myTeamLandmarks.map((lm) => ({ lat: lm.lat, lng: lm.lng })),
    [myTeamLandmarks],
  )
  const radarOn = nowMs != null && radarPingVisible(nowMs)

  const freshMyGps =
    myGps &&
    (wallNowMs == null || isPositionFresh(myGps.updated_at, wallNowMs))
      ? myGps
      : null
  const computedPlayAreaState = useMemo(
    () => (freshMyGps ? getPlayAreaStateForGps(freshMyGps) : null),
    [freshMyGps],
  )
  const myPlayAreaState = boundaryState === undefined ? computedPlayAreaState : boundaryState
  const usableMyGps = myPlayAreaState ? freshMyGps : null
  const myDisplayPosition = useMemo(
    () => (usableMyGps ? getMapDisplayPosition(usableMyGps) : null),
    [usableMyGps],
  )
  const myAccuracyM = usableMyGps ? Math.min(50, Math.max(5, usableMyGps.accuracy)) : 0

  const myColor = TEAM_COLOR[myTeam.side]
  const enemyColor = TEAM_COLOR[enemyTeam.side]

  return (
    <div className="relative h-full w-full">
      <MapContainer
        center={[PLAY_AREA_CENTRE.lat, PLAY_AREA_CENTRE.lng]}
        zoom={15.5}
        zoomSnap={0.5}
        minZoom={PLAY_AREA_MAP_MIN_ZOOM}
        maxBounds={navigationBounds}
        maxBoundsViscosity={1}
        bounceAtZoomLimits={false}
        zoomControl={false}
        scrollWheelZoom
        className="h-full w-full"
        style={{ background: '#0a0a0a' }}
      >
        <InitialViewport myPosition={myDisplayPosition} />
        <LibertyBasemap />

        {/* Out-of-play overlay — always on; grays everything > 1.5 km from
            city centre. */}
        <Polygon
          positions={outOfBoundsOverlay.rings}
          pathOptions={{
            fillColor: '#000000',
            fillOpacity: 0.72,
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
              fillColor: o.fillColor ?? '#000000',
              fillOpacity: o.fillOpacity ?? 0.35,
              stroke: o.strokeColor != null,
              color: o.strokeColor,
              opacity: o.strokeColor ? 0.65 : 0,
              weight: o.strokeColor ? 2 : 0,
              interactive: false,
            }}
          />
        ))}

        {/* The 300 m recovery belt ends here. Keep this after every shaded
            overlay so no intel tint can reveal the basemap past the barrier. */}
        <MapNavigationBarrier />

        <Circle
          center={[PLAY_AREA_CENTRE.lat, PLAY_AREA_CENTRE.lng]}
          radius={PLAY_AREA_RADIUS_M}
          pathOptions={{
            color: '#f87171',
            opacity: 0.9,
            weight: 2,
            dashArray: '8 6',
            fill: false,
            interactive: false,
          }}
        />

        <MapCommandController command={mapCommand} myPosition={myDisplayPosition} />
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
              {localizeCatalogField(seed.id, 'name', seed.name, locale)}
            </Tooltip>
            <Popup>
              <LandmarkPopupBody
                name={localizeCatalogField(seed.id, 'name', seed.name, locale)}
                lat={seed.lat}
                lng={seed.lng}
                teamLabel={t('map.neutral_landmark')}
                status={t('map.safe_respawn')}
                statusTone="neutral"
              />
            </Popup>
          </CircleMarker>
        ))}

        {/* My team home base. */}
        {myHomeSeed && myHomeName && (
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
              {myHomeName} ({t('map.home_base').toLocaleLowerCase(locale)})
            </Tooltip>
            <Popup>
              <LandmarkPopupBody
                name={myHomeName}
                lat={myHomeSeed.lat}
                lng={myHomeSeed.lng}
                teamLabel={`${t('common.team')} ${t(myTeam.side === 'west' ? 'common.west' : 'common.east')} — ${t('map.your_home')}`}
                status={t('map.your_home_status')}
                statusTone="own"
              />
            </Popup>
          </CircleMarker>
        )}

        {/* Enemy team home base. */}
        {enemyHomeSeed && enemyHomeName && (
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
              {enemyHomeName} ({t('map.enemy_home')})
            </Tooltip>
            <Popup>
              <LandmarkPopupBody
                name={enemyHomeName}
                lat={enemyHomeSeed.lat}
                lng={enemyHomeSeed.lng}
                teamLabel={`${t('common.team')} ${t(enemyTeam.side === 'west' ? 'common.west' : 'common.east')} — ${t('map.enemy_home')}`}
                status={t('map.enemy_home_status')}
                statusTone="enemy"
              />
            </Popup>
          </CircleMarker>
        )}

        {/* My team candidate landmarks — coloured by my team's side. */}
        {myTeamLandmarks.map((lm) => {
          const seed = findSeed(lm.ref)
          const name = seed ? localizeCatalogField(seed.id, 'name', seed.name, locale) : lm.ref
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
                  teamLabel={`${t('common.team')} ${t(myTeam.side === 'west' ? 'common.west' : 'common.east')} — ${t('map.your_candidate')}`}
                  status={kindHumanLabel(lm.kind, t)}
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
          const name = seed ? localizeCatalogField(seed.id, 'name', seed.name, locale) : lm.ref
          const discovered = discoveredEnemyKinds[lm.ref]
          // Eliminated = we attempted it and it was a decoy/empty (a dead end).
          const eliminated = discovered === 'flag_decoy' || discovered === 'flag_empty'
          // Remaining 15-min lockout on this landmark (only meaningful for an
          // eliminated one we just attempted).
          const lock = enemyLocks[lm.ref]
          const lockRemaining =
            eliminated && lock && nowMs != null && nowMs < lock.unlocksAtMs
              ? lock.unlocksAtMs - nowMs
              : 0
          const isNarrowedOut = filterActive && narrowedOutRefs!.has(lm.ref)
          // During the 30-min protection window, undiscovered enemy candidates
          // render "locked" (amber dashed ring).
          const locked = attemptsLocked && !discovered && !isNarrowedOut
          const fill = eliminated ? ELIMINATED_COLOR : isNarrowedOut ? '#404040' : enemyColor
          const stroke = eliminated
            ? '#9ca3af'
            : isNarrowedOut
              ? '#525252'
              : locked
                ? '#f59e0b'
                : '#ffffff'
          return (
            <CircleMarker
              key={`enemy-${lm.id}`}
              center={[lm.lat, lm.lng]}
              radius={RADIUS.candidate}
              pathOptions={{
                color: stroke,
                fillColor: fill,
                fillOpacity: eliminated ? 0.6 : isNarrowedOut ? 0.4 : 0.85,
                weight: isNarrowedOut ? 1 : 2,
                dashArray: locked ? '3 3' : undefined,
              }}
            >
              {/* During the lockout, show a live countdown inside the circle;
                  otherwise the usual hover name label. */}
              {lockRemaining > 0 ? (
                <Tooltip permanent direction="center" className="map-countdown">
                  ⏳ {fmtCountdown(lockRemaining)}
                </Tooltip>
              ) : (
                <Tooltip direction="right" offset={[8, 0]} className="map-label">
                  {name}
                </Tooltip>
              )}
              <Popup>
                <LandmarkPopupBody
                  name={name}
                  lat={lm.lat}
                  lng={lm.lng}
                  teamLabel={`${t('common.team')} ${t(enemyTeam.side === 'west' ? 'common.west' : 'common.east')} — ${t('map.enemy_candidate')}`}
                  status={
                    eliminated
                      ? lockRemaining > 0
                        ? t('map.eliminated_locked', {
                            kind: kindHumanLabel(discovered, t),
                            time: fmtCountdown(lockRemaining),
                          })
                        : t('map.eliminated', { kind: kindHumanLabel(discovered, t) })
                      : discovered
                        ? t('map.confirmed', { kind: kindHumanLabel(discovered, t) })
                        : isNarrowedOut
                          ? t('map.ruled_out')
                          : locked
                            ? t('map.attempts_locked')
                            : t('map.unknown_attempt')
                  }
                  statusTone="enemy"
                />
              </Popup>
            </CircleMarker>
          )
        })}

        {/* Challenge locations — gold star markers (playtest item C10). */}
        {challenges.map((c) => {
          const name = localizeCatalogField(c.ref, 'location_name', c.name, locale)
          const task = localizeCatalogField(c.ref, 'task', c.task, locale)
          return (
            <Marker key={`challenge-${c.ref}`} position={[c.lat, c.lng]} icon={challengeStarIcon()}>
              <Tooltip direction="top" offset={[0, -12]} className="map-label">
                ⭐ {name} · +{c.reward}
              </Tooltip>
              <Popup>
                <div className="min-w-[180px] text-sm">
                  <div className="font-medium text-neutral-900">⭐ {name}</div>
                  <div className="mt-1 text-xs text-neutral-700">{task}</div>
                  <div className="mt-1 text-xs font-semibold text-amber-700">
                    {t('challenge.reward', { n: c.reward })}
                  </div>
                </div>
              </Popup>
            </Marker>
          )
        })}

        {/* Players from presence. Team-mates are always visible. Enemies are
            radar-gated: revealed only while inside one of my own defense zones
            AND during a radar ping (5 s on / 15 s off — see lib/geo/radar.ts).
            The rule is identical for every player on every device. */}
        {otherPlayers.map((p) => {
          const isMine = p.team_id === myTeam.id
          if (isMine) {
            return (
              <CircleMarker
                key={`p-${p.player_id}`}
                center={[p.lat, p.lng]}
                radius={RADIUS.other}
                pathOptions={{
                  color: '#ffffff',
                  fillColor: myColor,
                  fillOpacity: 0.95,
                  weight: 2,
                }}
              >
                <Tooltip>{t('map.teammate')}</Tooltip>
              </CircleMarker>
            )
          }
          const inMyZone = isInDefenseZone({ lat: p.lat, lng: p.lng }, myZonePoints)
          if (!inMyZone || !radarOn) return null
          return (
            <Marker
              key={`radar-${p.player_id}`}
              position={[p.lat, p.lng]}
              icon={radarBlipIcon(enemyColor)}
              zIndexOffset={500}
            >
              <Tooltip direction="top" offset={[0, -12]} className="map-label map-label--strong">
                {t('map.enemy_raider')}
              </Tooltip>
            </Marker>
          )
        })}

        {/* Me. */}
        {usableMyGps && myDisplayPosition && (
          <>
            {!myDisplayPosition.isClamped && (
              <Circle
                center={[myDisplayPosition.lat, myDisplayPosition.lng]}
                radius={myAccuracyM}
                pathOptions={{
                  color: ME_COLOR,
                  fillColor: ME_COLOR,
                  fillOpacity: 0.15,
                  weight: 1,
                }}
              />
            )}
            <CircleMarker
              center={[myDisplayPosition.lat, myDisplayPosition.lng]}
              radius={RADIUS.me}
              pathOptions={{
                color: myPlayAreaState?.status === 'outside' ? '#fecaca' : '#ffffff',
                fillColor: myPlayAreaState?.status === 'outside' ? '#ef4444' : ME_COLOR,
                fillOpacity: 1,
                weight: 3,
                dashArray: myDisplayPosition.isClamped ? '3 3' : undefined,
              }}
            >
              <Tooltip
                permanent={myPlayAreaState?.status === 'outside'}
                direction="top"
                offset={[0, -8]}
                className="map-label map-label--strong"
              >
                {myPlayAreaState?.status === 'outside'
                  ? t('map.you_outside', { m: Math.round(myPlayAreaState.overshootM) })
                  : t('map.legend_you')}
              </Tooltip>
            </CircleMarker>
          </>
        )}
      </MapContainer>
    </div>
  )
}

export default GameMap
