/** @jest-environment node */

import { DEFENSE_ZONE_RADIUS_M, isInDefenseZone } from '@/lib/geo/zones'

describe('isInDefenseZone', () => {
  const ownCandidate = { lat: 41.295, lng: -7.746 }

  it('treats a player within 200 m of an own candidate as a defender', () => {
    // RULEBOOK §6: defenders are inside a 200 m radius around any own candidate.
    expect(isInDefenseZone({ lat: 41.2959, lng: -7.746 }, [ownCandidate])).toBe(true)
  })

  it('treats the exact radius boundary as inside', () => {
    const nearlyBoundary = { lat: 41.295 + DEFENSE_ZONE_RADIUS_M / 111_195, lng: -7.746 }
    expect(isInDefenseZone(nearlyBoundary, [ownCandidate])).toBe(true)
  })

  it('returns false outside every own candidate zone', () => {
    expect(isInDefenseZone({ lat: 41.299, lng: -7.746 }, [ownCandidate])).toBe(false)
  })

  it('returns false when the team has no candidates', () => {
    expect(isInDefenseZone(ownCandidate, [])).toBe(false)
  })
})
