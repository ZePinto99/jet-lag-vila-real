/** @jest-environment node */

import { computeNarrowedRefs } from '@/lib/intel/narrowing'
import type { Card, EnemyLandmark, SeedLandmark } from '@/lib/types'
import { makeCard } from '../test-utils'

const enemyLandmarks: EnemyLandmark[] = [
  { id: 'a', ref: 'enemy.north', lat: 41.299, lng: -7.74, team_id: 'east' },
  { id: 'b', ref: 'enemy.south', lat: 41.291, lng: -7.75, team_id: 'east' },
  { id: 'c', ref: 'enemy.east', lat: 41.295, lng: -7.72, team_id: 'east' },
]

const seedLookup = (ref: string): SeedLandmark | null => ({
  id: ref,
  name: ref,
  lat: 41.295,
  lng: -7.746,
  team_pool: 'east',
  kind: 'candidate',
  approximate: false,
  source: 'test',
})

describe('computeNarrowedRefs', () => {
  it('ignores non-intel cards and expired intel', () => {
    const cards = [
      makeCard({ kind: 'challenge', payload: {} }),
      makeCard({ state: 'expired', payload: { intel_ref: 'intel.eliminate-one', not_real: { ref: 'enemy.north', name: 'North' } } }),
    ]

    expect(
      computeNarrowedRefs({ intelCards: cards, enemyLandmarks, myTeamHomeLng: -7.746, seedLookup }),
    ).toEqual(new Set())
  })

  it('rules out the wrong side for north/south intel', () => {
    // RULEBOOK §8: intel cards progressively eliminate enemy candidates.
    const card = makeCard({
      payload: { intel_ref: 'intel.north-south', direction: 'north' },
    })

    expect(
      computeNarrowedRefs({ intelCards: [card], enemyLandmarks, myTeamHomeLng: -7.746, seedLookup }),
    ).toEqual(new Set(['enemy.south', 'enemy.east']))
  })

  it('uses home longitude for east/west intel and skips when missing', () => {
    const card = makeCard({
      payload: { intel_ref: 'intel.east-west', direction: 'east' },
    })

    expect(
      computeNarrowedRefs({ intelCards: [card], enemyLandmarks, myTeamHomeLng: null, seedLookup }),
    ).toEqual(new Set())
    expect(
      computeNarrowedRefs({ intelCards: [card], enemyLandmarks, myTeamHomeLng: -7.746, seedLookup }),
    ).toEqual(new Set(['enemy.south']))
  })

  it('combines eliminate-one, eliminate-two, and decoy reveal answers', () => {
    const cards: Card[] = [
      makeCard({ id: 'one', payload: { intel_ref: 'intel.eliminate-one', not_real: { ref: 'enemy.north', name: 'North' } } }),
      makeCard({ id: 'two', payload: { intel_ref: 'intel.eliminate-two', not_real: [{ ref: 'enemy.south', name: 'South' }] } }),
      makeCard({ id: 'decoy', payload: { intel_ref: 'intel.decoy-reveal', decoy: { ref: 'enemy.east', name: 'East' } } }),
    ]

    expect(
      computeNarrowedRefs({ intelCards: cards, enemyLandmarks, myTeamHomeLng: -7.746, seedLookup }),
    ).toEqual(new Set(['enemy.north', 'enemy.south', 'enemy.east']))
  })

  it('rules out landmarks outside the hot/cold bucket', () => {
    const card = makeCard({
      payload: {
        intel_ref: 'intel.hot-cold',
        bucket: 'under_200m',
        buy_position: { lat: 41.295, lng: -7.746 },
      },
    })

    expect(
      computeNarrowedRefs({ intelCards: [card], enemyLandmarks, myTeamHomeLng: -7.746, seedLookup }),
    ).toEqual(new Set(['enemy.north', 'enemy.south', 'enemy.east']))
  })

  it('leaves surroundings text as non-mechanical intel', () => {
    const card = makeCard({
      payload: { intel_ref: 'intel.surroundings', text: 'near stone' },
    })

    expect(
      computeNarrowedRefs({ intelCards: [card], enemyLandmarks, myTeamHomeLng: -7.746, seedLookup }),
    ).toEqual(new Set())
  })
})
