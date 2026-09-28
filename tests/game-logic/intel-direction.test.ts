import { PLAY_AREA_CENTRE } from '@/lib/geo/playArea'
import {
  compass4FromPoint,
  compass8FromPoint,
  initialBearingDegrees,
  snapToCompass4,
  snapToCompass8,
} from '@/lib/intel/direction'

describe('canonical intel direction geometry', () => {
  it('uses the post-redesign Avenida play centre for stable bearings', () => {
    expect(PLAY_AREA_CENTRE).toEqual({ lat: 41.2955, lng: -7.7461 })
    expect(compass8FromPoint(PLAY_AREA_CENTRE, { lat: 41.3055, lng: -7.7461 })).toBe('N')
    expect(compass8FromPoint(PLAY_AREA_CENTRE, { lat: 41.2955, lng: -7.7361 })).toBe('E')
    expect(compass8FromPoint(PLAY_AREA_CENTRE, { lat: 41.2855, lng: -7.7561 })).toBe('SW')
  })

  it('keeps exact compass sector boundaries deterministic', () => {
    expect(snapToCompass8(22.49)).toBe('N')
    expect(snapToCompass8(22.5)).toBe('NE')
    expect(snapToCompass8(337.5)).toBe('N')
    expect(initialBearingDegrees({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(90)
  })

  it('uses four broad directions for newly purchased Direction intel', () => {
    expect(snapToCompass4(44.99)).toBe('N')
    expect(snapToCompass4(45)).toBe('E')
    expect(snapToCompass4(134.99)).toBe('E')
    expect(snapToCompass4(135)).toBe('S')
    expect(compass4FromPoint(PLAY_AREA_CENTRE, { lat: 41.2855, lng: -7.7561 })).toBe('S')
  })
})
