// Curse INTERACTIONS: what happens when two curses are live on one team at
// once, and what the boundaries of the one-shot ledger effects are.
//
//   node tools/sim/scenario-curse-stacking.mjs [seed]
//
// Pure-API (no browser), so every assertion lands on SERVER authority.
//
// WHY THIS EXISTS ALONGSIDE scenario-curse-coverage.mjs
// ---------------------------------------------------------------------------
// That scenario proves each of the 16 catalogue entries works through its own
// mechanism, one curse at a time — it deliberately deletes the target team's
// rows between cases so a probe can never 409 for the wrong reason. The
// consequence is that nothing there exercises two curses being live together,
// which is the normal mid-game state: no-stack is per-REF (0018:10), not per
// team, so a team can legitimately carry several effects at once.
//
// Covered here:
//   1. Full Stop + Pilgrimage, the only two action locks (actionLock.ts:19).
//      Does the lock lift when ONE of them goes, or only when both do?
//   2. Frozen + Pilgrimage — directly contradictory demands on one player.
//   3. A placed curse springing while an identical effect is already active:
//      blocked WITHOUT consuming the placement (0041), fires on a later entry
//      after expiry (0047).
//   4. No-stack proven at the DATABASE, through the RPC and a raw insert, not
//      just the route's selection filter.
//   5. Coin Drain at boundary balances: 0 / 50 / 49.
//   6. Intel Loss at exactly 1 card and at 0, plus the 0054 cap interaction.
//   7. A curse still live when the game ENDS — by flag carry and by timeout.
//      Does pg_cron's sweep (0052) touch a finished game? Does anything?
//
// HOW CURSES ARE PUT ON A TEAM HERE
// ---------------------------------------------------------------------------
// buy-curse rolls d6 server-side with Math.random (buy-curse/route.ts:58), so
// a scenario cannot ask for a tier. scenario-curse-coverage.mjs solves that by
// exhausting a tier and rerolling; that machinery exists to prove the PRODUCTION
// CAST PATH works, which is already covered there and is not what this scenario
// is about. What is under test here is the behaviour of a STATE — two rows
// coexisting — so the state is established the cheapest faithful way:
//
//   * direct `insert into active_curses` where only coexistence matters. The
//     row is the whole input: both the route lock (actionLock.ts:14-21) and the
//     RPC guard (0030:69-75) read active_curses and nothing else.
//   * the real RPC (`buy_curse_atomic`) with a PINNED curse_ref wherever the
//     LEDGER EFFECT is the subject (coin-drain, intel-loss) — the arithmetic,
//     the clamp, the events and the eligibility recheck all run for real, with
//     the dice supplied rather than rolled. Pinning matters: scenario-curse-
//     coverage.mjs shipped a real bug where an unpinned 2-die roll could land
//     on the major tier and silently drain 50 enemy coins mid-assertion.
//   * the real HTTP route (`/place-curse`, `/trigger-placed-curse`) for the
//     placed-curse case, because the route's nearest-placement selection is
//     part of what is being measured.

import {
  makeGameN,
  coord,
  db,
  adminRpc,
  BASE,
  uploadFlagAttemptProof,
} from './harness.mjs'
import { advanceClockMinutes } from './clock.mjs'
import { makeRecorder, strictStep } from './artifact.mjs'
import { offsetMeters } from './movement.mjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dir = dirname(fileURLToPath(import.meta.url))
const INTEL = JSON.parse(readFileSync(resolve(__dir, '../../data/intel.json'), 'utf8'))
const CURSES = JSON.parse(readFileSync(resolve(__dir, '../../data/curses.json'), 'utf8'))
const CURSE_BY_ID = new Map(CURSES.map((c) => [c.id, c]))

const seed = Number(process.argv[2] || 20260928)
const rec = makeRecorder({ scenario: 'curse-stacking', seed })

const WEST_REAL = coord('landmark.miradouro-vila-velha')
const EAST_REAL = coord('landmark.biblioteca-municipal')
const PILGRIM_TARGET_REF = 'landmark.largo-do-pelourinho'

// Intel that needs no GPS fix. `intel.hot-cold` 400s with player_pos_required
// (buy-intel/route.ts:252), so it must never be used as a generic "can this
// team still act?" probe — the 400 would look like a refusal by the curse.
const PLAIN_INTEL = INTEL.map((i) => i.id).filter((id) => id !== 'intel.hot-cold')

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}
const get = async (path) => {
  const res = await fetch(`${BASE}${path}`)
  return { status: res.status, body: await res.json().catch(() => ({})) }
}
const fresh = (p, accuracy = 5) => ({
  lat: p.lat,
  lng: p.lng,
  accuracy,
  updated_at: Date.now(),
})

const one = (sql) => db(sql)[0]
const num = (sql) => Number(one(sql) ?? 0)
const coins = (teamId) => num(`select coins from teams where id='${teamId}';`)
const gameStatus = (gid) => one(`select status from games where id='${gid}';`)
const eventCount = (gid, type) =>
  num(`select count(*) from events where game_id='${gid}' and type='${type}';`)
const activeRefs = (gid, teamId) =>
  db(
    `select curse_ref from active_curses where game_id='${gid}' and target_team_id='${teamId}' order by curse_ref;`,
  )
const curseIdOf = (gid, teamId, ref) =>
  db(
    `select id from active_curses where game_id='${gid}' and target_team_id='${teamId}' and curse_ref='${ref}';`,
  )[0] ?? null
const intelInHand = (gid, teamId) =>
  num(
    `select count(*) from cards where game_id='${gid}' and team_id='${teamId}' and kind='intel' and state='in_hand';`,
  )

/**
 * Next dev compiles a route on its FIRST hit, and a cold route can answer a
 * spurious 500 or take seconds. Warm with an empty body (-> 400 invalid_body):
 * it compiles the module and mutates nothing. Without this, an early 500 would
 * be misreported as an app bug.
 */
async function warmRoutes(gid) {
  const routes = [
    'buy-curse', 'buy-intel', 'expire-curses', 'place-curse',
    'trigger-placed-curse', 'complete-pilgrimage', 'end-by-timeout',
    'attempt-flag', 'complete-run', 'tag', 'camping-heartbeat', 'extend-curse',
  ]
  await Promise.all(routes.map((r) => post(`/api/games/${gid}/${r}`, {})))
  await get(`/api/games/${gid}/live-state?device_id=warm`)
  await get(`/api/games/${gid}/results?device_id=warm`)
}

async function waitForServer(attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${BASE}/api/games/by-code/ZZZZ`)
      if (r.status < 500) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`dev server at ${BASE} never became ready`)
}

const fund = (gid, amount = 9000) =>
  db(`update teams set coins = ${amount} where game_id='${gid}';`)

/**
 * Put `ref` on `teamId` directly. Used only where the ROW's existence is the
 * input under test (the two action locks, the coexistence cases). `expires_at`
 * is computed from the catalogue so a stacked curse has the same lifetime it
 * would have had from a real cast.
 */
function installCurse(gid, teamId, ref, { params = null, ageMinutes = 0, expired = false } = {}) {
  const def = CURSE_BY_ID.get(ref)
  if (!def) throw new Error(`unknown curse ${ref}`)
  const payload = JSON.stringify(params ?? def.params ?? {}).replace(/'/g, "''")
  const started = `now() - interval '${ageMinutes} minutes'`
  const expires =
    def.duration_minutes == null
      ? 'null'
      : expired
        ? `now() - interval '1 minute'`
        : `${started} + interval '${def.duration_minutes} minutes'`
  db(
    `insert into active_curses(game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${gid}','${teamId}','${ref}', ${started}, ${expires}, '${payload}'::jsonb);`,
  )
  return curseIdOf(gid, teamId, ref)
}

/**
 * "Can this team still take a gameplay action?" — the canonical probe for the
 * action lock. Buys a plain intel ref the team has not bought yet, so the only
 * 409 it can produce is the lock itself (a duplicate ref would answer
 * intel_already_purchased and a full hand intel_cap_reached, both of which
 * would be mistaken for "not locked").
 */
function makeActionProbe(g, side = 'east') {
  const actor = side === 'east' ? g.east[0] : g.west[0]
  const teamId = side === 'east' ? g.eTeam : g.wTeam
  let next = 0
  return async () => {
    const ref = PLAIN_INTEL[next++ % PLAIN_INTEL.length]
    db(`update teams set coins = 9000 where id='${teamId}';`)
    db(
      `delete from cards where game_id='${g.gid}' and team_id='${teamId}' and kind='intel' and ref='${ref}';`,
    )
    const r = await post(`/api/games/${g.gid}/buy-intel`, {
      device_id: actor.device,
      player_id: actor.player,
      intel_ref: ref,
    })
    return { ...r, ref, locked: r.status === 409 && r.body?.error === 'actions_locked' }
  }
}

const openGame = async (westN, eastN, tag) => {
  await waitForServer()
  let g = null
  let lastError = null
  for (let attempt = 1; attempt <= 3 && !g; attempt++) {
    try {
      g = await makeGameN(westN, eastN, `${tag}-${seed}-${attempt}`)
    } catch (e) {
      lastError = e
      await waitForServer()
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
  if (!g) throw lastError
  await warmRoutes(g.gid)
  fund(g.gid)
  return g
}

const findings = []

await waitForServer()

// ---------------------------------------------------------------------------
// 1. FULL STOP + PILGRIMAGE — the only two action locks, both live at once
// ---------------------------------------------------------------------------
// actionLock.ts:19 whitelists exactly ['curse.full-stop', 'curse.pilgrimage'],
// and the lock is a single `.in(...).limit(1)` existence query. So the question
// is not whether each locks (curse-coverage proves that) but whether removing
// ONE of two lifts the lock prematurely. Both orderings are tested, because they
// end differently: Full Stop clears on a TIMER, Pilgrimage only on ARRIVAL.
await strictStep(rec, 'stack: Full Stop + Pilgrimage, lock lifts only when BOTH are gone', async () => {
  const g = await openGame(2, 2, 'stack-locks')
  rec.bindGame(g.gid, g.code)
  rec.note(`case 1 game ${g.code} — both action locks on East simultaneously`)
  const probe = makeActionProbe(g, 'east')

  const fsId = installCurse(g.gid, g.eTeam, 'curse.full-stop')
  const pilgId = installCurse(g.gid, g.eTeam, 'curse.pilgrimage', {
    params: { target_landmark_ref: PILGRIM_TARGET_REF },
  })
  rec.check(
    'both action-lock curses coexist on one team (no-stack is per-REF, 0018:10, not per team)',
    JSON.stringify(activeRefs(g.gid, g.eTeam)) ===
      JSON.stringify(['curse.full-stop', 'curse.pilgrimage']),
    `refs=${JSON.stringify(activeRefs(g.gid, g.eTeam))}`,
  )
  rec.check(
    'Pilgrimage has a NULL expiry, so it cannot clear on a timer — only arrival ends it',
    one(`select coalesce(expires_at::text,'null') from active_curses where id='${pilgId}';`) === 'null',
    `expires_at=${one(`select coalesce(expires_at::text,'null') from active_curses where id='${pilgId}';`)}`,
  )

  const both = await probe()
  rec.check(
    'with BOTH active the team is action-locked',
    both.locked,
    `buy-intel(${both.ref}) -> ${both.status} ${both.body?.error}`,
  )

  // --- ordering A: the TIMED lock elapses first -----------------------------
  // The assertion is about the END STATE, not about which sweeper won: the game
  // is live, so the 30-s pg_cron job (0052) and this client poll are both valid
  // paths into the same expire_curses_atomic. Either way exactly one
  // curse_expired must exist and only Pilgrimage may survive.
  db(`update active_curses set expires_at = now() - interval '1 minute' where id='${fsId}';`)
  const sweep = await post(`/api/games/${g.gid}/expire-curses`, {
    device_id: g.east[0].device,
  })
  rec.check(
    'the elapsed Full Stop is swept exactly once, leaving Pilgrimage alone',
    JSON.stringify(activeRefs(g.gid, g.eTeam)) === JSON.stringify(['curse.pilgrimage']) &&
      num(
        `select count(*) from events where game_id='${g.gid}' and type='curse_expired' and payload->>'curse_id'='${fsId}';`,
      ) === 1,
    `poll swept=${JSON.stringify(sweep.body?.expired_curse_ids ?? [])} refs=${JSON.stringify(activeRefs(g.gid, g.eTeam))} curse_expired for that id=${num(`select count(*) from events where game_id='${g.gid}' and type='curse_expired' and payload->>'curse_id'='${fsId}';`)}`,
  )
  const afterOne = await probe()
  rec.check(
    'HALF-LIFTED IS STILL LOCKED: losing one of the two locks does NOT let the team act',
    afterOne.locked,
    `buy-intel(${afterOne.ref}) -> ${afterOne.status} ${afterOne.body?.error} (only curse.pilgrimage remains)`,
  )

  // --- and now the surviving lock ends by its own mechanism -----------------
  const target = coord(PILGRIM_TARGET_REF)
  const arrive = await post(`/api/games/${g.gid}/complete-pilgrimage`, {
    device_id: g.east[0].device,
    player_id: g.east[0].player,
    curse_id: pilgId,
    pos: fresh(offsetMeters(target, 10, 0)),
  })
  rec.check(
    'arriving at the pilgrimage target completes it while it is the last lock standing',
    arrive.status < 400 && arrive.body?.completed === true,
    `status=${arrive.status} ${JSON.stringify(arrive.body)}`,
  )
  const afterBoth = await probe()
  rec.check(
    'with BOTH gone the team can act again',
    !afterBoth.locked && afterBoth.status < 400,
    `buy-intel(${afterBoth.ref}) -> ${afterBoth.status} ${afterBoth.body?.error ?? 'ok'} refs=${JSON.stringify(activeRefs(g.gid, g.eTeam))}`,
  )

  // --- ordering B: the ARRIVAL lock clears first ----------------------------
  // Symmetric, and NOT redundant: complete-pilgrimage deletes its own row via a
  // different code path (0022) than the expiry sweep, so "the other lock still
  // binds" has to be proved from both sides.
  const g2 = await openGame(2, 2, 'stack-locks-rev')
  rec.note(`case 1b game ${g2.code} — reverse order: pilgrimage completes first`)
  const probe2 = makeActionProbe(g2, 'east')
  installCurse(g2.gid, g2.eTeam, 'curse.full-stop')
  const pilg2 = installCurse(g2.gid, g2.eTeam, 'curse.pilgrimage', {
    params: { target_landmark_ref: PILGRIM_TARGET_REF },
  })
  const done2 = await post(`/api/games/${g2.gid}/complete-pilgrimage`, {
    device_id: g2.east[0].device,
    player_id: g2.east[0].player,
    curse_id: pilg2,
    pos: fresh(coord(PILGRIM_TARGET_REF)),
  })
  rec.check(
    'a pilgrimage CAN be completed while Full Stop is also active (the lock does not block its own release)',
    done2.status < 400 && done2.body?.completed === true,
    `status=${done2.status} ${JSON.stringify(done2.body)}`,
  )
  const stillFs = await probe2()
  rec.check(
    'reverse order: completing the pilgrimage leaves Full Stop still locking the team',
    stillFs.locked && JSON.stringify(activeRefs(g2.gid, g2.eTeam)) === JSON.stringify(['curse.full-stop']),
    `buy-intel(${stillFs.ref}) -> ${stillFs.status} ${stillFs.body?.error} refs=${JSON.stringify(activeRefs(g2.gid, g2.eTeam))}`,
  )
  rec.note(
    'isTeamActionLocked (actionLock.ts:14-21) is a single existence query over both refs with `.limit(1)`, so the lock is the OR of the two and lifts only when neither row survives. Both release paths were driven: the expiry sweep (0046:12-62) and complete-pilgrimage (0022). Neither releases early.',
  )
})

// ---------------------------------------------------------------------------
// 2. FROZEN + PILGRIMAGE — contradictory demands on the same player
// ---------------------------------------------------------------------------
// Frozen (major, [A]) requires staying within 10 m of an anchor and EXTENDS
// itself 1:1 for every second spent outside it (0051). Pilgrimage (major, [A])
// requires walking to a named neutral landmark and only ends on arrival. Both
// are majors, and no-stack is per-ref, so nothing prevents both being live.
// This step MEASURES the resulting position rather than asserting a desired one.
await strictStep(rec, 'stack: Frozen + Pilgrimage — mutually impossible compliance', async () => {
  const g = await openGame(2, 2, 'stack-frozen-pilg')
  rec.note(`case 2 game ${g.code} — Frozen and Pilgrimage together on East`)
  const probe = makeActionProbe(g, 'east')

  const frozenId = installCurse(g.gid, g.eTeam, 'curse.frozen')
  const pilgId = installCurse(g.gid, g.eTeam, 'curse.pilgrimage', {
    params: { target_landmark_ref: PILGRIM_TARGET_REF },
  })
  rec.check(
    'both majors are simultaneously active — nothing rejects the combination',
    JSON.stringify(activeRefs(g.gid, g.eTeam)) ===
      JSON.stringify(['curse.frozen', 'curse.pilgrimage']),
    `refs=${JSON.stringify(activeRefs(g.gid, g.eTeam))}`,
  )

  // The anchor is established by the cursed team's own client on first contact
  // (extend-curse/route.ts). Anchor at the team's home, far from the pilgrimage
  // target, which is the situation that makes the two demands incompatible.
  const anchorPoint = EAST_REAL
  const anchored = await post(`/api/games/${g.gid}/extend-curse`, {
    device_id: g.east[0].device,
    player_id: g.east[0].player,
    curse_id: frozenId,
    anchor_pos: fresh(anchorPoint),
  })
  rec.check(
    'Frozen anchors at the point of first contact',
    anchored.status < 400 && Math.abs((anchored.body?.anchor?.lat ?? 0) - anchorPoint.lat) < 1e-9,
    `status=${anchored.status} anchor=${JSON.stringify(anchored.body?.anchor)}`,
  )

  const target = coord(PILGRIM_TARGET_REF)
  const separationM = Math.round(
    Math.hypot(
      (target.lat - anchorPoint.lat) * 111_320,
      (target.lng - anchorPoint.lng) * 111_320 * Math.cos((anchorPoint.lat * Math.PI) / 180),
    ),
  )
  const frozenRadius = CURSE_BY_ID.get('curse.frozen').params?.radius_m ?? 10
  rec.check(
    `the two demands are geometrically incompatible: the pilgrimage target is ${separationM} m from the Frozen anchor, far outside the ${frozenRadius} m leash`,
    separationM > frozenRadius,
    `anchor=${PILGRIM_TARGET_REF === 'landmark.largo-do-pelourinho' ? 'East home (Biblioteca)' : 'anchor'} -> target ${PILGRIM_TARGET_REF}: ${separationM} m vs radius ${frozenRadius} m`,
  )

  // Walking to the pilgrimage target is exactly what Frozen punishes. The
  // violation channel is the cursed team's OWN client (/extend-curse), so a
  // player who complies with Pilgrimage and reports honestly lengthens Frozen.
  const walkStart = Date.now() - 4_000
  const violation = await post(`/api/games/${g.gid}/extend-curse`, {
    device_id: g.east[0].device,
    player_id: g.east[0].player,
    curse_id: frozenId,
    violation: { started_at: walkStart, ended_at: Date.now() },
  })
  const frozenDurS = num(
    `select round(extract(epoch from (expires_at - started_at))) from active_curses where id='${frozenId}';`,
  )
  const nominalS = CURSE_BY_ID.get('curse.frozen').duration_minutes * 60
  rec.check(
    'walking toward the pilgrimage target is a Frozen violation and EXTENDS Frozen 1:1',
    violation.status < 400 &&
      (violation.body?.added_seconds ?? 0) > 0 &&
      frozenDurS > nominalS,
    `added=${violation.body?.added_seconds}s total_violation=${violation.body?.total_violation_seconds}s frozen duration ${nominalS}s -> ${frozenDurS}s`,
  )

  // Arriving DOES clear Pilgrimage — the server never cross-checks Frozen.
  const arrive = await post(`/api/games/${g.gid}/complete-pilgrimage`, {
    device_id: g.east[0].device,
    player_id: g.east[0].player,
    curse_id: pilgId,
    pos: fresh(offsetMeters(target, 8, 0)),
  })
  rec.check(
    'the server lets the pilgrimage complete at the target even though standing there violates Frozen',
    arrive.status < 400 && arrive.body?.completed === true,
    `status=${arrive.status} ${JSON.stringify(arrive.body)} — Frozen still active: ${curseIdOf(g.gid, g.eTeam, 'curse.frozen') !== null}`,
  )
  rec.check(
    'Frozen survives the pilgrimage and keeps its extension (the two are accounted independently)',
    curseIdOf(g.gid, g.eTeam, 'curse.frozen') === frozenId &&
      num(`select round(extract(epoch from (expires_at - started_at))) from active_curses where id='${frozenId}';`) >
        nominalS,
    `refs=${JSON.stringify(activeRefs(g.gid, g.eTeam))} frozen duration=${num(`select round(extract(epoch from (expires_at - started_at))) from active_curses where id='${frozenId}';`)}s`,
  )
  const stillFrozen = await probe()
  rec.check(
    'Frozen is [A] readout-only — it never locked actions, so nothing changes for spending',
    !stillFrozen.locked,
    `buy-intel(${stillFrozen.ref}) -> ${stillFrozen.status} ${stillFrozen.body?.error ?? 'ok'}`,
  )
  const finding =
    `FINDING (design, not a crash): curse.frozen and curse.pilgrimage can be active on the same team at the same time, and their demands cannot both be satisfied. Measured on ${g.code}: Frozen anchored at the team's home and Pilgrimage named ${PILGRIM_TARGET_REF}, ${separationM} m away — ${Math.round(separationM / frozenRadius)}x the ${frozenRadius} m Frozen leash. Pilgrimage ALSO holds the action lock (actionLock.ts:19), so the team cannot buy, tag, or submit anything until someone walks there, while every second of that walk is a Frozen violation that extends Frozen 1:1 through the cursed team's own /extend-curse reports (bounded at 1.5x nominal by 0051). Neither side of the app notices: buy-curse's eligibility filter (route.ts:250-258) excludes only refs ALREADY ACTIVE, never refs that contradict an active one, and complete-pilgrimage (0022) does not consult Frozen. The honest play is to eat the Frozen extension; the cheap play is to walk and report nothing, which is exactly the asymmetry 0051 bounded rather than closed. Worth noting the combination is reachable by ordinary play — both are majors, so any two major rolls against the same team can produce it — and also by a placed Snare (placed.snare casts curse.frozen) landing on a team already on pilgrimage. NOT FIXED: this is a rules question (should the major tier be mutually exclusive, or should Pilgrimage suspend Frozen?), so it is recorded for decision.`
  findings.push(finding)
  rec.note(finding)
})

// ---------------------------------------------------------------------------
// 3. PLACED CURSE vs AN IDENTICAL ACTIVE EFFECT
// ---------------------------------------------------------------------------
// 0041 made the block NON-CONSUMING and 0047 let the same placement fire after
// the identical effect elapses, even before housekeeping runs. Both halves are
// asserted: blocked now (and still armed), fires later (and disarms).
await strictStep(rec, 'stack: a placed curse blocked by an identical active effect fires later', async () => {
  const g = await openGame(2, 2, 'stack-placed')
  rec.note(`case 3 game ${g.code} — placed Snare (casts curse.frozen) vs an already-frozen intruder`)

  // West arms a Snare on its own real-flag candidate. Snare casts curse.frozen.
  const place = await post(`/api/games/${g.gid}/place-curse`, {
    device_id: g.west[0].device,
    player_id: g.west[0].player,
    landmark_ref: 'landmark.miradouro-vila-velha',
    placed_ref: 'placed.snare',
  })
  const placementId = place.body?.placed?.id ?? null
  rec.check(
    'West arms placed.snare (casts curse.frozen) on its own candidate',
    place.status < 400 && place.body?.placed?.armed === true &&
      place.body?.placed?.curse_ref === 'curse.frozen',
    `status=${place.status} placed=${JSON.stringify({ id: placementId, armed: place.body?.placed?.armed, ref: place.body?.placed?.curse_ref })}`,
  )

  // East is ALREADY frozen (e.g. from an earlier cast) and walks into the zone.
  const preexisting = installCurse(g.gid, g.eTeam, 'curse.frozen')
  const blocked = await post(`/api/games/${g.gid}/trigger-placed-curse`, {
    device_id: g.east[0].device,
    player_id: g.east[0].player,
    pos: fresh(WEST_REAL),
  })
  const armedAfterBlock = one(
    `select armed::text||'|'||coalesce(triggered_at::text,'null') from placed_curses where id='${placementId}';`,
  )
  rec.check(
    'the trigger casts NOTHING while an identical effect is active',
    blocked.status < 400 && (blocked.body?.triggered_curse_refs ?? []).length === 0,
    `status=${blocked.status} triggered=${JSON.stringify(blocked.body?.triggered_curse_refs)}`,
  )
  rec.check(
    '0041: the blocked placement is NOT consumed — still armed, never triggered',
    armedAfterBlock === 'true|null',
    `placed_curses armed|triggered_at = ${armedAfterBlock}`,
  )
  rec.check(
    'no spurious curse_cast / placed_curse_triggered event was written by the blocked entry',
    eventCount(g.gid, 'placed_curse_triggered') === 0 &&
      num(
        `select count(*) from events where game_id='${g.gid}' and type='curse_cast' and payload->>'source'='placed_curse';`,
      ) === 0,
    `placed_curse_triggered=${eventCount(g.gid, 'placed_curse_triggered')} placed curse_cast=${num(`select count(*) from events where game_id='${g.gid}' and type='curse_cast' and payload->>'source'='placed_curse';`)}`,
  )
  rec.check(
    'the pre-existing Frozen row is untouched by the blocked trigger (still exactly one)',
    curseIdOf(g.gid, g.eTeam, 'curse.frozen') === preexisting &&
      num(`select count(*) from active_curses where game_id='${g.gid}' and target_team_id='${g.eTeam}';`) === 1,
    `rows=${JSON.stringify(activeRefs(g.gid, g.eTeam))}`,
  )

  // Now the identical effect elapses, but housekeeping has NOT run: the stale
  // row is still in the table. 0047 is exactly this case.
  //
  // The game is still `live`, so the 30-s pg_cron sweep (0052) is a legitimate
  // competitor for this row — it would expire it exactly as the RPC does, just
  // earlier. We therefore record WHICH path cleared it rather than assuming, so
  // the step measures 0047 without ever failing on the schedule's timing.
  db(`update active_curses set expires_at = now() - interval '1 minute' where id='${preexisting}';`)
  const staleStillThere = curseIdOf(g.gid, g.eTeam, 'curse.frozen') === preexisting
  rec.check(
    'the identical effect is elapsed; either its stale row is still in the table (the 0047 case) or the live cron already reaped it',
    staleStillThere || curseIdOf(g.gid, g.eTeam, 'curse.frozen') === null,
    staleStillThere
      ? `stale row present, expires_at ${num(`select round(extract(epoch from (now() - expires_at))) from active_curses where id='${preexisting}';`)}s in the past — the RPC must clear it`
      : 'the 30-s cron sweep got there first; the trigger then faces no row at all',
  )
  const expiredBeforeFire = eventCount(g.gid, 'curse_expired')
  const fires = await post(`/api/games/${g.gid}/trigger-placed-curse`, {
    device_id: g.east[0].device,
    player_id: g.east[0].player,
    pos: fresh(WEST_REAL),
  })
  const armedAfterFire = one(
    `select armed::text||'|'||(triggered_at is not null)::text||'|'||coalesce(triggered_by_team_id::text,'null') from placed_curses where id='${placementId}';`,
  )
  rec.check(
    '0047: the SAME placement fires on the later entry once the identical effect has elapsed',
    fires.status < 400 && (fires.body?.triggered_curse_refs ?? []).includes('curse.frozen'),
    `status=${fires.status} triggered=${JSON.stringify(fires.body?.triggered_curse_refs)}`,
  )
  rec.check(
    'firing disarms the placement and records who sprang it',
    armedAfterFire === `false|true|${g.eTeam}`,
    `armed|triggered|by = ${armedAfterFire}`,
  )
  rec.check(
    'exactly one fresh Frozen row remains, and it is a NEW row — the stale one was expired and logged, not reused',
    num(`select count(*) from active_curses where game_id='${g.gid}' and target_team_id='${g.eTeam}' and curse_ref='curse.frozen';`) === 1 &&
      curseIdOf(g.gid, g.eTeam, 'curse.frozen') !== preexisting &&
      eventCount(g.gid, 'curse_expired') === 1,
    `rows=${num(`select count(*) from active_curses where game_id='${g.gid}' and target_team_id='${g.eTeam}' and curse_ref='curse.frozen';`)} new id differs=${curseIdOf(g.gid, g.eTeam, 'curse.frozen') !== preexisting} curse_expired=${eventCount(g.gid, 'curse_expired')} (${expiredBeforeFire} of them before the trigger, so the ${staleStillThere ? 'RPC' : 'cron'} logged it)`,
  )
  rec.check(
    'the fired placement emits both a placed_curse_triggered and a source:placed_curse curse_cast',
    eventCount(g.gid, 'placed_curse_triggered') === 1 &&
      num(
        `select count(*) from events where game_id='${g.gid}' and type='curse_cast' and payload->>'source'='placed_curse';`,
      ) === 1,
    `placed_curse_triggered=${eventCount(g.gid, 'placed_curse_triggered')}`,
  )
  const reEnter = await post(`/api/games/${g.gid}/trigger-placed-curse`, {
    device_id: g.east[0].device,
    player_id: g.east[0].player,
    pos: fresh(WEST_REAL),
  })
  rec.check(
    'a disarmed placement cannot fire twice (re-entering the same zone does nothing)',
    (reEnter.body?.triggered_curse_refs ?? []).length === 0 &&
      eventCount(g.gid, 'placed_curse_triggered') === 1,
    `triggered=${JSON.stringify(reEnter.body?.triggered_curse_refs)} events=${eventCount(g.gid, 'placed_curse_triggered')}`,
  )
  rec.note(
    'A placement is spent only when it actually casts. 0041 returns {triggered:false,cast:false} while leaving armed=true, and 0047 first calls expire_active_curse_ref_locked so an elapsed-but-unswept row cannot hold the placement hostage. Both halves verified on one placement: blocked while frozen, fired after expiry, inert afterwards.',
  )
})

// ---------------------------------------------------------------------------
// 4. NO-STACK IS A DATABASE CONSTRAINT, NOT A ROUTE FILTER
// ---------------------------------------------------------------------------
// The route excludes already-active refs during selection (buy-curse:250-258),
// which is presentation. The authority is the unique index (0018:10) plus the
// RPC's own recheck under the advisory lock (0046:125-135). Both are driven
// here WITHOUT the route's filter in the way.
await strictStep(rec, 'stack: no-stack enforced by the DB and the RPC, not the route filter', async () => {
  const g = await openGame(2, 2, 'stack-nostack')
  rec.note(`case 4 game ${g.code} — duplicate cast attempted below the route`)

  const existing = installCurse(g.gid, g.eTeam, 'curse.mute')
  rec.check(
    'one curse.mute row on East to begin with',
    num(`select count(*) from active_curses where game_id='${g.gid}' and target_team_id='${g.eTeam}' and curse_ref='curse.mute';`) === 1,
    `id=${existing}`,
  )

  // (a) Straight through the RPC, bypassing the route's selection filter
  // entirely. This is what the route would submit if the enemy's state changed
  // between its read and the call.
  const before = coins(g.wTeam)
  const rpc = await adminRpc('buy_curse_atomic', {
    p_game_id: g.gid,
    p_buyer_team_id: g.wTeam,
    p_target_team_id: g.eTeam,
    p_actor_player_id: g.west[0].player,
    p_cost: 100,
    p_num_dice: 2,
    p_dice_total: 7,
    p_dice_rolls: [3, 4],
    p_curse_ref: 'curse.mute',
    p_tier: 'medium',
    p_expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    p_params: CURSE_BY_ID.get('curse.mute').params,
  })
  rec.check(
    'RPC refuses a duplicate cast with curse_already_active (0046:132-135)',
    rpc.data?.error === 'curse_already_active',
    `rpc=${JSON.stringify(rpc.data)} err=${rpc.error?.message ?? 'none'}`,
  )
  rec.check(
    'the refused duplicate charges the buyer NOTHING',
    coins(g.wTeam) === before &&
      num(
        `select count(*) from events where game_id='${g.gid}' and type='coins_deducted' and payload->>'reason'='buy_curse';`,
      ) === 0,
    `coins ${before} -> ${coins(g.wTeam)}`,
  )
  rec.check(
    'still exactly one row, and it is the ORIGINAL (not replaced)',
    num(`select count(*) from active_curses where game_id='${g.gid}' and target_team_id='${g.eTeam}' and curse_ref='curse.mute';`) === 1 &&
      curseIdOf(g.gid, g.eTeam, 'curse.mute') === existing,
    `id unchanged=${curseIdOf(g.gid, g.eTeam, 'curse.mute') === existing}`,
  )

  // (b) The unique index itself, below even the RPC.
  let uniqueError = null
  try {
    db(
      `insert into active_curses(game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${g.gid}','${g.eTeam}','curse.mute', now(), now()+interval '15 minutes','{}'::jsonb);`,
    )
  } catch (e) {
    uniqueError = String(e?.message ?? e)
  }
  rec.check(
    'a raw duplicate INSERT is rejected by active_curses_no_stack_unique (0018:10)',
    uniqueError !== null && /active_curses_no_stack_unique/.test(uniqueError),
    uniqueError
      ? uniqueError.split('\n').find((l) => /ERROR/.test(l))?.trim() ?? 'rejected'
      : 'INSERT SUCCEEDED — the constraint is missing',
  )

  // (c) The constraint is scoped per (game, team, ref): the SAME ref on the
  // OTHER team must be allowed, or a curse on one side would block the other.
  const otherSide = installCurse(g.gid, g.wTeam, 'curse.mute')
  rec.check(
    'the same ref IS allowed on the other team (constraint is per game+team+ref)',
    otherSide !== null &&
      num(`select count(*) from active_curses where game_id='${g.gid}' and curse_ref='curse.mute';`) === 2,
    `mute rows in game=${num(`select count(*) from active_curses where game_id='${g.gid}' and curse_ref='curse.mute';`)} (East + West)`,
  )
  // ...and a DIFFERENT ref on the same team, which is the whole premise of stacking.
  installCurse(g.gid, g.eTeam, 'curse.slow-walk')
  rec.check(
    'a DIFFERENT ref stacks freely on the same team',
    JSON.stringify(activeRefs(g.gid, g.eTeam)) === JSON.stringify(['curse.mute', 'curse.slow-walk']),
    `refs=${JSON.stringify(activeRefs(g.gid, g.eTeam))}`,
  )
})

// ---------------------------------------------------------------------------
// 5. COIN DRAIN AT BOUNDARY BALANCES
// ---------------------------------------------------------------------------
// The eligibility predicate is `enemyTeam.coins > 0` at the route
// (buy-curse:256) and re-checked as `v_target_coins <= 0` under the team lock
// (0046:105-108). The drain itself is clamped. Driven through the RPC with a
// PINNED ref so the dice can never wander onto another major.
await strictStep(rec, 'ledger: Coin Drain at 0 / 50 / 49 enemy coins', async () => {
  const g = await openGame(2, 2, 'stack-drain')
  rec.note(`case 5 game ${g.code} — coin-drain boundaries`)
  const DRAIN = CURSE_BY_ID.get('curse.coin-drain').params?.amount ?? 50
  rec.check(
    `catalogue drain amount is ${DRAIN}`,
    DRAIN === 50,
    `data/curses.json curse.coin-drain params=${JSON.stringify(CURSE_BY_ID.get('curse.coin-drain').params)}`,
  )

  const drain = async (enemyBalance) => {
    db(`update teams set coins = ${enemyBalance} where id='${g.eTeam}';`)
    db(`update teams set coins = 9000 where id='${g.wTeam}';`)
    const r = await adminRpc('buy_curse_atomic', {
      p_game_id: g.gid,
      p_buyer_team_id: g.wTeam,
      p_target_team_id: g.eTeam,
      p_actor_player_id: g.west[0].player,
      p_cost: 150,
      p_num_dice: 3,
      p_dice_total: 12,
      p_dice_rolls: [4, 4, 4],
      p_curse_ref: 'curse.coin-drain',
      p_tier: 'major',
      p_expires_at: null,
      p_params: CURSE_BY_ID.get('curse.coin-drain').params ?? {},
    })
    return { data: r.data, error: r.error, after: coins(g.eTeam), buyer: coins(g.wTeam) }
  }

  // --- exactly 0: excluded from the roll entirely --------------------------
  const zero = await drain(0)
  rec.check(
    'enemy at exactly 0 coins: coin-drain is INELIGIBLE -> no_available_curse',
    zero.data?.error === 'no_available_curse',
    `rpc=${JSON.stringify(zero.data)}`,
  )
  rec.check(
    'the ineligible drain charges the buyer nothing and leaves the enemy at 0',
    zero.buyer === 9000 && zero.after === 0,
    `buyer=${zero.buyer} enemy=${zero.after}`,
  )

  // --- exactly 50: drains to exactly 0, never below -----------------------
  const exact = await drain(50)
  rec.check(
    `enemy at exactly ${DRAIN}: drains to exactly 0, never negative`,
    exact.after === 0 && exact.data?.ledger_effect?.amount === DRAIN,
    `50 -> ${exact.after}, ledger=${JSON.stringify(exact.data?.ledger_effect)}`,
  )
  rec.check(
    'the ledger_effect reports the post-drain balance it actually wrote',
    exact.data?.ledger_effect?.target_team_coins === 0,
    `target_team_coins=${exact.data?.ledger_effect?.target_team_coins} actual=${exact.after}`,
  )

  // --- 49: clamps to the balance, so amount is 49 not 50 ------------------
  const under = await drain(49)
  rec.check(
    `enemy at ${DRAIN - 1}: the drain CLAMPS — amount is 49, balance 0, not -1`,
    under.after === 0 && under.data?.ledger_effect?.amount === 49,
    `49 -> ${under.after}, ledger=${JSON.stringify(under.data?.ledger_effect)}`,
  )
  rec.check(
    'no team balance in the game is ever negative after the boundary drains',
    num(`select count(*) from teams where game_id='${g.gid}' and coins < 0;`) === 0,
    `min balance=${num(`select min(coins) from teams where game_id='${g.gid}';`)}`,
  )
  rec.check(
    'each successful drain wrote exactly one curse_coin_drain deduction against the victim',
    num(
      `select count(*) from events where game_id='${g.gid}' and type='coins_deducted' and payload->>'reason'='curse_coin_drain' and payload->>'team_id'='${g.eTeam}';`,
    ) === 2,
    `drain events=${num(`select count(*) from events where game_id='${g.gid}' and type='coins_deducted' and payload->>'reason'='curse_coin_drain';`)} (one each for the 50 and 49 cases; the 0 case wrote none)`,
  )
  rec.check(
    'coin-drain never leaves an active_curses row (one-shot, so it is instantly recastable)',
    curseIdOf(g.gid, g.eTeam, 'curse.coin-drain') === null,
    `refs=${JSON.stringify(activeRefs(g.gid, g.eTeam))}`,
  )
  // A drained-to-zero enemy is now ineligible: the boundary is self-closing.
  const afterZero = await adminRpc('buy_curse_atomic', {
    p_game_id: g.gid,
    p_buyer_team_id: g.wTeam,
    p_target_team_id: g.eTeam,
    p_actor_player_id: g.west[0].player,
    p_cost: 150,
    p_num_dice: 3,
    p_dice_total: 12,
    p_dice_rolls: [4, 4, 4],
    p_curse_ref: 'curse.coin-drain',
    p_tier: 'major',
    p_expires_at: null,
    p_params: CURSE_BY_ID.get('curse.coin-drain').params ?? {},
  })
  rec.check(
    'a team drained to 0 immediately becomes an ineligible drain target (no free repeat)',
    afterZero.data?.error === 'no_available_curse',
    `rpc=${JSON.stringify(afterZero.data)} enemy coins=${coins(g.eTeam)}`,
  )
})

// ---------------------------------------------------------------------------
// 6. INTEL LOSS AT EXACTLY 1 CARD AND AT 0
// ---------------------------------------------------------------------------
await strictStep(rec, 'ledger: Intel Loss at exactly 1 card, at 0, and the 0054 cap interaction', async () => {
  const g = await openGame(2, 2, 'stack-intelloss')
  rec.note(`case 6 game ${g.code} — intel-loss boundaries`)
  const castIntelLoss = async () => {
    db(`update teams set coins = 9000 where id='${g.wTeam}';`)
    const r = await adminRpc('buy_curse_atomic', {
      p_game_id: g.gid,
      p_buyer_team_id: g.wTeam,
      p_target_team_id: g.eTeam,
      p_actor_player_id: g.west[0].player,
      p_cost: 150,
      p_num_dice: 3,
      p_dice_total: 12,
      p_dice_rolls: [4, 4, 4],
      p_curse_ref: 'curse.intel-loss',
      p_tier: 'major',
      p_expires_at: null,
      p_params: CURSE_BY_ID.get('curse.intel-loss').params ?? {},
    })
    return r
  }

  // Give East exactly ONE card.
  db(`update teams set coins = 9000 where id='${g.eTeam}';`)
  db(`delete from cards where game_id='${g.gid}' and team_id='${g.eTeam}' and kind='intel';`)
  const firstRef = PLAIN_INTEL[0]
  const bought = await post(`/api/games/${g.gid}/buy-intel`, {
    device_id: g.east[0].device,
    player_id: g.east[0].player,
    intel_ref: firstRef,
  })
  rec.check(
    'East holds exactly 1 in_hand intel card',
    bought.status < 400 && intelInHand(g.gid, g.eTeam) === 1,
    `buy=${bought.status} ${bought.body?.error ?? 'ok'} in_hand=${intelInHand(g.gid, g.eTeam)}`,
  )

  const single = await castIntelLoss()
  rec.check(
    'intel-loss IS eligible at exactly 1 card and expires it',
    single.data?.ledger_effect?.kind === 'intel_loss' &&
      single.data?.ledger_effect?.expired_card_ref === firstRef,
    `ledger=${JSON.stringify(single.data?.ledger_effect)}`,
  )
  rec.check(
    'the last card becomes expired, not deleted (state=expired, in_hand=0)',
    intelInHand(g.gid, g.eTeam) === 0 &&
      num(
        `select count(*) from cards where game_id='${g.gid}' and team_id='${g.eTeam}' and kind='intel' and state='expired';`,
      ) === 1,
    `in_hand=${intelInHand(g.gid, g.eTeam)} expired=${num(`select count(*) from cards where game_id='${g.gid}' and team_id='${g.eTeam}' and kind='intel' and state='expired';`)}`,
  )
  rec.check(
    'exactly one intel_lost event against the victim team',
    num(
      `select count(*) from events where game_id='${g.gid}' and type='intel_lost' and payload->>'team_id'='${g.eTeam}';`,
    ) === 1,
    `intel_lost=${eventCount(g.gid, 'intel_lost')}`,
  )

  // --- at 0 in_hand: excluded from the roll -------------------------------
  const empty = await castIntelLoss()
  rec.check(
    'enemy at 0 in_hand intel: intel-loss is INELIGIBLE -> no_available_curse',
    empty.data?.error === 'no_available_curse',
    `rpc=${JSON.stringify(empty.data)}`,
  )
  rec.check(
    'the ineligible cast charges nothing and adds no second intel_lost event',
    coins(g.wTeam) === 9000 && eventCount(g.gid, 'intel_lost') === 1,
    `buyer=${coins(g.wTeam)} intel_lost=${eventCount(g.gid, 'intel_lost')}`,
  )
  rec.check(
    'an EXPIRED card does not count as a target (the expired row is still in the table)',
    num(
      `select count(*) from cards where game_id='${g.gid}' and team_id='${g.eTeam}' and kind='intel';`,
    ) === 1 && intelInHand(g.gid, g.eTeam) === 0,
    `total intel rows=1, in_hand=0 — the predicate reads state='in_hand' only (0046:113-117)`,
  )

  // --- the 0054 interaction: losing a card frees a CAP slot ----------------
  // Pre-0054 the cap counted any state, so a team at 4 that lost one to this
  // curse was locked out of intel for the rest of the game.
  const g2 = await openGame(2, 2, 'stack-intelcap')
  rec.note(`case 6b game ${g2.code} — cap frees a slot after intel-loss (0054)`)
  db(`update teams set coins = 9000 where id='${g2.eTeam}';`)
  const acquired = []
  for (const ref of PLAIN_INTEL) {
    const r = await post(`/api/games/${g2.gid}/buy-intel`, {
      device_id: g2.east[0].device,
      player_id: g2.east[0].player,
      intel_ref: ref,
    })
    if (r.status < 400) acquired.push(ref)
    else break
  }
  rec.check(
    'East fills its hand to the 4-card cap',
    intelInHand(g2.gid, g2.eTeam) === 4 && acquired.length === 4,
    `in_hand=${intelInHand(g2.gid, g2.eTeam)} acquired=${JSON.stringify(acquired)}`,
  )
  const unusedRef = PLAIN_INTEL.find((ref) => !acquired.includes(ref))
  const atCap = await post(`/api/games/${g2.gid}/buy-intel`, {
    device_id: g2.east[0].device,
    player_id: g2.east[0].player,
    intel_ref: unusedRef,
  })
  rec.check(
    'a 5th purchase at the cap is refused with intel_cap_reached',
    atCap.status === 409 && atCap.body?.error === 'intel_cap_reached',
    `status=${atCap.status} error=${atCap.body?.error} (ref ${unusedRef}, never bought)`,
  )
  db(`update teams set coins = 9000 where id='${g2.wTeam}';`)
  const capLoss = await adminRpc('buy_curse_atomic', {
    p_game_id: g2.gid,
    p_buyer_team_id: g2.wTeam,
    p_target_team_id: g2.eTeam,
    p_actor_player_id: g2.west[0].player,
    p_cost: 150,
    p_num_dice: 3,
    p_dice_total: 12,
    p_dice_rolls: [4, 4, 4],
    p_curse_ref: 'curse.intel-loss',
    p_tier: 'major',
    p_expires_at: null,
    p_params: CURSE_BY_ID.get('curse.intel-loss').params ?? {},
  })
  const lostRef = capLoss.data?.ledger_effect?.expired_card_ref
  rec.check(
    'intel-loss expires exactly one of the four held cards',
    capLoss.data?.ledger_effect?.kind === 'intel_loss' && intelInHand(g2.gid, g2.eTeam) === 3,
    `lost=${lostRef} in_hand=${intelInHand(g2.gid, g2.eTeam)}`,
  )
  db(`update teams set coins = 9000 where id='${g2.eTeam}';`)
  // The anti-farm guard is probed FIRST, while the hand is still at 3 and the
  // cap therefore has headroom. Order matters: buy-intel checks the cap BEFORE
  // the duplicate ref, so asking for the lost ref with a full hand answers
  // intel_cap_reached and proves nothing about the duplicate guard.
  const rebuySame = await post(`/api/games/${g2.gid}/buy-intel`, {
    device_id: g2.east[0].device,
    player_id: g2.east[0].player,
    intel_ref: lostRef,
  })
  rec.check(
    'the anti-farm guard still holds: the LOST ref cannot be re-bought even with a cap slot free (intel_already_purchased, state-agnostic)',
    rebuySame.status === 409 && rebuySame.body?.error === 'intel_already_purchased',
    `buy(${lostRef})=${rebuySame.status} ${rebuySame.body?.error} at in_hand=${intelInHand(g2.gid, g2.eTeam)} (cap has room, so this is the duplicate guard and not the cap)`,
  )
  const rebuyNew = await post(`/api/games/${g2.gid}/buy-intel`, {
    device_id: g2.east[0].device,
    player_id: g2.east[0].player,
    intel_ref: unusedRef,
  })
  rec.check(
    '0054: the cap counts only in_hand, so the freed slot permits a NEW ref (pre-0054 this was intel_cap_reached forever)',
    rebuyNew.status < 400 && intelInHand(g2.gid, g2.eTeam) === 4,
    `buy(${unusedRef})=${rebuyNew.status} ${rebuyNew.body?.error ?? 'ok'} in_hand=${intelInHand(g2.gid, g2.eTeam)}`,
  )
  rec.note(
    'Check order in buy-intel is cap-then-duplicate, so a team at 4 held cards asking for a ref it already owns is told intel_cap_reached. Harmless, but it means the two guards must be probed at different hand sizes to be told apart.',
  )
})

// ---------------------------------------------------------------------------
// 7. A CURSE STILL LIVE WHEN THE GAME ENDS
// ---------------------------------------------------------------------------
// Both terminal paths. The question is what happens to the row afterwards, and
// specifically whether the pg_cron sweep (0052) touches a finished game — it
// filters `status in ('live','flag_found')`, so it must NOT.
await strictStep(rec, 'endgame: a curse still active when the game ends (timeout)', async () => {
  const g = await openGame(1, 1, 'stack-end-timeout')
  rec.note(`case 7a game ${g.code} — curse live at the 180-min timeout`)

  // ORDER IS LOAD-BEARING: the clock jump comes FIRST, and the curses are
  // installed as RUNNING afterwards. pg_cron's sweep_expired_curses fires every
  // 30 s against every live game (0052), so any window in which this game is
  // still `live` AND holds an elapsed row is a window the sweep can legitimately
  // act in — and advanceClock shifts active_curses endpoints backward too, so
  // installing first would hand the sweep two elapsed rows to eat. Installing
  // running curses after the jump leaves that window empty; the rows are
  // backdated only once the game is finished, which is the state under test.
  advanceClockMinutes(g.gid, 190)
  rec.clockJump({ minutes: 190, game: g.code, reason: 'cross the 180-min deadline' })
  const running = installCurse(g.gid, g.eTeam, 'curse.mute')
  const secondRow = installCurse(g.gid, g.eTeam, 'curse.slow-walk')
  rec.check(
    'East carries two live curses going into the timeout',
    num(`select count(*) from active_curses where game_id='${g.gid}';`) === 2 &&
      num(`select count(*) from active_curses where game_id='${g.gid}' and expires_at > now();`) === 2,
    `refs=${JSON.stringify(activeRefs(g.gid, g.eTeam))} (both still running, so the live cron has nothing to take)`,
  )

  const to = await post(`/api/games/${g.gid}/end-by-timeout`, { device_id: g.west[0].device })
  rec.check(
    'the timeout settles normally with curses still on the board',
    to.status < 400 && gameStatus(g.gid) === 'finished' && to.body?.winner_team_id != null,
    `status=${to.status} game=${gameStatus(g.gid)} winner=${to.body?.winner_team_id ? 'set' : 'NULL'} reason=${to.body?.reason}`,
  )
  rec.check(
    'DANGLING ROWS: finishing the game does NOT clear active_curses — both rows survive',
    num(`select count(*) from active_curses where game_id='${g.gid}';`) === 2,
    `rows=${JSON.stringify(activeRefs(g.gid, g.eTeam))} after status=finished`,
  )
  rec.check(
    'both rows still have time left on them at the moment the game ended',
    num(`select count(*) from active_curses where game_id='${g.gid}' and expires_at > now();`) === 2,
    `running rows=${num(`select count(*) from active_curses where game_id='${g.gid}' and expires_at > now();`)} — so anything that removes them later did so on a FINISHED game`,
  )

  // The cron sweep, called DIRECTLY so the assertion does not depend on the
  // 30 s wall-clock schedule landing inside this step.
  db(`update active_curses set expires_at = now() - interval '1 minute' where game_id='${g.gid}';`)
  const swept = JSON.parse(one(`select public.sweep_expired_curses();`))
  rec.check(
    '0052: the pg_cron sweep SKIPS a finished game (its filter is status in live/flag_found)',
    num(`select count(*) from active_curses where game_id='${g.gid}';`) === 2 &&
      eventCount(g.gid, 'curse_expired') === 0,
    `sweep returned ${JSON.stringify(swept)}; rows still ${num(`select count(*) from active_curses where game_id='${g.gid}';`)}, curse_expired=${eventCount(g.gid, 'curse_expired')}`,
  )
  rec.check(
    'the sweep is not merely inert on this game — it reports zero games swept, i.e. it never selected it',
    swept.games_swept === 0 && swept.games_skipped === 0,
    `games_swept=${swept.games_swept} games_skipped=${swept.games_skipped} curses_expired=${swept.curses_expired}`,
  )

  // The CLIENT poll, by contrast, gates only on `paused`
  // (expire-curses/route.ts:62) — so it still mutates a finished game.
  const eventsBefore = num(`select count(*) from events where game_id='${g.gid}';`)
  const terminalAt = one(
    `select max(created_at)::text from events where game_id='${g.gid}' and type='game_ended_by_timeout';`,
  )
  const poll = await post(`/api/games/${g.gid}/expire-curses`, { device_id: g.west[0].device })
  const cleared = (poll.body?.expired_curse_ids ?? []).length
  const postTerminalExpiries = num(
    `select count(*) from events where game_id='${g.gid}' and type='curse_expired' and created_at > timestamptz '${terminalAt}';`,
  )
  rec.check(
    'PINNED (and wrong — see FINDING): the CLIENT poll DOES run on a finished game, clearing both rows and appending curse_expired events dated AFTER the terminal event',
    poll.status === 200 &&
      cleared === 2 &&
      num(`select count(*) from active_curses where game_id='${g.gid}';`) === 0 &&
      postTerminalExpiries === 2,
    `status=${poll.status} expired=${cleared} rows now=${num(`select count(*) from active_curses where game_id='${g.gid}';`)} events ${eventsBefore} -> ${num(`select count(*) from events where game_id='${g.gid}';`)}; curse_expired after the terminal event=${postTerminalExpiries}`,
  )
  if (cleared > 0) {
    const finding =
      `FINDING (cosmetic, post-terminal writes): expiring a curse is gated differently on the two paths. The pg_cron sweep (0052) selects only games with status in ('live','flag_found'), so it correctly ignores a finished game — verified: sweep_expired_curses() returned games_swept=0 with two elapsed rows sitting in ${g.code}. The client poll route gates ONLY on 'paused' (expire-curses/route.ts:62-66) and has no finished check, so any client left open after the game ends deletes the rows and appends ${cleared} curse_expired event(s) AFTER game_ended_by_timeout / game_won in the append-only log. Consequences measured, in order of how much they matter: (1) the results timeline shows housekeeping events dated after the game ended, which the 'newest first' page renders ABOVE the terminal event — a player opening results may see "a curse expired" as the last thing that happened; (2) the row set a spectator or a rejoining client sees for a finished game depends on whether anyone still had the app open, so two people can legitimately disagree; (3) scoring is UNAFFECTED — computeScores (lib/results/scoring.ts:42-80) reads only flag_attempt / challenge_completed / tag / curse_cast, and a timeout's scores are frozen into the game_ended_by_timeout payload (0045:241) and read back verbatim (results/route.ts:134), so no post-terminal event can move a number. Cheapest fix if wanted: add the same status filter the cron sweep already has to the route. NOT FIXED — reported for decision.`
    findings.push(finding)
    rec.note(finding)
  }
  rec.check(
    'scoring is immune to the post-terminal writes: the frozen timeout scores are returned verbatim',
    await (async () => {
      const res = await get(
        `/api/games/${g.gid}/results?device_id=${encodeURIComponent(g.west[0].device)}`,
      )
      const persisted = JSON.parse(
        one(
          `select (payload->'scores')::text from events where game_id='${g.gid}' and type='game_ended_by_timeout' order by created_at desc limit 1;`,
        ),
      )
      return (
        res.status < 400 &&
        JSON.stringify(res.body?.scores?.map((s) => s.total)) ===
          JSON.stringify(persisted.map((s) => s.total))
      )
    })(),
    'results scores equal the payload persisted by finish_game_by_timeout_atomic',
  )
})

await strictStep(rec, 'endgame: a curse still active when the game ends (flag carried home)', async () => {
  const g = await openGame(1, 1, 'stack-end-flag')
  rec.note(`case 7b game ${g.code} — curse live at a flag-carry win`)
  advanceClockMinutes(g.gid, 31)
  rec.clockJump({ minutes: 31, game: g.code, reason: 'clear the 30-min protection window' })

  const proof = await uploadFlagAttemptProof(g.gid, g.east[0].player, 'stack-flag')
  const grab = await post(`/api/games/${g.gid}/attempt-flag`, {
    device_id: g.east[0].device,
    player_id: g.east[0].player,
    landmark_ref: 'landmark.miradouro-vila-velha',
    pos: fresh(WEST_REAL),
    photo_url: proof,
  })
  rec.check(
    'East photographs the real flag and becomes carrier',
    grab.body?.result === 'real' && gameStatus(g.gid) === 'flag_found',
    `result=${grab.body?.result ?? grab.body?.error} game=${gameStatus(g.gid)}`,
  )

  // Curse BOTH teams mid-run. Both rows are installed RUNNING, for the same
  // reason as case 7a: the live pg_cron sweep would legitimately reap an elapsed
  // row while the game is still flag_found, which is not the state under test.
  const onWinner = installCurse(g.gid, g.eTeam, 'curse.mute')
  installCurse(g.gid, g.wTeam, 'curse.slow-walk')
  rec.check(
    'both teams carry a live curse into the final moment',
    num(`select count(*) from active_curses where game_id='${g.gid}';`) === 2 &&
      num(`select count(*) from active_curses where game_id='${g.gid}' and expires_at > now();`) === 2,
    `east=${JSON.stringify(activeRefs(g.gid, g.eTeam))} west=${JSON.stringify(activeRefs(g.gid, g.wTeam))}`,
  )

  const win = await post(`/api/games/${g.gid}/complete-run`, {
    device_id: g.east[0].device,
    player_id: g.east[0].player,
    pos: fresh(EAST_REAL),
  })
  rec.check(
    'the carrier wins by returning the flag while cursed',
    win.status < 400 && gameStatus(g.gid) === 'finished' &&
      eventCount(g.gid, 'game_won') === 1,
    `status=${win.status} game=${gameStatus(g.gid)} game_won=${eventCount(g.gid, 'game_won')}`,
  )
  rec.check(
    'an [A]/[C] curse never blocked the win (only full-stop/pilgrimage lock, and neither was active)',
    win.status < 400,
    `curses at win: east=${JSON.stringify(activeRefs(g.gid, g.eTeam))} west=${JSON.stringify(activeRefs(g.gid, g.wTeam))}`,
  )
  rec.check(
    'the flag win also leaves active_curses untouched',
    num(`select count(*) from active_curses where game_id='${g.gid}';`) === 2 &&
      curseIdOf(g.gid, g.eTeam, 'curse.mute') === onWinner,
    `rows=${num(`select count(*) from active_curses where game_id='${g.gid}';`)}`,
  )
  // Backdate both rows only NOW, with the game already finished, so the sweep is
  // being asked about exactly the case under test.
  db(`update active_curses set expires_at = now() - interval '1 minute' where game_id='${g.gid}';`)
  const sweptFlag = JSON.parse(one(`select public.sweep_expired_curses();`))
  rec.check(
    '0052: the cron sweep skips a flag-win finished game too, even with both rows elapsed',
    num(`select count(*) from active_curses where game_id='${g.gid}';`) === 2 &&
      eventCount(g.gid, 'curse_expired') === 0,
    `sweep=${JSON.stringify(sweptFlag)} rows=${num(`select count(*) from active_curses where game_id='${g.gid}';`)} curse_expired=${eventCount(g.gid, 'curse_expired')}`,
  )
  // And no gameplay is possible afterwards, curse or no curse.
  const lateBuy = await post(`/api/games/${g.gid}/buy-curse`, {
    device_id: g.west[0].device,
    player_id: g.west[0].player,
    num_dice: 1,
  })
  rec.check(
    'no new curse can be cast once the game is finished (game_not_in_play, not actions_locked)',
    lateBuy.status === 409 && lateBuy.body?.error === 'game_not_in_play',
    `status=${lateBuy.status} error=${lateBuy.body?.error}`,
  )
  rec.note(
    `Both terminal paths leave active_curses populated. That is by design for the ledger (events are the history; active_curses is live state), and the cron sweep correctly declines to touch a finished game. The only writer that still does is the client poll — see the finding under case 7a.`,
  )
})

// ---------------------------------------------------------------------------
rec.note('--- FINDINGS ---')
if (findings.length === 0) rec.note('none')
for (const f of findings) rec.note(f)

const { failed } = rec.finish({ curseStackingFindings: findings })
process.exitCode = failed > 0 ? 1 : 0
