/** @jest-environment node */

import {
  PLAY_AREA_CENTRE,
  PLAY_AREA_RADIUS_M,
  getIntelOverlays,
  getOutOfBoundsOverlay,
} from '@/lib/intel/overlays'
import { makeCard } from '../test-utils'

describe('intel overlays', () => {
  it('builds an out-of-bounds world overlay with the play-area disk as a hole', () => {
    const overlay = getOutOfBoundsOverlay()
    expect(PLAY_AREA_CENTRE).toEqual({ lat: 41.2955, lng: -7.7461 })
    expect(PLAY_AREA_RADIUS_M).toBe(1500)
    expect(overlay.rings).toHaveLength(2)
    expect(overlay.reason).toBe('Out of play area')
    expect(overlay.rings[1]).toHaveLength(97)
  })

  it('creates north/south half-plane overlays only for in-hand intel', () => {
    const overlays = getIntelOverlays([
      makeCard({ payload: { intel_ref: 'intel.north-south', direction: 'north' } }),
      makeCard({ id: 'expired', state: 'expired', payload: { intel_ref: 'intel.north-south', direction: 'south' } }),
    ], -7.746)

    expect(overlays).toHaveLength(1)
    expect(overlays[0].reason).toContain('not north')
  })

  it('skips east/west overlays until home longitude is known', () => {
    const card = makeCard({
      payload: { intel_ref: 'intel.east-west', direction: 'west' },
    })

    expect(getIntelOverlays([card], null)).toEqual([])
    expect(getIntelOverlays([card], -7.746)).toHaveLength(1)
  })

  it('creates complement overlays for bounded hot/cold buckets', () => {
    const overlays = getIntelOverlays([
      makeCard({
        payload: {
          intel_ref: 'intel.hot-cold',
          bucket: 'under_1km',
          buy_position: { lat: 41.295, lng: -7.746 },
        },
      }),
    ], -7.746)

    expect(overlays).toHaveLength(2)
    expect(overlays.map((o) => o.reason)).toEqual([
      'Ruled out: > 1000 m from buy position',
      'Ruled out: < 500 m from buy position',
    ])
  })
})
