/** @jest-environment node */

import { haversineMeters } from '@/lib/geo/haversine'

describe('haversineMeters', () => {
  it('returns 0 for the same coordinate', () => {
    expect(haversineMeters({ lat: 41.295, lng: -7.746 }, { lat: 41.295, lng: -7.746 })).toBe(0)
  })

  it('computes short walking distances in metres', () => {
    // RULEBOOK §6: tag and geofence checks depend on metre-level distances.
    const d = haversineMeters(
      { lat: 41.295, lng: -7.746 },
      { lat: 41.29509, lng: -7.746 },
    )
    expect(d).toBeGreaterThan(9)
    expect(d).toBeLessThan(11)
  })

  it('is symmetric', () => {
    const a = { lat: 41.2867, lng: -7.7399 }
    const b = { lat: 41.3002, lng: -7.7444 }
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 8)
  })
})
