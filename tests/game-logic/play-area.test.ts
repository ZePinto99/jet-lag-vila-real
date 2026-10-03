import {
  getMapDisplayPosition,
  getPlayAreaBounds,
  getPlayAreaNavigationBounds,
  getPlayAreaReturnPoint,
  getPlayAreaState,
  getPlayAreaStateForGps,
  PLAY_AREA_CENTRE,
  PLAY_AREA_NAVIGATION_BUFFER_M,
  PLAY_AREA_NAVIGATION_RADIUS_M,
  PLAY_AREA_RADIUS_M,
  PLAY_AREA_WARN_MARGIN_M,
} from '@/lib/geo/playArea'
import { haversineMeters } from '@/lib/geo/haversine'

const EARTH_RADIUS_M = 6_371_000

// Move `metres` north of the centre — enough to cross the boundary cleanly
// without depending on longitude scaling at this latitude.
function northOfCentre(metres: number) {
  return {
    lat: PLAY_AREA_CENTRE.lat + metres / 111_320,
    lng: PLAY_AREA_CENTRE.lng,
  }
}

function pointAtBearing(metres: number, bearingDegrees: number) {
  const distanceRadians = metres / EARTH_RADIUS_M
  const bearing = (bearingDegrees * Math.PI) / 180
  const lat1 = (PLAY_AREA_CENTRE.lat * Math.PI) / 180
  const lng1 = (PLAY_AREA_CENTRE.lng * Math.PI) / 180
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distanceRadians) +
      Math.cos(lat1) * Math.sin(distanceRadians) * Math.cos(bearing),
  )
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(distanceRadians) * Math.cos(lat1),
      Math.cos(distanceRadians) - Math.sin(lat1) * Math.sin(lat2),
    )
  return { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI }
}

function bearingFromCentre(point: { lat: number; lng: number }) {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180
  const lat1 = toRad(PLAY_AREA_CENTRE.lat)
  const lat2 = toRad(point.lat)
  const deltaLng = toRad(point.lng - PLAY_AREA_CENTRE.lng)
  const y = Math.sin(deltaLng) * Math.cos(lat2)
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng)
  return (Math.atan2(y, x) * 180) / Math.PI
}

function expectInsideBounds(
  point: { lat: number; lng: number },
  bounds: [[number, number], [number, number]],
) {
  expect(point.lat).toBeGreaterThanOrEqual(bounds[0][0])
  expect(point.lat).toBeLessThanOrEqual(bounds[1][0])
  expect(point.lng).toBeGreaterThanOrEqual(bounds[0][1])
  expect(point.lng).toBeLessThanOrEqual(bounds[1][1])
}

describe('getPlayAreaState (RULEBOOK §12.1 out-of-bounds warnings)', () => {
  it('reports inside well within the disk', () => {
    const state = getPlayAreaState(northOfCentre(200))
    expect(state.status).toBe('inside')
    expect(state.overshootM).toBe(0)
    expect(state.marginM).toBeGreaterThan(PLAY_AREA_WARN_MARGIN_M)
  })

  it('reports inside at the centre itself', () => {
    const state = getPlayAreaState(PLAY_AREA_CENTRE)
    expect(state.status).toBe('inside')
    expect(Math.round(state.distanceM)).toBe(0)
    expect(Math.round(state.marginM)).toBe(PLAY_AREA_RADIUS_M)
  })

  it('warns near the edge once inside the warn margin', () => {
    // 100 m inside the boundary => margin 100 <= 150, so near_edge.
    const state = getPlayAreaState(northOfCentre(PLAY_AREA_RADIUS_M - 100))
    expect(state.status).toBe('near_edge')
    expect(state.overshootM).toBe(0)
    expect(Math.round(state.marginM)).toBeGreaterThan(90)
    expect(Math.round(state.marginM)).toBeLessThan(110)
  })

  it('is still inside just beyond the warn margin', () => {
    const state = getPlayAreaState(
      northOfCentre(PLAY_AREA_RADIUS_M - PLAY_AREA_WARN_MARGIN_M - 40),
    )
    expect(state.status).toBe('inside')
  })

  it('reports outside past the boundary, with the walk-back distance', () => {
    const state = getPlayAreaState(northOfCentre(PLAY_AREA_RADIUS_M + 250))
    expect(state.status).toBe('outside')
    expect(state.marginM).toBe(0)
    expect(Math.round(state.overshootM)).toBeGreaterThan(200)
    expect(Math.round(state.overshootM)).toBeLessThan(300)
  })

  it('treats the boundary itself as not yet outside', () => {
    // Sit a metre inside the radius: must never read as outside.
    const state = getPlayAreaState(northOfCentre(PLAY_AREA_RADIUS_M - 1))
    expect(state.status).not.toBe('outside')
    expect(state.overshootM).toBe(0)
  })

  it('measures distance consistently with haversine', () => {
    const p = northOfCentre(900)
    const state = getPlayAreaState(p)
    expect(state.distanceM).toBeCloseTo(haversineMeters(p, PLAY_AREA_CENTRE), 6)
  })

  it('honours injected centre and radius', () => {
    const centre = { lat: 41.3, lng: -7.74 }
    const state = getPlayAreaState({ lat: 41.3, lng: -7.74 }, centre, 100)
    expect(state.status).toBe('near_edge') // margin 100 <= 150 warn margin
    expect(Math.round(state.marginM)).toBe(100)
  })
})

describe('play-area map navigation bounds', () => {
  it('keeps the gameplay disk distinct from the fixed navigation buffer', () => {
    expect(PLAY_AREA_NAVIGATION_BUFFER_M).toBe(300)
    expect(PLAY_AREA_NAVIGATION_RADIUS_M).toBe(
      PLAY_AREA_RADIUS_M + PLAY_AREA_NAVIGATION_BUFFER_M,
    )

    const gameBounds = getPlayAreaBounds()
    const navigationBounds = getPlayAreaNavigationBounds()

    expect(navigationBounds).toEqual(getPlayAreaBounds(PLAY_AREA_NAVIGATION_RADIUS_M))
    expect(navigationBounds[0][0]).toBeLessThan(gameBounds[0][0])
    expect(navigationBounds[0][1]).toBeLessThan(gameBounds[0][1])
    expect(navigationBounds[1][0]).toBeGreaterThan(gameBounds[1][0])
    expect(navigationBounds[1][1]).toBeGreaterThan(gameBounds[1][1])

    expect(
      haversineMeters(PLAY_AREA_CENTRE, {
        lat: gameBounds[1][0],
        lng: PLAY_AREA_CENTRE.lng,
      }),
    ).toBeCloseTo(PLAY_AREA_RADIUS_M, -1)
    expect(
      haversineMeters(PLAY_AREA_CENTRE, {
        lat: navigationBounds[1][0],
        lng: PLAY_AREA_CENTRE.lng,
      }),
    ).toBeCloseTo(PLAY_AREA_NAVIGATION_RADIUS_M, -1)
  })

  it.each([
    ['inside the game disk', 600],
    ['in the recovery ring', PLAY_AREA_RADIUS_M + 150],
  ])('leaves a point %s unchanged', (_label, distanceM) => {
    const position = pointAtBearing(distanceM, 38)
    const display = getMapDisplayPosition(position)

    expect(display.isClamped).toBe(false)
    expect(display.lat).toBeCloseTo(position.lat, 10)
    expect(display.lng).toBeCloseTo(position.lng, 10)
    expect(display.distanceM).toBeCloseTo(distanceM, 5)
    expectInsideBounds(display, getPlayAreaNavigationBounds())
  })

  it('projects a far-away GPS fix to the map edge without expanding navigation bounds', () => {
    const navigationBounds = getPlayAreaNavigationBounds()
    const position = pointAtBearing(5_000, 38)
    const display = getMapDisplayPosition(position)
    const displayedDistanceM = haversineMeters(PLAY_AREA_CENTRE, display)

    expect(display.isClamped).toBe(true)
    expect(display.distanceM).toBeCloseTo(5_000, 5)
    expect(displayedDistanceM).toBeGreaterThan(1_740)
    expect(displayedDistanceM).toBeLessThan(1_780)
    expect(bearingFromCentre(display)).toBeCloseTo(bearingFromCentre(position), 3)
    expectInsideBounds(display, navigationBounds)
    expect(getPlayAreaNavigationBounds()).toEqual(navigationBounds)
  })

  it('starts projecting before the marker reaches the opaque edge', () => {
    const position = pointAtBearing(1_780, 38)
    const display = getMapDisplayPosition(position)

    expect(display.isClamped).toBe(true)
    expect(haversineMeters(PLAY_AREA_CENTRE, display)).toBeGreaterThan(1_740)
    expect(haversineMeters(PLAY_AREA_CENTRE, display)).toBeLessThan(1_780)
  })

  it('returns an outside player to a point just inside the game disk on the same bearing', () => {
    const position = pointAtBearing(5_000, 38)
    const target = getPlayAreaReturnPoint(position)
    const targetDistanceM = haversineMeters(PLAY_AREA_CENTRE, target)

    expect(targetDistanceM).toBeGreaterThan(1_440)
    expect(targetDistanceM).toBeLessThan(1_460)
    expect(bearingFromCentre(target)).toBeCloseTo(bearingFromCentre(position), 3)
    expect(getPlayAreaState(target).status).not.toBe('outside')
  })
})

describe('confidence-aware GPS boundary state', () => {
  it('does not call a straddling accuracy circle outside', () => {
    const state = getPlayAreaStateForGps({
      ...northOfCentre(PLAY_AREA_RADIUS_M + 10),
      accuracy: 70,
    })

    expect(state?.status).toBe('near_edge')
    expect(state?.overshootM).toBe(0)
  })

  it('still warns when an imprecise fix is provably far outside', () => {
    const state = getPlayAreaStateForGps({
      ...northOfCentre(5_000),
      accuracy: 76,
    })

    expect(state?.status).toBe('outside')
    expect(state?.overshootM).toBeGreaterThan(3_300)
  })

  it('ignores a very imprecise fix that could still be inside', () => {
    expect(
      getPlayAreaStateForGps({
        ...PLAY_AREA_CENTRE,
        accuracy: 500,
      }),
    ).toBeNull()
  })

  it('uses hysteresis so metre-scale jitter does not flash red and amber', () => {
    const near = getPlayAreaStateForGps({
      ...northOfCentre(PLAY_AREA_RADIUS_M - 20),
      accuracy: 0,
    })
    expect(near?.status).toBe('near_edge')

    const jitterOutside = getPlayAreaStateForGps(
      { ...northOfCentre(PLAY_AREA_RADIUS_M + 5), accuracy: 0 },
      undefined,
      undefined,
      near?.status,
    )
    expect(jitterOutside?.status).toBe('near_edge')

    const confidentlyOutside = getPlayAreaStateForGps(
      { ...northOfCentre(PLAY_AREA_RADIUS_M + 25), accuracy: 0 },
      undefined,
      undefined,
      jitterOutside?.status,
    )
    expect(confidentlyOutside?.status).toBe('outside')

    const jitterInside = getPlayAreaStateForGps(
      { ...northOfCentre(PLAY_AREA_RADIUS_M - 5), accuracy: 0 },
      undefined,
      undefined,
      confidentlyOutside?.status,
    )
    expect(jitterInside?.status).toBe('outside')

    const confidentlyInside = getPlayAreaStateForGps(
      { ...northOfCentre(PLAY_AREA_RADIUS_M - 25), accuracy: 0 },
      undefined,
      undefined,
      jitterInside?.status,
    )
    expect(confidentlyInside?.status).toBe('near_edge')
  })

  it('does not discard a previous good state for a one-metre accuracy wobble', () => {
    const state = getPlayAreaStateForGps(
      { ...PLAY_AREA_CENTRE, accuracy: 251 },
      undefined,
      undefined,
      'inside',
    )
    expect(state?.status).toBe('inside')
    expect(
      getPlayAreaStateForGps(
        { ...PLAY_AREA_CENTRE, accuracy: 301 },
        undefined,
        undefined,
        'inside',
      ),
    ).toBeNull()
  })
})
