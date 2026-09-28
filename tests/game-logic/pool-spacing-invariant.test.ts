import landmarks from '@/data/landmarks.json'
import { haversineMeters } from '@/lib/geo/haversine'
import { DEFENSE_ZONE_RADIUS_M } from '@/lib/geo/zones'

// LOAD-BEARING BALANCE INVARIANT — discovered while hunting for a degenerate
// "all 5 candidates clustered" layout (tools/sim/scenario-degenerate.mjs).
//
// A team's defense zone is the union of 200 m circles around its 5 chosen
// candidates (RULEBOOK §6). If two pool members sat within 200 m of each other,
// a single standing defender would cover both objectives at once — and a pool
// tight enough to cluster all five would let one player cover everything,
// reducing raiding to a coin flip on where that defender happened to stand.
//
// The curated pools prevent this: no pool member has ANY other member of the
// same pool within 200 m, so a defender must physically commit to one candidate
// and raiders always have an uncovered approach.
//
// This is undocumented and easy to break by adding a landmark, so it is pinned
// here rather than left as an emergent property.

interface SeedLandmark {
  id: string
  name: string
  lat: number
  lng: number
  team_pool: string
}

const pools = ['west', 'east'] as const
const byPool = (pool: string) =>
  (landmarks as SeedLandmark[]).filter((l) => l.team_pool === pool)

describe('landmark pool spacing invariant', () => {
  it.each(pools)('%s pool: no two candidates sit within one defense-zone radius', (pool) => {
    const members = byPool(pool)
    expect(members.length).toBeGreaterThanOrEqual(5)

    const violations: string[] = []
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const d = haversineMeters(members[i], members[j])
        if (d <= DEFENSE_ZONE_RADIUS_M) {
          violations.push(
            `${members[i].id} <-> ${members[j].id} = ${Math.round(d)} m (<= ${DEFENSE_ZONE_RADIUS_M} m)`,
          )
        }
      }
    }
    expect(violations).toEqual([])
  })

  it.each(pools)('%s pool: the tightest legal 5-pick still spans a real walk', (pool) => {
    const members = byPool(pool)
    // Exhaustive over all 5-subsets: find the minimum achievable max-pairwise
    // spread. If this ever drops near the defense-zone radius, one defender
    // starts covering the whole objective set.
    const combos = (arr: number[], k: number): number[][] =>
      k === 0
        ? [[]]
        : arr.flatMap((v, i) => combos(arr.slice(i + 1), k - 1).map((c) => [v, ...c]))

    let tightest = Infinity
    for (const set of combos([...members.keys()], 5)) {
      let widest = 0
      for (let i = 0; i < set.length; i++) {
        for (let j = i + 1; j < set.length; j++) {
          widest = Math.max(widest, haversineMeters(members[set[i]], members[set[j]]))
        }
      }
      tightest = Math.min(tightest, widest)
    }

    // Measured: West 771 m, East 621 m. Guard well below both so a small pool
    // edit is allowed but a clustering one fails loudly.
    expect(tightest).toBeGreaterThan(400)
  })

  it('home bases are inside their own pools (RULEBOOK §3.3)', () => {
    // Relied on by the "flag on own home base" case, which is legal.
    expect(byPool('west').map((l) => l.id)).toContain('landmark.miradouro-vila-velha')
    expect(byPool('east').map((l) => l.id)).toContain('landmark.biblioteca-municipal')
  })

  it('every pool offers strictly more than the 5 picks a team must make', () => {
    // Otherwise the "secret" assignment leaks: with exactly 5 options the enemy
    // knows the full candidate set before the game starts.
    for (const pool of pools) {
      expect(byPool(pool).length).toBeGreaterThan(5)
    }
  })
})
