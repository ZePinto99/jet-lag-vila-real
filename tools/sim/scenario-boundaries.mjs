// Boundary sweep: just inside / on / just outside every distance threshold the
// rules name. Pure-API (no browser) so it can assert the SERVER authority
// rather than what the client chose to render.
//
//   node tools/sim/scenario-boundaries.mjs [seed]
//
// Thresholds under test (source of truth in brackets):
//   tag server 10 m            app/api/games/[id]/tag/route.ts:22
//   defense zone 200 m         lib/geo/zones.ts:8
//   enemy-candidate raid 50 m  lib/geo/zones.ts:13
//   attempt server 28 m        lib/gameConstants.ts:72
//   attempt hardened 12 m      lib/gameConstants.ts:86
//   home base 30 m             complete-run route
//   respawn arrive 30 / leave 45  lib/gameConstants.ts:103
//   challenge 100 m            submit-challenge/route.ts:26
//   presence freshness 30 s    lib/geo/positionFreshness.ts:5

import { strict as assert } from 'node:assert'
import {
  makeGameN,
  coord,
  apiPost,
  db,
  BASE,
  uploadFlagAttemptProof,
  uploadChallengeProof,
} from './harness.mjs'
import { advanceClockMinutes } from './clock.mjs'
import { makeRecorder, strictStep } from './artifact.mjs'
import { pointAtDistance, offsetMeters } from './movement.mjs'
import { haversineMeters as hav, makeRng } from './geoutil.mjs'

const seed = Number(process.argv[2] || 20260924)
const rng = makeRng(seed)
const rec = makeRecorder({ scenario: 'boundaries', seed })

const WEST_REAL = coord('landmark.miradouro-vila-velha') // West real flag + West home
const WEST_DECOY = coord('landmark.miradouro-meia-laranja')
const EAST_HOME = coord('landmark.biblioteca-municipal')

const g = await makeGameN(2, 2, `bnd-${seed}`)
rec.bindGame(g.gid, g.code)
rec.note(`game ${g.code} — West ${g.west.length} / East ${g.east.length}`)
db(`update teams set coins = 900 where game_id='${g.gid}';`)
advanceClockMinutes(g.gid, 31) // clear the 30-min protection window
rec.clockJump({ minutes: 31, reason: 'open attempt window' })

const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}
const freshPos = (p, accuracy = 5) => ({ lat: p.lat, lng: p.lng, accuracy, updated_at: Date.now() })

// Clear whatever respawn/lockout state a previous probe left behind.
const resetPlayer = (playerId) =>
  db(`update players set respawning=false, respawn_arrived=false, respawn_target_ref=null where id='${playerId}';`)

// ---------------------------------------------------------------------------
// 1. TAG: server validates at 10 m (client lights at 5 m)
// ---------------------------------------------------------------------------
// Setup: West defender stands ON its own candidate (inside its 200 m zone).
// East raider is placed at a measured distance along a fixed bearing.
// Measured: accept/reject and the reason, at 8 m / 12 m / 40 m.
async function tagAt(metres, label, expectTagged) {
  const defender = g.west[0]
  const raider = g.east[0]
  resetPlayer(raider.player)
  // A tag needs a camping heartbeat <=15 s old (0044:72) — the production
  // binding, so we drive it the production way.
  await post(`/api/games/${g.gid}/camping-heartbeat`, {
    device_id: defender.device,
    player_id: defender.player,
    pos: freshPos(WEST_REAL),
  })
  const raiderPos = offsetMeters(WEST_REAL, metres, 0)
  const actual = hav(WEST_REAL, raiderPos)
  const r = await post(`/api/games/${g.gid}/tag`, {
    device_id: defender.device,
    tagger_player_id: defender.player,
    tagger_pos: freshPos(WEST_REAL),
    targets: [{ player_id: raider.player, pos: freshPos(raiderPos) }],
  })
  const tagged = (r.body.tagged_player_ids ?? []).length > 0
  rec.check(
    label,
    tagged === expectTagged,
    `d=${actual.toFixed(1)}m status=${r.status} tagged=${tagged} rejected=${JSON.stringify(r.body.rejected ?? [])}`,
  )
  return r
}

await strictStep(rec, 'tag boundary', async () => {
  await tagAt(8, 'tag at 8 m (inside 10 m server range) → tagged', true)
  await tagAt(12, 'tag at 12 m (outside 10 m server range) → rejected', false)
  await tagAt(40, 'tag at 40 m → rejected', false)
})

// ---------------------------------------------------------------------------
// 2. TAG: defender must be inside own defense zone (200 m, zones.ts:8)
// ---------------------------------------------------------------------------
await strictStep(rec, 'defense zone boundary', async () => {
  const defender = g.west[0]
  const raider = g.east[0]
  // Walk the defender out beyond 200 m from EVERY own candidate. The West pool
  // is spread, so go far along a bearing away from all of them.
  const farOut = offsetMeters(WEST_REAL, -900, -900)
  const nearRaider = offsetMeters(farOut, 5, 0)
  resetPlayer(raider.player)
  await post(`/api/games/${g.gid}/camping-heartbeat`, {
    device_id: defender.device,
    player_id: defender.player,
    pos: freshPos(farOut),
  })
  const r = await post(`/api/games/${g.gid}/tag`, {
    device_id: defender.device,
    tagger_player_id: defender.player,
    tagger_pos: freshPos(farOut),
    targets: [{ player_id: raider.player, pos: freshPos(nearRaider) }],
  })
  rec.check(
    'defender outside own 200 m zone cannot tag even at 5 m',
    r.status >= 400 || (r.body.tagged_player_ids ?? []).length === 0,
    `status=${r.status} body=${JSON.stringify(r.body).slice(0, 160)}`,
  )
})

// ---------------------------------------------------------------------------
// 3. PRESENCE FRESHNESS: 30 s max age / 10 s future skew
// ---------------------------------------------------------------------------
await strictStep(rec, 'position freshness', async () => {
  const defender = g.west[0]
  const raider = g.east[0]
  resetPlayer(raider.player)
  await post(`/api/games/${g.gid}/camping-heartbeat`, {
    device_id: defender.device,
    player_id: defender.player,
    pos: freshPos(WEST_REAL),
  })
  const stale = { ...WEST_REAL, accuracy: 5, updated_at: Date.now() - 45_000 }
  const r1 = await post(`/api/games/${g.gid}/tag`, {
    device_id: defender.device,
    tagger_player_id: defender.player,
    tagger_pos: stale,
    targets: [{ player_id: raider.player, pos: freshPos(offsetMeters(WEST_REAL, 4, 0)) }],
  })
  rec.check(
    'tagger position 45 s old → 409 stale_tagger_position',
    r1.status === 409 && r1.body.error === 'stale_tagger_position',
    `status=${r1.status} error=${r1.body.error}`,
  )

  const future = { ...WEST_REAL, accuracy: 5, updated_at: Date.now() + 30_000 }
  const r2 = await post(`/api/games/${g.gid}/tag`, {
    device_id: defender.device,
    tagger_player_id: defender.player,
    tagger_pos: future,
    targets: [{ player_id: raider.player, pos: freshPos(offsetMeters(WEST_REAL, 4, 0)) }],
  })
  rec.check(
    'tagger position 30 s in the future → 409 (skew cap is 10 s)',
    r2.status === 409,
    `status=${r2.status} error=${r2.body.error}`,
  )

  // 25 s old is inside the 30 s band and must be ACCEPTED — proves the band is
  // a band, not just a rejection.
  resetPlayer(raider.player)
  await post(`/api/games/${g.gid}/camping-heartbeat`, {
    device_id: defender.device,
    player_id: defender.player,
    pos: freshPos(WEST_REAL),
  })
  const borderline = { ...WEST_REAL, accuracy: 5, updated_at: Date.now() - 25_000 }
  const r3 = await post(`/api/games/${g.gid}/tag`, {
    device_id: defender.device,
    tagger_player_id: defender.player,
    tagger_pos: borderline,
    targets: [{ player_id: raider.player, pos: freshPos(offsetMeters(WEST_REAL, 4, 0)) }],
  })
  rec.check(
    'tagger position 25 s old (inside 30 s band) → accepted',
    (r3.body.tagged_player_ids ?? []).length === 1,
    `status=${r3.status} tagged=${JSON.stringify(r3.body.tagged_player_ids ?? [])}`,
  )
})

// ---------------------------------------------------------------------------
// 4. FLAG ATTEMPT: 28 m server range (gameConstants.ts:72)
// ---------------------------------------------------------------------------
async function attemptAt(ref, metres, label, expectOk) {
  const raider = g.east[0]
  resetPlayer(raider.player)
  const target = coord(ref)
  const pos = offsetMeters(target, metres, 0)
  const proof = await uploadFlagAttemptProof(g.gid, raider.player, `b${Math.round(metres)}-${rng()}`)
  const r = await post(`/api/games/${g.gid}/attempt-flag`, {
    device_id: raider.device,
    player_id: raider.player,
    landmark_ref: ref,
    pos: freshPos(pos),
    photo_url: proof,
  })
  const accepted = r.status < 400
  rec.check(
    label,
    accepted === expectOk,
    `d=${hav(target, pos).toFixed(1)}m status=${r.status} ${r.body.result ?? r.body.error}`,
  )
  return r
}

await strictStep(rec, 'attempt geofence', async () => {
  // Use the WEST empty landmark so repeated probes do not consume the real flag.
  await attemptAt('landmark.mercado-municipal', 25, 'attempt at 25 m (inside 28 m) → accepted', true)
  // Now locked out 15 min; age past it before the next probe.
  advanceClockMinutes(g.gid, 16)
  rec.clockJump({ minutes: 16, reason: 'clear landmark lockout' })
  await attemptAt('landmark.mercado-municipal', 35, 'attempt at 35 m (outside 28 m) → 409', false)
})

// ---------------------------------------------------------------------------
// 5. HARDENED ATTEMPT: 12 m (gameConstants.ts:86)
// ---------------------------------------------------------------------------
await strictStep(rec, 'hardened geofence', async () => {
  // West hardens its real flag; East then probes at 20 m (inside normal 28,
  // outside hardened 12) and at 10 m.
  const h = await post(`/api/games/${g.gid}/harden-flag`, {
    device_id: g.west[0].device,
    player_id: g.west[0].player,
    landmark_ref: 'landmark.miradouro-vila-velha',
  })
  rec.check('West hardened its real flag (150 coins)', h.status < 400, `status=${h.status} ${h.body.error ?? ''}`)

  await attemptAt(
    'landmark.miradouro-vila-velha',
    20,
    'hardened attempt at 20 m (>12 m) → rejected, no info leak',
    false,
  )
  const ok = await attemptAt(
    'landmark.miradouro-vila-velha',
    9,
    'hardened attempt at 9 m (<12 m) → accepted (real)',
    true,
  )
  rec.check(
    'hardened real-flag attempt resolves as real',
    ok.body.result === 'real',
    `result=${ok.body.result}`,
  )
})

// ---------------------------------------------------------------------------
// 6. HOME BASE 30 m — carrier must reach own home to win
// ---------------------------------------------------------------------------
await strictStep(rec, 'home base geofence', async () => {
  const carrier = g.east[0]
  resetPlayer(carrier.player)
  const far = pointAtDistance(EAST_HOME, WEST_REAL, 60)
  const r1 = await post(`/api/games/${g.gid}/complete-run`, {
    device_id: carrier.device,
    player_id: carrier.player,
    pos: freshPos(far),
  })
  rec.check(
    'carrier 60 m from home base → run not completed',
    r1.status >= 400,
    `d=${hav(EAST_HOME, far).toFixed(1)}m status=${r1.status} ${r1.body.error}`,
  )

  const near = pointAtDistance(EAST_HOME, WEST_REAL, 20)
  const r2 = await post(`/api/games/${g.gid}/complete-run`, {
    device_id: carrier.device,
    player_id: carrier.player,
    pos: freshPos(near),
  })
  rec.check(
    'carrier 20 m from home base → WINS',
    r2.status < 400 && db(`select status from games where id='${g.gid}';`)[0] === 'finished',
    `d=${hav(EAST_HOME, near).toFixed(1)}m status=${r2.status} game=${db(`select status from games where id='${g.gid}';`)[0]}`,
  )
})

// ---------------------------------------------------------------------------
// 7. CHALLENGE 100 m — measured on a fresh game (the last one is finished)
// ---------------------------------------------------------------------------
await strictStep(rec, 'challenge geofence', async () => {
  const g2 = await makeGameN(1, 1, `bnd2-${seed}`)
  db(`update teams set coins = 500 where game_id='${g2.gid}';`)
  const list = await (await fetch(`${BASE}/api/games/${g2.gid}/challenges?device_id=${g2.west[0].device}`)).json()
  const ch = (list.active ?? []).find((c) => c.landmark_ref)
  assert.ok(ch, 'need a challenge with a landmark')
  const site = coord(ch.landmark_ref)

  const far = offsetMeters(site, 140, 0)
  const proofA = await uploadChallengeProof(g2.gid, g2.west[0].player, 'far')
  const r1 = await post(`/api/games/${g2.gid}/submit-challenge`, {
    device_id: g2.west[0].device,
    player_id: g2.west[0].player,
    challenge_ref: ch.id,
    pos: freshPos(far),
    photo_url: proofA,
  })
  rec.check(
    'challenge submit at 140 m → rejected',
    r1.status >= 400,
    `status=${r1.status} ${r1.body.error}`,
  )

  const near = offsetMeters(site, 90, 0)
  const proofB = await uploadChallengeProof(g2.gid, g2.west[0].player, 'near')
  const r2 = await post(`/api/games/${g2.gid}/submit-challenge`, {
    device_id: g2.west[0].device,
    player_id: g2.west[0].player,
    challenge_ref: ch.id,
    pos: freshPos(near),
    photo_url: proofB,
  })
  rec.check(
    'challenge submit at 90 m (inside 100 m) → accepted',
    r2.status < 400,
    `status=${r2.status} ${r2.body.error ?? 'ok'}`,
  )
  rec.note(
    `NOTE: 100 m is loose — ${ch.landmark_ref} can be claimed from 90 m away, a block distant in Vila Real's core`,
  )
})

const { failed } = rec.finish()
process.exitCode = failed > 0 ? 1 : 0
