// Haversine for the sim harness. Mirrors lib/geo/haversine.ts exactly (same
// earth radius, same formula) so a boundary assertion in a scenario agrees with
// what the app computes. Duplicated rather than imported because the harness is
// plain ESM and lib/ is TypeScript with @/ path aliases.

const R = 6_371_000

export function haversineMeters(a, b) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Seeded PRNG (mulberry32). Deterministic, so a failing run replays exactly:
 * jitter samples, curse tier dice, intel draw order, challenge refresh.
 */
export function makeRng(seed) {
  let a = typeof seed === 'string' ? hashString(seed) : seed >>> 0
  return function rng() {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashString(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Pick one element deterministically. */
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)]

/** Fisher-Yates using the seeded rng. */
export function shuffled(rng, arr) {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}
