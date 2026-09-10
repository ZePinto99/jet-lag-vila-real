import { distanceToPolylineMeters } from '@/lib/geo/polyline'

describe('distanceToPolylineMeters', () => {
  const street = [
    { lat: 41.295, lng: -7.746 },
    { lat: 41.296, lng: -7.746 },
  ]

  it('returns zero for a point on the street segment', () => {
    expect(distanceToPolylineMeters({ lat: 41.2955, lng: -7.746 }, street)).toBeCloseTo(0, 3)
  })

  it('uses the nearest point on a segment and clamps beyond its endpoints', () => {
    const beside = distanceToPolylineMeters({ lat: 41.2955, lng: -7.7454 }, street)
    const beyond = distanceToPolylineMeters({ lat: 41.2962, lng: -7.746 }, street)
    expect(beside).toBeGreaterThan(49)
    expect(beside).toBeLessThan(52)
    expect(beyond).toBeGreaterThan(21)
    expect(beyond).toBeLessThan(23)
  })

  it('returns infinity for an absent geometry', () => {
    expect(distanceToPolylineMeters({ lat: 41.2955, lng: -7.746 }, [])).toBe(
      Number.POSITIVE_INFINITY,
    )
  })
})
