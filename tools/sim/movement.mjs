// Realistic GPS movement for browser sim clients.
//
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
// harness.mjs's setPos() teleports: one setGeolocation call, done. That hides
// two whole classes of problem.
//
//  1. Walking distance IS this game's cost model. RULEBOOK §3.4 budgets the
//     map in walking minutes; a teleporting client pays nothing, so balance
//     questions ("is 150 coins reachable before the enemy raids?") cannot be
//     asked at all.
//  2. The app's drift-tolerance design is deliberately asymmetric — tag lights
//     at 5 m client / validates at 10 m server, attempt at 20/28 m, hardened
//     12 m — specifically to absorb urban GPS error. With accuracy pinned at a
//     perfect 8 m and zero jitter, none of that asymmetry is ever exercised.
//
// FIDELITY BOUNDARIES (be honest about these in the report)
//  * Great-circle interpolation, not street-following. Real Vila Real is a
//    ridge-and-valley town; a straight line between two landmarks routinely
//    understates the real walk. Distances here are LOWER BOUNDS.
//  * Gaussian jitter with a fixed sigma. Real urban multipath is correlated in
//    time and clusters against building faces. This models magnitude, not that
//    structure.
//  * No elevation. Vila Real is steep; a flat 1.3 m/s overstates uphill pace.

import { haversineMeters as hav } from './geoutil.mjs'

/** Walking pace in m/s. 1.3 ≈ 4.7 km/h, a normal adult walking speed. */
export const WALK_MPS = 1.3
/** A brisk chase. Still under useWalkingSpeed's 12 km/h warn (3.33 m/s). */
export const RUN_MPS = 3.0

/**
 * Deterministic Gaussian sampler (Box-Muller) driven by an injected uniform
 * RNG, so a seeded run replays its exact jitter.
 */
export function gaussian(rng) {
  let u = 0
  let v = 0
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** Offset a lat/lng by a metre vector. */
export function offsetMeters(point, northM, eastM) {
  const dLat = northM / 111_320
  const dLng = eastM / (111_320 * Math.cos((point.lat * Math.PI) / 180))
  return { lat: point.lat + dLat, lng: point.lng + dLng }
}

/**
 * Apply GPS error to a true position.
 *
 * `sigmaM` is the 1-sigma radial error. Typical values:
 *   1.5  open sky / plaza          (accuracy ~5 m)
 *   5    ordinary street           (accuracy ~12 m)
 *   12   narrow alley / urban canyon (accuracy ~25 m)
 */
export function jitterPosition(truePoint, sigmaM, rng) {
  if (!sigmaM) return { ...truePoint }
  return offsetMeters(truePoint, gaussian(rng) * sigmaM, gaussian(rng) * sigmaM)
}

/**
 * Walk a client along a waypoint path at a given speed.
 *
 * Deliberately RESPECTS the production publish throttle rather than defeating
 * it: useGPS.ts:86-88 drops a fix that moved <3 m AND arrived <5 s after the
 * last one. We emit a fix every `stepSeconds` of simulated time, which at
 * walking pace covers 1.3 m/s × stepSeconds — so stepSeconds >= 2.5 clears the
 * 3 m gate naturally, exactly as a real phone would.
 *
 * Timing is real: we actually sleep between fixes, because useWalkingSpeed
 * derives km/h from consecutive updated_at deltas (useWalkingSpeed.ts:84-89)
 * and warns above 12 km/h. The driver's own timing is therefore under test —
 * if we moved 100 m in 1 s of wall time the app would (correctly) flag it.
 *
 * Options:
 *   speedMps     travel speed (default walking)
 *   stepSeconds  simulated+real seconds between fixes (default 3)
 *   sigmaM       GPS jitter sigma in metres (default 0 = perfect)
 *   accuracyM    reported accuracy value (default derived from sigma)
 *   rng          seeded uniform RNG, required when sigmaM > 0
 *   onFix        callback({ lat, lng, trueLat, trueLng, tMs, index })
 *   timeScale    compress real sleeping (1 = real time). Values <1 speed the
 *                wall clock up; this breaks walking-speed realism, so it is
 *                opt-in and reported.
 */
export async function walkPath(client, waypoints, opts = {}) {
  const {
    speedMps = WALK_MPS,
    stepSeconds = 3,
    sigmaM = 0,
    accuracyM = null,
    rng = Math.random,
    onFix = null,
    timeScale = 1,
  } = opts
  if (waypoints.length < 2) throw new Error('walkPath needs >= 2 waypoints')

  const stepM = speedMps * stepSeconds
  const track = []
  let index = 0
  const t0 = Date.now()

  const emit = async (truePoint) => {
    const shown = sigmaM ? jitterPosition(truePoint, sigmaM, rng) : truePoint
    const acc = accuracyM ?? Math.max(4, Math.round(sigmaM * 2.5) || 8)
    await client.setPos(shown.lat, shown.lng, acc)
    const fix = {
      index: index++,
      tMs: Date.now() - t0,
      lat: shown.lat,
      lng: shown.lng,
      trueLat: truePoint.lat,
      trueLng: truePoint.lng,
      errorM: sigmaM ? hav(truePoint, shown) : 0,
      accuracyM: acc,
    }
    track.push(fix)
    if (onFix) await onFix(fix)
    if (stepSeconds > 0) {
      await new Promise((r) => setTimeout(r, stepSeconds * 1000 * timeScale))
    }
  }

  await emit(waypoints[0])
  for (let leg = 1; leg < waypoints.length; leg++) {
    const from = waypoints[leg - 1]
    const to = waypoints[leg]
    const legM = hav(from, to)
    const steps = Math.max(1, Math.ceil(legM / stepM))
    for (let s = 1; s <= steps; s++) {
      const f = s / steps
      await emit({
        lat: from.lat + (to.lat - from.lat) * f,
        lng: from.lng + (to.lng - from.lng) * f,
      })
    }
  }

  const totalM = waypoints
    .slice(1)
    .reduce((sum, w, i) => sum + hav(waypoints[i], w), 0)
  return {
    track,
    totalMeters: Math.round(totalM),
    walkSeconds: Math.round(totalM / speedMps),
    fixes: track.length,
  }
}

/**
 * Hold position while republishing jittered fixes, so a "stationary" player
 * still drifts the way a real phone does.
 *
 * This is how drift-induced tags get tested: a raider standing perfectly still
 * whose reported position wanders across the 10 m server tag threshold.
 */
export async function holdWithDrift(client, point, opts = {}) {
  const { seconds = 30, stepSeconds = 3, sigmaM = 5, rng = Math.random, accuracyM = null, onFix = null } = opts
  const steps = Math.max(1, Math.round(seconds / stepSeconds))
  const track = []
  for (let i = 0; i < steps; i++) {
    const shown = jitterPosition(point, sigmaM, rng)
    const acc = accuracyM ?? Math.max(4, Math.round(sigmaM * 2.5))
    await client.setPos(shown.lat, shown.lng, acc)
    const fix = { index: i, lat: shown.lat, lng: shown.lng, errorM: hav(point, shown), accuracyM: acc }
    track.push(fix)
    if (onFix) await onFix(fix)
    await new Promise((r) => setTimeout(r, stepSeconds * 1000))
  }
  return { track, maxErrorM: Math.max(...track.map((f) => f.errorM)) }
}

/**
 * A point exactly `metres` from `from` along the bearing toward `toward`.
 * Used to place a client just inside / on / just outside a boundary.
 */
export function pointAtDistance(from, toward, metres) {
  const total = hav(from, toward)
  if (total === 0) return { ...from }
  const f = metres / total
  return {
    lat: from.lat + (toward.lat - from.lat) * f,
    lng: from.lng + (toward.lng - from.lng) * f,
  }
}
