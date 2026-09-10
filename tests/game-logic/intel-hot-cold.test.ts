/** @jest-environment node */

import { buildHotColdAnswer, hotColdBucket } from '@/lib/intel/answers'
import { sanitizeIntelCard } from '@/lib/intel/sanitize'
import { makeCard } from '../test-utils'

describe('Hot/Cold privacy and purchase-time semantics', () => {
  it('uses stable bucket boundaries', () => {
    expect(hotColdBucket(199.999)).toBe('under_200m')
    expect(hotColdBucket(200)).toBe('under_500m')
    expect(hotColdBucket(500)).toBe('under_1km')
    expect(hotColdBucket(1000)).toBe('over_1km')
  })

  it('builds a purchase answer without target coordinates', () => {
    const answer = buildHotColdAnswer(
      { lat: 41.295, lng: -7.746 },
      { lat: 41.296, lng: -7.746 },
    )
    expect(answer).toMatchObject({
      intel_ref: 'intel.hot-cold',
      bucket: 'under_200m',
      buy_position: { lat: 41.295, lng: -7.746 },
    })
    expect(answer).not.toHaveProperty('target')
  })

  it('strips a target injected into a legacy live-state card', () => {
    const card = makeCard({
      ref: 'intel.hot-cold',
      payload: {
        intel_ref: 'intel.hot-cold',
        bucket: 'under_500m',
        buy_position: { lat: 41.295, lng: -7.746 },
        target: { lat: 41.299, lng: -7.74 },
      },
    })
    expect(sanitizeIntelCard(card).payload).not.toHaveProperty('target')
  })
})
