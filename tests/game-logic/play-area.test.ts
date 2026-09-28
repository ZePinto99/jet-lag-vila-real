import {
  getPlayAreaState,
  PLAY_AREA_CENTRE,
  PLAY_AREA_RADIUS_M,
  PLAY_AREA_WARN_MARGIN_M,
} from '@/lib/geo/playArea'
import { haversineMeters } from '@/lib/geo/haversine'

// Move `metres` north of the centre — enough to cross the boundary cleanly
// without depending on longitude scaling at this latitude.
function northOfCentre(metres: number) {
  return {
    lat: PLAY_AREA_CENTRE.lat + metres / 111_320,
    lng: PLAY_AREA_CENTRE.lng,
  }
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
