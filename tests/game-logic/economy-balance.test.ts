/** @jest-environment node */

// Balance decisions taken on the SIM_EVALUATION findings P1/P16 (intel cap),
// P4 (intel pricing), P9 (harden phase) and P10 (challenge geofence).
//
// These pin the VALUES and the invariants that justify them, so a later tweak
// to data/intel.json or lib/gameConstants.ts cannot silently undo the decision.
// The route/RPC behaviour itself is exercised by tools/sim/scenario-*.mjs.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import intel from '@/data/intel.json'
import challenges from '@/data/challenges.json'
import landmarks from '@/data/landmarks.json'
import { haversineMeters } from '@/lib/geo/haversine'
import {
  CHALLENGE_GEOFENCE_M,
  HARDEN_COST,
  INTEL_CAP,
  STARTING_COINS,
} from '@/lib/gameConstants'

function routeSource(...segments: string[]): string {
  return readFileSync(join(process.cwd(), ...segments), 'utf8')
}

const costOf = (id: string): number => {
  const card = intel.find((entry) => entry.id === id)
  if (!card) throw new Error(`missing intel card ${id}`)
  return card.cost_coins
}

// ---------------------------------------------------------------------------
// P4 — intel pricing must be internally coherent
// ---------------------------------------------------------------------------

describe('P4 — intel pricing', () => {
  it('prices every card in the catalogue', () => {
    expect(intel.map((entry) => [entry.id, entry.cost_coins])).toEqual([
      ['intel.north-south', 30],
      ['intel.eliminate-one', 50],
      ['intel.eliminate-two', 80],
      ['intel.decoy-reveal', 45],
      ['intel.hot-cold', 60],
      ['intel.surroundings', 80],
      ['intel.direction', 50],
    ])
  })

  // The core defect: decoy-reveal used to cost 100 to rule out ONE candidate
  // while eliminate-one ruled out the same single candidate for 50, and
  // eliminate-two ruled out two for 80. Knowing a landmark is specifically a
  // decoy is a strict SUBSET of knowing it is not-real (and lib/intel/
  // narrowing.ts treats them identically), so it must cost strictly less than
  // eliminate-one or it is dominated again.
  it('keeps decoy-reveal strictly cheaper than eliminate-one', () => {
    expect(costOf('intel.decoy-reveal')).toBeLessThan(costOf('intel.eliminate-one'))
  })

  it('never lets a single-candidate card cost more per candidate than eliminate-two', () => {
    const perCandidate = costOf('intel.eliminate-two') / 2
    // eliminate-two rules out 2 refs for 80 => 40/ref. A card that rules out a
    // single ref may cost more per ref (it is more targeted) but decoy-reveal,
    // being the weakest single-ref card, must not be the worst deal on offer.
    expect(costOf('intel.decoy-reveal')).toBeLessThan(costOf('intel.eliminate-one'))
    expect(perCandidate).toBe(40)
  })

  // intel.direction narrows nothing mechanically (narrowing.ts leaves it as a
  // soft quadrant hint), and its own code comment reasons about a 50-coin
  // price. It had drifted to 80 while the comment stayed. Keep them in step.
  it('prices intel.direction at the figure its narrowing comment reasons about', () => {
    expect(costOf('intel.direction')).toBe(50)
    expect(readFileSync(join(process.cwd(), 'lib', 'intel', 'narrowing.ts'), 'utf8'))
      .toContain('50-coin card')
  })

  // Surroundings also narrows nothing mechanically, but a photo carries real
  // qualitative value a player can act on, so it stays dearer than direction.
  it('keeps surroundings dearer than direction despite neither narrowing', () => {
    expect(costOf('intel.surroundings')).toBeGreaterThan(costOf('intel.direction'))
  })

  it('matches the RULEBOOK §11 intel table', () => {
    const rulebook = readFileSync(join(process.cwd(), 'RULEBOOK.md'), 'utf8')
    expect(rulebook).toContain('| I4 | Decoy Reveal | Names one of the two decoys (does not reveal real) | 45 |')
    expect(rulebook).toMatch(/\| I7 \| Direction \|.*\| 50 \|/)
  })
})

// ---------------------------------------------------------------------------
// P3a — intel.east-west removed rather than repivoted
// ---------------------------------------------------------------------------

// The card answered E/W of the DEFENDER's home longitude. Measured against the
// real pools that is 6 east/1 west (West) and 1 east/6 west (East): 6 times in 7
// it eliminated exactly ONE candidate for 30 coins, which eliminate-one already
// does for 50 with no geometry to reason about. When a defender hid the real
// flag ON its own home the pivot equalled the target and it narrowed 4 of 5 —
// the cheapest card became the strongest, decided by the defender's choice
// (SIM_EVALUATION P3a). Pivoting on the BUYER's home was the original design and
// was already reverted: it measures 0/7 and 6/1, effectively a constant answer.
// No good pivot exists, so the card is gone rather than patched.
describe('P3a — intel.east-west is no longer purchasable', () => {
  it('is absent from the intel catalogue', () => {
    expect(intel.map((entry) => entry.id)).not.toContain('intel.east-west')
  })

  // The route looks the ref up in INTEL_BY_ID (built from data/intel.json) and
  // rejects a miss with invalid_intel_ref before any coin is touched, so
  // deleting the catalogue entry is what makes it unbuyable. Assert the compute
  // branch is gone too, so it cannot be revived by a stray catalogue re-add.
  it('has no compute branch left in the buy-intel route', () => {
    const route = routeSource('app', 'api', 'games', '[id]', 'buy-intel', 'route.ts')
    expect(route).not.toContain("case 'intel.east-west'")
  })

  // Deliberately NOT removed: the decode paths. Games played before the removal
  // still hold cards with this ref and `cards` is append-only in spirit, so an
  // old hand must still read back and narrow. See the dedicated coverage in
  // tests/game-logic/intel-narrowing.test.ts and intel-overlays.test.ts.
  it('keeps the historical decode branches so old hands still render', () => {
    expect(readFileSync(join(process.cwd(), 'lib', 'intel', 'narrowing.ts'), 'utf8'))
      .toContain("case 'intel.east-west'")
    expect(readFileSync(join(process.cwd(), 'lib', 'intel', 'overlays.ts'), 'utf8'))
      .toContain("case 'intel.east-west'")
  })

  // north-south is the clean half-the-map clue that survives: fixed per-pool
  // pivots tuned to split 3N/4S. Measured, east-west added only ONE extra
  // partition on top of it (2 groups -> 3) in both pools, so the deck loses
  // very little deductive depth.
  it('leaves north-south as the surviving half-split clue at the same price', () => {
    expect(costOf('intel.north-south')).toBe(30)
  })
})

// ---------------------------------------------------------------------------
// P1 / P16 — the intel cap counts held cards, not lifetime purchases
// ---------------------------------------------------------------------------

describe('P1/P16 — intel cap counts only cards not lost to an enemy action', () => {
  const route = routeSource('app', 'api', 'games', '[id]', 'buy-intel', 'route.ts')

  it('still caps a hand at 4', () => {
    expect(INTEL_CAP).toBe(4)
  })

  // The fix: the cap query filters to in_hand, so a card destroyed by a tag,
  // an Intel Loss curse, or a decoy wipe frees its slot. For intel, in_hand is
  // exactly "not lost to an enemy action" because intel is never consumed by
  // its owner.
  it('counts only in_hand cards against the cap', () => {
    expect(route).toContain("teamIntelCards.filter((c) => c.state === 'in_hand')")
    expect(route).toContain('heldIntelCards.length >= INTEL_CAP')
  })

  // The anti-farm guard that makes the looser cap safe. It MUST stay
  // state-agnostic: it is what stops a team rebuying a card it deliberately
  // lost. If this ever gains a `state` predicate, intel becomes churnable.
  it('keeps the duplicate-purchase guard state-agnostic', () => {
    expect(route).toContain("teamIntelCards.some((c) => c.ref === intel_ref)")
    expect(route).not.toMatch(/some\(\(c\) => c\.ref === intel_ref && c\.state/)
  })

  // With re-buying blocked, the lifetime ceiling is the catalogue, not infinity.
  // 7 since intel.east-west was removed (SIM_EVALUATION P3a); was 8, and 9
  // before I9 Landmark Type went.
  it('bounds lifetime intel by the catalogue size', () => {
    expect(intel).toHaveLength(7)
    expect(intel.map((entry) => entry.id)).toHaveLength(new Set(intel.map((e) => e.id)).size)
  })

  // P16: Intel Loss claims to "discard 1 random intel card". Under the old
  // any-state cap it also burned a purchase slot, exceeding its own text. The
  // freed slot is what makes the catalogue text truthful, so assert the
  // catalogue still promises only the card.
  it('leaves curse.intel-loss costing exactly one card, as its text says', () => {
    const curses = JSON.parse(
      readFileSync(join(process.cwd(), 'data', 'curses.json'), 'utf8'),
    ) as { id: string; description: string }[]
    const intelLoss = curses.find((entry) => entry.id === 'curse.intel-loss')
    expect(intelLoss?.description).toMatch(/1 random intel card/i)
  })
})

// ---------------------------------------------------------------------------
// P9 — hardening must be reachable when it is meaningful
// ---------------------------------------------------------------------------

describe('P9 — harden is available during setup', () => {
  const route = routeSource('app', 'api', 'games', '[id]', 'harden-flag', 'route.ts')

  it('accepts the setup phase as well as live', () => {
    expect(route).toContain("game.status !== 'setup' && game.status !== 'live'")
  })

  // The decision was explicitly NOT to reprice: a team still cannot harden at
  // T+0, so opening the phase gate does not make hardening free.
  it('does not make hardening affordable at kickoff', () => {
    expect(HARDEN_COST).toBe(150)
    expect(STARTING_COINS).toBeLessThan(HARDEN_COST)
  })

  // Hardening earlier must not leak which candidate is real. The enemy-facing
  // landmark projection in live-state must stay a fixed column list that
  // excludes `kind` and `hardened`.
  it('never exposes hardened or kind to the enemy in live-state', () => {
    const liveState = routeSource('app', 'api', 'games', '[id]', 'live-state', 'route.ts')
    expect(liveState).toContain("select('id, ref, lat, lng, team_id')")
  })

  // setup-state returns the caller's own rows plus an opaque done-count, so the
  // enemy learns nothing about hardening during setup.
  it('reduces the enemy setup view to a count', () => {
    const setupState = routeSource('app', 'api', 'games', '[id]', 'setup-state', 'route.ts')
    expect(setupState).toContain('other_team_done')
    expect(setupState).toContain("select('id')")
  })
})

// ---------------------------------------------------------------------------
// P10 — the challenge geofence must force a visit
// ---------------------------------------------------------------------------

describe('P10 — challenge geofence', () => {
  it('lives in gameConstants, not privately in the route', () => {
    expect(CHALLENGE_GEOFENCE_M).toBe(60)
    const route = routeSource('app', 'api', 'games', '[id]', 'submit-challenge', 'route.ts')
    expect(route).toContain("import { CHALLENGE_GEOFENCE_M } from '@/lib/gameConstants'")
    // No local re-declaration shadowing the shared constant.
    expect(route).not.toMatch(/const CHALLENGE_GEOFENCE_M\s*=/)
  })

  // The binding constraint. At 100 m several central challenges were mutually
  // claimable from one spot; the tightened radius must sit strictly below the
  // closest pair of distinct challenge landmarks, or two challenges could still
  // be claimed without moving.
  it('stays below the closest pair of distinct challenge landmarks', () => {
    const coordByRef = new Map(landmarks.map((entry) => [entry.id, entry]))
    const sites = challenges
      .filter((entry) => entry.landmark_ref !== null)
      .map((entry) => {
        const seed = coordByRef.get(entry.landmark_ref as string)
        if (!seed) throw new Error(`challenge ${entry.id} references unknown landmark`)
        return { id: entry.id, lat: seed.lat, lng: seed.lng }
      })

    let closest = Number.POSITIVE_INFINITY
    for (let i = 0; i < sites.length; i += 1) {
      for (let j = i + 1; j < sites.length; j += 1) {
        // Two challenges may legitimately share one landmark; only distinct
        // locations can create a double-claim.
        const separation = haversineMeters(sites[i], sites[j])
        if (separation > 0) closest = Math.min(closest, separation)
      }
    }

    // Sé Catedral <-> Largo do Pelourinho, ~60.6 m apart, is the tightest pair.
    expect(closest).toBeGreaterThan(CHALLENGE_GEOFENCE_M)
    expect(closest).toBeLessThan(65)
  })

  it('remains looser than a flag attempt but far tighter than the old 100 m', () => {
    expect(CHALLENGE_GEOFENCE_M).toBeGreaterThan(28)
    expect(CHALLENGE_GEOFENCE_M).toBeLessThan(100)
  })
})

// ---------------------------------------------------------------------------
// P6 — a failed curse roll stays free, but is neither silent nor a tier oracle
// ---------------------------------------------------------------------------

describe('P6 — no_available_curse is logged and no longer echoes the tier', () => {
  const route = routeSource('app', 'api', 'games', '[id]', 'buy-curse', 'route.ts')

  it('does not return the rolled tier to the prober', () => {
    expect(route).not.toContain("{ error: 'no_available_curse', details: { tier } }")
    expect(route).toContain("{ error: 'no_available_curse' }")
  })

  it('appends a curse_roll_failed event so the probe is attributable', () => {
    expect(route).toContain("type: 'curse_roll_failed'")
  })

  // The event must not itself become the leak: it carries the buyer's own team
  // and their own dice, never enemy coins/intel or the rolled tier.
  it('logs no enemy state and no tier in the event payload', () => {
    const start = route.indexOf("type: 'curse_roll_failed'")
    const payload = route.slice(start, route.indexOf('}', route.indexOf('payload:', start) + 200))
    expect(payload).toContain('team_id: buyerTeam.id')
    expect(payload).not.toContain('enemyTeam')
    expect(payload).not.toContain('tier')
    expect(payload).not.toContain('enemyIntelCount')
  })

  // RULEBOOK §10 is explicit that a roll with no eligible result costs nothing.
  it('keeps the refund documented in the rulebook', () => {
    expect(readFileSync(join(process.cwd(), 'RULEBOOK.md'), 'utf8'))
      .toMatch(/no eligible result, no coins are spent/i)
  })
})
