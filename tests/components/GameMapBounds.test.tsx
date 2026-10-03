import { screen } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import * as ReactLeaflet from 'react-leaflet'

import GameMap from '@/components/map/GameMap'
import SetupMap from '@/components/map/SetupMap'
import ObserverMap from '@/app/observer/[code]/ObserverMap'
import { haversineMeters } from '@/lib/geo/haversine'
import {
  getPlayAreaNavigationBounds,
  PLAY_AREA_CENTRE,
  PLAY_AREA_MAP_MIN_ZOOM,
} from '@/lib/geo/playArea'
import type { GpsPosition } from '@/lib/types'
import { makeTeam, renderWithProviders } from '../test-utils'

jest.mock('leaflet', () => ({
  __esModule: true,
  default: {
    divIcon: jest.fn((options: unknown) => options),
  },
}))

jest.mock('@/components/map/LibertyBasemap', () => ({
  LibertyBasemap: () => null,
}))

jest.mock('react-leaflet', () => {
  const React = jest.requireActual<typeof import('react')>('react')
  const map = {
    flyToBounds: jest.fn(),
    setView: jest.fn(),
  }
  const passthrough = ({ children }: { children?: ReactNode }) =>
    React.createElement(React.Fragment, null, children)

  return {
    MapContainer: jest.fn(({ children }: { children?: ReactNode }) =>
      React.createElement('div', { 'data-testid': 'map-container' }, children),
    ),
    CircleMarker: jest.fn(({ children }: { children?: ReactNode }) =>
      React.createElement('div', { 'data-testid': 'circle-marker' }, children),
    ),
    Circle: jest.fn(passthrough),
    Marker: jest.fn(passthrough),
    Polygon: jest.fn(passthrough),
    Tooltip: jest.fn(({ children }: { children?: ReactNode }) =>
      React.createElement('span', { 'data-testid': 'tooltip' }, children),
    ),
    Popup: jest.fn(passthrough),
    useMap: () => map,
    useMapEvents: () => map,
  }
})

interface MockMapContainerProps {
  maxBounds?: [[number, number], [number, number]]
  maxBoundsViscosity?: number
  minZoom?: number
  bounceAtZoomLimits?: boolean
  children?: ReactNode
}

interface MockCircleMarkerProps {
  center: [number, number]
  pathOptions?: {
    fillColor?: string
  }
  children?: ReactNode
}

interface MockPolygonProps {
  pathOptions?: {
    fillOpacity?: number
    stroke?: boolean
  }
  children?: ReactNode
}

const mapContainerMock = ReactLeaflet.MapContainer as unknown as jest.Mock<
  ReactElement,
  [MockMapContainerProps]
>
const circleMarkerMock = ReactLeaflet.CircleMarker as unknown as jest.Mock<
  ReactElement,
  [MockCircleMarkerProps]
>
const polygonMock = ReactLeaflet.Polygon as unknown as jest.Mock<
  ReactElement,
  [MockPolygonProps]
>

function renderMap(
  myGps: GpsPosition | null,
  language: 'en' | 'pt' = 'en',
  wallNowMs: number = Date.now(),
) {
  const myTeam = makeTeam({ home_landmark_id: null })
  const enemyTeam = makeTeam({
    id: 'team-east',
    name: 'Team East',
    side: 'east',
    home_landmark_id: null,
  })

  return renderWithProviders(
    <GameMap
      myTeamLandmarks={[]}
      enemyLandmarks={[]}
      myTeam={myTeam}
      enemyTeam={enemyTeam}
      myGps={myGps}
      presence={{}}
      myPlayerId="player-west"
      wallNowMs={wallNowMs}
    />,
    { language },
  )
}

describe('GameMap navigation barrier', () => {
  beforeEach(() => {
    mapContainerMock.mockClear()
    circleMarkerMock.mockClear()
    polygonMock.mockClear()
  })

  it('gives Leaflet fixed, fully viscous bounds and a minimum zoom', () => {
    renderMap(null)

    const props = mapContainerMock.mock.calls[0][0]
    expect(props.maxBounds).toEqual(getPlayAreaNavigationBounds())
    expect(props.maxBoundsViscosity).toBe(1)
    expect(props.minZoom).toBe(PLAY_AREA_MAP_MIN_ZOOM)
    expect(props.bounceAtZoomLimits).toBe(false)
  })

  it('renders the same opaque navigation mask on live, setup and observer maps', () => {
    const hasOpaqueBarrier = () =>
      polygonMock.mock.calls.some(
        ([props]) => props.pathOptions?.fillOpacity === 1 && props.pathOptions?.stroke === false,
      )

    const live = renderMap(null)
    expect(hasOpaqueBarrier()).toBe(true)
    live.unmount()

    polygonMock.mockClear()
    const setup = renderWithProviders(
      <SetupMap
        mySide="west"
        myHomeRef={null}
        selections={new Map()}
        poolIds={[]}
        selectedRef={null}
        onSelectLandmark={jest.fn()}
      />,
    )
    expect(hasOpaqueBarrier()).toBe(true)
    setup.unmount()

    polygonMock.mockClear()
    const observer = renderWithProviders(<ObserverMap landmarks={[]} teams={[]} />)
    expect(hasOpaqueBarrier()).toBe(true)
    observer.unmount()
  })

  it('projects a far-away player onto the red recovery-edge marker', async () => {
    const realGps: GpsPosition = {
      lat: PLAY_AREA_CENTRE.lat + 5_000 / 111_320,
      lng: PLAY_AREA_CENTRE.lng,
      accuracy: 8,
      updated_at: Date.now(),
    }
    renderMap(realGps, 'pt')

    const marker = circleMarkerMock.mock.calls
      .map(([props]) => props)
      .find((props) => props.pathOptions?.fillColor === '#ef4444')

    expect(marker).toBeDefined()
    const [lat, lng] = marker!.center
    const displayedDistanceM = haversineMeters(PLAY_AREA_CENTRE, { lat, lng })
    expect(displayedDistanceM).toBeGreaterThan(1_740)
    expect(displayedDistanceM).toBeLessThan(1_780)
    expect(haversineMeters(PLAY_AREA_CENTRE, realGps)).toBeGreaterThan(4_900)
    expect(lat).not.toBeCloseTo(realGps.lat, 4)
    expect(lng).toBeCloseTo(realGps.lng, 8)
    expect(await screen.findByText(/^Tu · 3\d{3} m fora$/)).toBeVisible()
  })

  it('does not turn a stale far-away fix into an out-of-bounds alarm', () => {
    const nowMs = Date.now()
    renderMap(
      {
        lat: PLAY_AREA_CENTRE.lat + 5_000 / 111_320,
        lng: PLAY_AREA_CENTRE.lng,
        accuracy: 8,
        updated_at: nowMs - 31_000,
      },
      'en',
      nowMs,
    )

    const selfMarkers = circleMarkerMock.mock.calls
      .map(([props]) => props)
      .filter((props) => ['#ef4444', '#22d3ee'].includes(props.pathOptions?.fillColor ?? ''))
    const redMarker = selfMarkers.find((props) => props.pathOptions?.fillColor === '#ef4444')
    expect(redMarker).toBeUndefined()
    expect(selfMarkers).toHaveLength(0)
    expect(screen.queryByText(/outside/i)).not.toBeInTheDocument()
  })

  it('hides a fresh but unusably imprecise fix near the play area', () => {
    renderMap({
      ...PLAY_AREA_CENTRE,
      accuracy: 500,
      updated_at: Date.now(),
    })

    const selfMarkers = circleMarkerMock.mock.calls
      .map(([props]) => props)
      .filter((props) => ['#ef4444', '#22d3ee'].includes(props.pathOptions?.fillColor ?? ''))
    expect(selfMarkers).toHaveLength(0)
  })
})
