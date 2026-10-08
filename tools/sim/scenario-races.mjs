// Concurrency, races and failure modes.
//
//   node tools/sim/scenario-races.mjs [seed]
//
// Pure-API. Every "simultaneous" pair is a real Promise.all against the dev
// server, so the assertions are about what the DATABASE serialized, not about
// what a client chose to render.
//
// Where the locking lives (read before changing an assertion):
//   0030:10-80   gameplay_action_guard_locked — games FOR UPDATE, then actor
//   0044:76-96   bulk tag: lock every requested raider, all-or-nothing
//   0040:20-22   attempt-start advisory lock + 60 s / 15 s cooldowns (57, 66)
//   0026:158-198 two-stage respawn (arrive -> clear)
//   0023:10-85   complete_flag_run_atomic (retry-stable winner)
//   0045:88-261  finish_game_by_timeout_atomic (+ time-bonus cap)
//   0046:12-62   expire_active_curse_ref_locked (shared by cast + bulk expiry)
//   0049:23      bulk expiry now takes games FOR UPDATE first (deadlock fix)
//   0048:45      review auto-accept deadline vs WALL clock
//   0025/0027    weather pause: resume shifts started_at + curses
//   0050         ...and now pending challenge submitted_at too (P11 fix)
//   0052         pg_cron sweep_expired_curses every 30 s (P13 fix), which
//                skips paused games — curse expiry is no longer client-only

import {
  makeGameN,
  coord,
  apiGet,
  apiPost,
  db,
  dbScript,
  adminRpc,
  BASE,
  uploadFlagAttemptProof,
  uploadChallengeProof,
} from './harness.mjs'
import { advanceClock, advanceClockMinutes } from './clock.mjs'
import { makeRecorder, strictStep } from './artifact.mjs'
import { offsetMeters, pointAtDistance } from './movement.mjs'
import { haversineMeters as hav } from './geoutil.mjs'

const seed = Number(process.argv[2] || 20260924)
const rec = makeRecorder({ scenario: 'races', seed })

const WEST_REAL = coord('landmark.miradouro-vila-velha') // West real flag + West home
const WEST_DECOY = coord('landmark.miradouro-meia-laranja')
const WEST_EMPTY_A = coord('landmark.mercado-municipal')
const WEST_EMPTY_B = coord('landmark.parque-florestal')
const EAST_REAL = coord('landmark.biblioteca-municipal') // East real flag + East home

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

/**
 * Wait until the dev server answers. Next recompiles on demand and a heavy
 * concurrent burst against a cold route can make it drop the listener briefly;
 * without this a whole step fails with a bare "fetch failed" that looks like an
 * app bug. Deliberately NOT a retry inside post(): retrying a mutation would
 * destroy the simultaneity the race assertions depend on.
 */
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

function playerState(playerId) {
  const row = one(
    `select respawning::text||'|'||coalesce(respawn_target_ref,'')||'|'||respawn_arrived::text||'|'||flag_carrier::text from players where id='${playerId}';`,
  )
  const [respawning, target, arrived, carrier] = (row ?? '|||').split('|')
  return {
    respawning: respawning === 'true',
    target: target || null,
    arrived: arrived === 'true',
    carrier: carrier === 'true',
  }
}
const resetPlayer = (playerId) =>
  db(
    `update players set respawning=false, respawn_arrived=false, respawn_target_ref=null where id='${playerId}';`,
  )
const fund = (gid, amount = 900) =>
  db(`update teams set coins = ${amount} where game_id='${gid}';`)

/** Production binding for a tag: a camping heartbeat <=15 s old (0044:72). */
async function heartbeat(g, actor, pos) {
  const r = await post(`/api/games/${g.gid}/camping-heartbeat`, {
    device_id: actor.device,
    player_id: actor.player,
    pos: fresh(pos),
  })
  return r.body?.last_heartbeat_at ?? null
}

/**
 * Next dev compiles a route on its FIRST hit. Without this, a Promise.all pair
 * is not simultaneous at all: the first request pays a multi-second compile and
 * the second arrives long after it committed. Warm every route under test with
 * an empty body (-> 400 invalid_body), which compiles the module and mutates
 * nothing.
 */
async function warmRoutes(gid) {
  const routes = [
    'buy-curse', 'buy-intel', 'tag', 'attempt-flag', 'attempt-start',
    'complete-run', 'end-by-timeout', 'expire-curses', 'camping-heartbeat',
    'submit-challenge', 'accept-challenge', 'reject-challenge',
    'resolve-challenge-reviews', 'pause', 'time-tick', 'respawn-clear',
    'harden-flag',
  ]
  await Promise.all(routes.map((r) => post(`/api/games/${gid}/${r}`, {})))
  await fetch(`${BASE}/api/games/${gid}/challenges?device_id=warm`)
  await fetch(`${BASE}/api/games/${gid}/live-state?device_id=warm`)
}

/** Weather pause needs both teams to vote (0025:65-67). */
async function weather(g, action) {
  const first = await post(`/api/games/${g.gid}/pause`, {
    device_id: g.west[0].device,
    player_id: g.west[0].player,
    action,
  })
  const second = await post(`/api/games/${g.gid}/pause`, {
    device_id: g.east[0].device,
    player_id: g.east[0].player,
    action,
  })
  return { first, second }
}

async function attemptFlag(g, actor, ref, atPoint, tag) {
  const proof = await uploadFlagAttemptProof(g.gid, actor.player, tag)
  return post(`/api/games/${g.gid}/attempt-flag`, {
    device_id: actor.device,
    player_id: actor.player,
    landmark_ref: ref,
    pos: fresh(atPoint),
    photo_url: proof,
  })
}

const openGame = async (westN, eastN, tag, { protect = false } = {}) => {
  await waitForServer()
  // Next dev compiles routes on first hit and can return a 500 HTML error page
  // for a cold route under load. Retry SETUP only (never a mutation under test).
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
  fund(g.gid)
  if (!protect) {
    advanceClockMinutes(g.gid, 31) // clear the 30-min protection window
    rec.clockJump({ minutes: 31, game: g.code, reason: 'open attempt window' })
  }
  return g
}

await waitForServer()

// ---------------------------------------------------------------------------
// 1. TWO PURCHASES RACING ONE BALANCE
// ---------------------------------------------------------------------------
// Exactly one curse cost in the bank (50 = COIN_COST_PER_DIE x 1 die). Both
// requests read 50 at the route level (buy-curse/route.ts:190) and both then
// enter buy_curse_atomic, which locks games (0030:152) then both team rows in
// UUID order (0046:92-95) before rechecking the balance (0046:102).
await strictStep(rec, 'race: two curse purchases, one balance', async () => {
  const g = await openGame(2, 2, 'race-coins')
  rec.bindGame(g.gid, g.code)
  rec.note(`case 1 game ${g.code}`)
  await warmRoutes(g.gid)
  db(`update teams set coins = 50 where id='${g.wTeam}';`)
  db(`update teams set coins = 300 where id='${g.eTeam}';`)

  const [a, b] = await Promise.all([
    post(`/api/games/${g.gid}/buy-curse`, {
      device_id: g.west[0].device,
      player_id: g.west[0].player,
      num_dice: 1,
    }),
    post(`/api/games/${g.gid}/buy-curse`, {
      device_id: g.west[1].device,
      player_id: g.west[1].player,
      num_dice: 1,
    }),
  ])
  const ok = [a, b].filter((r) => r.status < 400)
  const broke = [a, b].filter((r) => r.body?.error === 'insufficient_coins')
  const after = coins(g.wTeam)

  rec.check(
    'exactly one of two simultaneous 50-coin curse buys succeeds',
    ok.length === 1,
    `statuses=${a.status}/${b.status} refs=${[a, b].map((r) => r.body?.curse_ref ?? r.body?.error).join(',')}`,
  )
  rec.check(
    'the loser fails with insufficient_coins (409), not a 500',
    broke.length === 1 && broke[0].status === 409,
    `loser=${JSON.stringify([a, b].find((r) => r.status >= 400)?.body ?? null).slice(0, 160)}`,
  )
  rec.check(
    'balance never goes negative (50 - 50 = 0)',
    after === 0,
    `coins=${after}`,
  )
  rec.check(
    'exactly one coins_deducted/buy_curse event was written',
    num(
      `select count(*) from events where game_id='${g.gid}' and type='coins_deducted' and payload->>'reason'='buy_curse';`,
    ) === 1,
    `curse_cast events=${eventCount(g.gid, 'curse_cast')}`,
  )
})

// ---------------------------------------------------------------------------
// 2. BULK TAG WHERE ONE TARGET IS ALREADY RESPAWNING
// ---------------------------------------------------------------------------
// Three probes, because the route and the RPC answer different questions:
//   (a) route-level pre-filter (tag/route.ts:285-288)
//   (b) the 0044:87-96 precondition itself, driven directly
//   (c) the genuine race the precondition exists for
await strictStep(rec, 'race: bulk tag with a stale target', async () => {
  const g = await openGame(2, 2, 'race-bulk')
  rec.note(`case 2 game ${g.code}`)
  await warmRoutes(g.gid)
  const [d1, d2] = g.west
  const [r1, r2] = g.east
  const raiderPos = offsetMeters(WEST_REAL, 8, 0)

  // (a) One target ALREADY respawning when the route reads the roster.
  resetPlayer(r1.player)
  db(`update players set respawning=true, respawn_target_ref='landmark.largo-do-pelourinho', respawn_arrived=false where id='${r2.player}';`)
  await heartbeat(g, d1, WEST_REAL)
  const routeLevel = await post(`/api/games/${g.gid}/tag`, {
    device_id: d1.device,
    tagger_player_id: d1.player,
    tagger_pos: fresh(WEST_REAL),
    targets: [
      { player_id: r1.player, pos: fresh(raiderPos) },
      { player_id: r2.player, pos: fresh(raiderPos) },
    ],
  })
  rec.check(
    'route pre-filter: already-respawning target is rejected, the other IS tagged (not all-or-nothing)',
    routeLevel.body?.tagged_player_ids?.length === 1 &&
      routeLevel.body.tagged_player_ids[0] === r1.player,
    `tagged=${JSON.stringify(routeLevel.body?.tagged_player_ids)} rejected=${JSON.stringify(routeLevel.body?.rejected)}`,
  )
  rec.note(
    'route strips known-respawning targets BEFORE the RPC, so a batch that is stale at request time is partially applied by design',
  )

  // (b) Drive the 0044 precondition directly: both ids handed to the RPC while
  // one is respawning. This is what the route would submit if the state changed
  // between its read and the RPC call.
  resetPlayer(r1.player)
  db(`update players set respawning=true, respawn_target_ref='landmark.largo-do-pelourinho', respawn_arrived=false where id='${r2.player}';`)
  const hb = await heartbeat(g, d1, WEST_REAL)
  const direct = await adminRpc('apply_tags_atomic', {
    p_game_id: g.gid,
    p_raider_player_ids: [r1.player, r2.player],
    p_defender_player_id: d1.player,
    p_lat: WEST_REAL.lat,
    p_lng: WEST_REAL.lng,
    p_respawn_target_ref: 'landmark.largo-do-pelourinho',
    p_expected_camping_heartbeat_at: hb,
  })
  const afterDirect = playerState(r1.player)
  rec.check(
    '0044 precondition: RPC aborts the whole batch with target_state_changed',
    direct.data?.error === 'target_state_changed',
    `rpc=${JSON.stringify(direct.data)} err=${direct.error?.message ?? 'none'}`,
  )
  rec.check(
    'all-or-nothing: the healthy raider in that batch is NOT tagged',
    afterDirect.respawning === false,
    `r1.respawning=${afterDirect.respawning}`,
  )

  // (c) The genuine race: two defenders tag overlapping sets at the same time.
  // D1 tags {r1, r2}; D2 tags {r2}. Both route reads see two live raiders.
  resetPlayer(r1.player)
  resetPlayer(r2.player)
  const tagRowsBefore = num(`select count(*) from tags where game_id='${g.gid}';`)
  const hb1 = await heartbeat(g, d1, WEST_REAL)
  const hb2 = await heartbeat(g, d2, WEST_REAL)
  rec.note(`heartbeats primed d1=${hb1 ? 'ok' : 'MISSING'} d2=${hb2 ? 'ok' : 'MISSING'}`)
  const [batch, single] = await Promise.all([
    post(`/api/games/${g.gid}/tag`, {
      device_id: d1.device,
      tagger_player_id: d1.player,
      tagger_pos: fresh(WEST_REAL),
      targets: [
        { player_id: r1.player, pos: fresh(raiderPos) },
        { player_id: r2.player, pos: fresh(raiderPos) },
      ],
    }),
    post(`/api/games/${g.gid}/tag`, {
      device_id: d2.device,
      tagger_player_id: d2.player,
      tagger_pos: fresh(WEST_REAL),
      targets: [{ player_id: r2.player, pos: fresh(raiderPos) }],
    }),
  ])
  const batchTagged = batch.body?.tagged_player_ids ?? []
  const singleTagged = single.body?.tagged_player_ids ?? []
  // Delta only: probe (a) already wrote one tag row for r1.
  const newTagRows =
    num(`select count(*) from tags where game_id='${g.gid}';`) - tagRowsBefore
  const s1 = playerState(r1.player)
  const s2 = playerState(r2.player)
  const batchAborted = (batch.body?.rejected ?? []).some(
    (x) => x.reason === 'batch_aborted' || x.reason === 'already_respawning',
  )
  rec.check(
    'concurrent overlapping tags: r2 is tagged exactly once, never twice',
    newTagRows === batchTagged.length + singleTagged.length && newTagRows <= 2,
    `batch=${JSON.stringify(batchTagged)} single=${JSON.stringify(singleTagged)} new_tag_rows=${newTagRows}`,
  )
  rec.check(
    'whichever lost, no player is double-tagged and no request 500s',
    batch.status < 500 && single.status < 500 &&
      num(`select count(*) from tags where game_id='${g.gid}' and raider_player_id='${r2.player}';`) <= 2,
    `batchStatus=${batch.status} singleStatus=${single.status}`,
  )
  rec.check(
    'if the batch lost the race it applied NOTHING (r1 untouched)',
    batchTagged.length > 0 ? true : s1.respawning === false,
    `batchAborted=${batchAborted} r1.respawning=${s1.respawning} r2.respawning=${s2.respawning} rejected=${JSON.stringify(batch.body?.rejected ?? [])}`,
  )
  rec.note(
    `race outcome: batch tagged ${batchTagged.length}, single tagged ${singleTagged.length}; batch rejected=${JSON.stringify(batch.body?.rejected ?? [])}`,
  )

  // Repeat the race a bounded number of times to actually OBSERVE the 0044
  // abort path through the route (which ordering wins is not deterministic).
  let observedAbort = null
  for (let i = 0; i < 12 && !observedAbort; i++) {
    resetPlayer(r1.player)
    resetPlayer(r2.player)
    await heartbeat(g, d1, WEST_REAL)
    await heartbeat(g, d2, WEST_REAL)
    const [bb, ss] = await Promise.all([
      post(`/api/games/${g.gid}/tag`, {
        device_id: d1.device,
        tagger_player_id: d1.player,
        tagger_pos: fresh(WEST_REAL),
        targets: [
          { player_id: r1.player, pos: fresh(raiderPos) },
          { player_id: r2.player, pos: fresh(raiderPos) },
        ],
      }),
      post(`/api/games/${g.gid}/tag`, {
        device_id: d2.device,
        tagger_player_id: d2.player,
        tagger_pos: fresh(WEST_REAL),
        targets: [{ player_id: r2.player, pos: fresh(raiderPos) }],
      }),
    ])
    const reasons = (bb.body?.rejected ?? []).map((x) => x.reason)
    if (reasons.includes('batch_aborted')) {
      observedAbort = { attempt: i + 1, reasons, tagged: bb.body?.tagged_player_ids ?? [], r1: playerState(r1.player) }
    }
  }
  if (observedAbort) {
    rec.check(
      'observed the 0044 abort through the route: nothing from the batch was applied',
      observedAbort.tagged.length === 0 && observedAbort.r1.respawning === false,
      `attempt #${observedAbort.attempt}: reasons=${JSON.stringify(observedAbort.reasons)} tagged=${JSON.stringify(observedAbort.tagged)} r1.respawning=${observedAbort.r1.respawning}`,
    )
    rec.note(
      'PLAYER EXPERIENCE: on abort, tag/route.ts:328-336 labels every innocent target "batch_aborted" and only the id that changed gets "already_respawning". The tapping defender sees a tag that did nothing, with a reason string that has no player-facing copy; their teammate who tagged one of the same raiders succeeded. Nothing tells them to re-tap, and the raider standing in front of them is still live.',
    )
  } else {
    rec.note(
      'the 0044 abort path did not fire in 12 concurrent attempts — the advisory/row lock ordering usually lets the batch win outright. It is exercised directly above via apply_tags_atomic. When it does fire, tag/route.ts:328-336 reports "batch_aborted", a reason with no player-facing copy.',
    )
  }
})

// ---------------------------------------------------------------------------
// 3. BOTH TEAMS VALIDATING A REAL FLAG SIMULTANEOUSLY
// ---------------------------------------------------------------------------
// attempt_flag_atomic requires status = 'live' (0030:293). The first commit
// flips the game to flag_found, so the second must be refused.
await strictStep(rec, 'race: both real flags photographed at once', async () => {
  const g = await openGame(2, 2, 'race-dual')
  rec.note(`case 3 game ${g.code}`)
  await warmRoutes(g.gid)
  const westProof = await uploadFlagAttemptProof(g.gid, g.west[0].player, 'dual-w')
  const eastProof = await uploadFlagAttemptProof(g.gid, g.east[0].player, 'dual-e')

  const [westTry, eastTry] = await Promise.all([
    post(`/api/games/${g.gid}/attempt-flag`, {
      device_id: g.west[0].device,
      player_id: g.west[0].player,
      landmark_ref: 'landmark.biblioteca-municipal',
      pos: fresh(EAST_REAL),
      photo_url: westProof,
    }),
    post(`/api/games/${g.gid}/attempt-flag`, {
      device_id: g.east[0].device,
      player_id: g.east[0].player,
      landmark_ref: 'landmark.miradouro-vila-velha',
      pos: fresh(WEST_REAL),
      photo_url: eastProof,
    }),
  ])
  const carriers = db(
    `select p.display_name from players p join teams t on t.id=p.team_id where t.game_id='${g.gid}' and p.flag_carrier;`,
  )
  const status = gameStatus(g.gid)
  const winners = [westTry, eastTry].filter((r) => r.body?.result === 'real')

  rec.check(
    'exactly ONE team is recorded as flag carrier',
    carriers.length === 1,
    `carriers=${JSON.stringify(carriers)} west=${westTry.status}/${westTry.body?.result ?? westTry.body?.error} east=${eastTry.status}/${eastTry.body?.result ?? eastTry.body?.error}`,
  )
  rec.check(
    'the game reaches flag_found',
    status === 'flag_found',
    `status=${status}`,
  )
  rec.check(
    'the loser is refused coherently (409), and no second flag_found event exists',
    winners.length === 1 && eventCount(g.gid, 'flag_found') === 1,
    `flag_found events=${eventCount(g.gid, 'flag_found')} loser=${JSON.stringify([westTry, eastTry].find((r) => r.body?.result !== 'real')?.body ?? null).slice(0, 140)}`,
  )
  const loser = [westTry, eastTry].find((r) => r.body?.result !== 'real')
  rec.note(
    `winner = ${westTry.body?.result === 'real' ? 'West' : 'East'}; loser got ${loser?.status} ${loser?.body?.error} — attempt_flag_atomic only permits status 'live' (0030:293), so the flag_found commit locks the other team out mid-photo. The losing team's own real-flag photo is discarded with no record that they were simultaneous.`,
  )
})

// ---------------------------------------------------------------------------
// 4. FLAG CARRIER TAGGED  (headline)
// ---------------------------------------------------------------------------
await strictStep(rec, 'flag carrier tagged then completes the run', async () => {
  const g = await openGame(2, 2, 'race-carrier')
  rec.note(`case 4 game ${g.code}`)
  await warmRoutes(g.gid)
  const carrier = g.east[0]
  const defender = g.west[0]

  const grab = await attemptFlag(g, carrier, 'landmark.miradouro-vila-velha', WEST_REAL, 'carrier-grab')
  rec.check(
    'East raider photographs West real flag and becomes carrier',
    grab.body?.result === 'real' && playerState(carrier.player).carrier,
    `status=${grab.status} result=${grab.body?.result} game=${gameStatus(g.gid)}`,
  )

  // Carrier stands on the West candidate (within 50 m -> raider, zones.ts:13).
  await heartbeat(g, defender, WEST_REAL)
  const tagged = await post(`/api/games/${g.gid}/tag`, {
    device_id: defender.device,
    tagger_player_id: defender.player,
    tagger_pos: fresh(WEST_REAL),
    targets: [{ player_id: carrier.player, pos: fresh(offsetMeters(WEST_REAL, 6, 0)) }],
  })
  const afterTag = playerState(carrier.player)
  rec.check(
    'the carrier CAN be tagged while carrying',
    (tagged.body?.tagged_player_ids ?? []).includes(carrier.player),
    `tagged=${JSON.stringify(tagged.body?.tagged_player_ids)} rejected=${JSON.stringify(tagged.body?.rejected)}`,
  )
  rec.check(
    'P2 FIXED (0053): the tag CLEARS players.flag_carrier',
    afterTag.carrier === false,
    `flag_carrier=${afterTag.carrier} respawning=${afterTag.respawning} respawn_target_ref=${afterTag.target}`,
  )
  const stripEvents = db(
    `select count(*) from events where game_id='${g.gid}' and type='flag_carrier_stripped';`,
  )
  rec.check(
    'the strip emits exactly one flag_carrier_stripped event (so the UI can say the run ended)',
    Number(stripEvents[0]) === 1,
    `flag_carrier_stripped events=${stripEvents[0]}`,
  )
  rec.check(
    'the flag stays DISCOVERED — games.status is not reverted, so the photo keeps its +10',
    gameStatus(g.gid) === 'flag_found',
    `games.status=${gameStatus(g.gid)}`,
  )
  rec.note(
    `DB after tag: flag_carrier=${afterTag.carrier}, respawning=${afterTag.respawning}, respawn_arrived=${afterTag.arrived}, respawn_target_ref=${afterTag.target}, games.status=${gameStatus(g.gid)}`,
  )

  // While respawning the run is refused. Post-0053 the carrier flag is already
  // gone, so the route's not_flag_carrier check (403) fires before the
  // respawning check (409) — both are correct refusals of the same run.
  const tooEarly = await post(`/api/games/${g.gid}/complete-run`, {
    device_id: carrier.device,
    player_id: carrier.player,
    pos: fresh(EAST_REAL),
  })
  rec.check(
    'a tagged, respawning ex-carrier cannot complete the run',
    tooEarly.status >= 400 &&
      ['not_flag_carrier', 'player_respawning'].includes(tooEarly.body?.error),
    `status=${tooEarly.status} error=${tooEarly.body?.error}`,
  )

  // Two-stage respawn at the assigned neutral (0026:158-198).
  const neutral = coord(afterTag.target)
  const arrive = await post(`/api/games/${g.gid}/respawn-clear`, {
    device_id: carrier.device,
    player_id: carrier.player,
    pos: fresh(neutral),
  })
  const away = offsetMeters(neutral, 60, 0)
  const clear = await post(`/api/games/${g.gid}/respawn-clear`, {
    device_id: carrier.device,
    player_id: carrier.player,
    pos: fresh(away),
  })
  rec.check(
    'two-stage respawn: arrived then cleared',
    arrive.body?.stage === 'arrived' && clear.body?.stage === 'cleared',
    `stage1=${arrive.body?.stage ?? arrive.body?.error} stage2=${clear.body?.stage ?? clear.body?.error} leave_d=${hav(neutral, away).toFixed(0)}m`,
  )
  const afterClear = playerState(carrier.player)
  rec.check(
    'the strip persists through the whole respawn cycle (not restored on clear)',
    afterClear.carrier === false && afterClear.respawning === false,
    `flag_carrier=${afterClear.carrier} respawning=${afterClear.respawning}`,
  )

  const win = await post(`/api/games/${g.gid}/complete-run`, {
    device_id: carrier.device,
    player_id: carrier.player,
    pos: fresh(EAST_REAL),
  })
  rec.check(
    'P2 FIXED (0053): the tagged carrier CANNOT win — the run is over, not merely delayed',
    win.status >= 400 &&
      win.body?.error === 'not_flag_carrier' &&
      gameStatus(g.gid) !== 'finished',
    `status=${win.status} error=${win.body?.error} game=${gameStatus(g.gid)}`,
  )
  rec.note(
    'P2 (fixed, migration 0053): a tag now ends the run. flag_carrier is cleared in apply_tag_atomic_unchecked — the shared per-raider body, so single and bulk tags both strip — and a flag_carrier_stripped event is emitted so both teams can be told. games.status stays flag_found on purpose: the enemy flag remains discovered and the photo keeps its +10 (§13), but the team must photograph it again and carry it home on a fresh run. Every legal tag already requires the defender to stand inside their own defense zone (tag/route.ts:185), so there is no separate "only at home" condition to check.',
  )
})

// ---------------------------------------------------------------------------
// 5. CARRIER CROSSING HOME AS THE TIMEOUT FIRES
// ---------------------------------------------------------------------------
await strictStep(rec, 'race: complete-run vs end-by-timeout', async () => {
  const g = await openGame(2, 2, 'race-timeout')
  rec.note(`case 5 game ${g.code}`)
  await warmRoutes(g.gid)
  const carrier = g.east[0]
  const grab = await attemptFlag(g, carrier, 'landmark.miradouro-vila-velha', WEST_REAL, 'timeout-grab')
  rec.check(
    'carrier established before the deadline',
    grab.body?.result === 'real',
    `result=${grab.body?.result ?? grab.body?.error}`,
  )

  advanceClock(g.gid, 150 * 60 + 10) // elapsed ~181 min, past the 180 min limit
  rec.clockJump({ seconds: 150 * 60 + 10, game: g.code, reason: 'cross the 180-min deadline' })
  const elapsedMin = num(
    `select round(extract(epoch from (now() - started_at))/60) from games where id='${g.gid}';`,
  )

  const [run, timeout] = await Promise.all([
    post(`/api/games/${g.gid}/complete-run`, {
      device_id: carrier.device,
      player_id: carrier.player,
      pos: fresh(EAST_REAL),
    }),
    post(`/api/games/${g.gid}/end-by-timeout`, { device_id: g.west[0].device }),
  ])
  const flagWins = num(
    `select count(*) from events where game_id='${g.gid}' and type='game_won' and payload->>'reason'='flag_returned';`,
  )
  const timeouts = eventCount(g.gid, 'game_ended_by_timeout')
  const endedAt = num(
    `select count(*) from games where id='${g.gid}' and status='finished' and ended_at is not null;`,
  )

  rec.check(
    'exactly ONE terminal decision is recorded (flag_returned XOR timeout)',
    flagWins + timeouts === 1,
    `game_won[flag_returned]=${flagWins} game_ended_by_timeout=${timeouts} elapsed=${elapsedMin}min`,
  )
  rec.check(
    'the game is finished exactly once, with ended_at set',
    endedAt === 1 && gameStatus(g.gid) === 'finished',
    `status=${gameStatus(g.gid)} ended_at_rows=${endedAt}`,
  )
  rec.check(
    'total game_won events never exceeds one',
    eventCount(g.gid, 'game_won') === 1,
    `game_won=${eventCount(g.gid, 'game_won')}`,
  )
  rec.note(
    `complete-run -> ${run.status} ${JSON.stringify(run.body?.winner_team_id ?? run.body?.error)}; end-by-timeout -> ${timeout.status} reason=${timeout.body?.reason}.`,
  )
  rec.check(
    'a carrier at home base after the deadline can never win by flag return',
    flagWins === 0 && timeouts === 1,
    `the nominal deadline is authoritative: 0030:49-51 returns game_expired before the timeout commits, and 0030:340-344 returns the persisted TIMEOUT winner after it does. Either ordering ends in a timeout result.`,
  )
  if (run.status < 400) {
    const namedWinner = run.body?.winner_team_id
    rec.check(
      'FINDING: a 200 from complete-run may name the OTHER team as winner',
      namedWinner !== undefined,
      `complete-run 200 winner_team_id=${namedWinner === g.eTeam ? 'East (carrier)' : namedWinner === g.wTeam ? 'West (NOT the carrier)' : namedWinner}; timeout winner=${timeout.body?.winner_team_id === g.wTeam ? 'West' : 'East'}`,
    )
    rec.note(
      'PLAYER EXPERIENCE: the carrier taps "Return flag", gets a success response, and complete_flag_run_atomic short-circuits on status=finished (0030:340-344) to hand back whatever winner the timeout already persisted. FlagCarrierBanner reads that as their own success even when the winner named is the other team.',
    )
  }

  // Deterministic probe for the status-code contract: the same guard, with no
  // concurrent timeout to mask it. 0030:51 returns game_expired, which
  // complete-run/route.ts:173-176 has no branch for.
  const g2 = await openGame(2, 2, 'race-expired-solo')
  await warmRoutes(g2.gid)
  const solo = g2.east[0]
  const grab2 = await attemptFlag(g2, solo, 'landmark.miradouro-vila-velha', WEST_REAL, 'solo-grab')
  rec.check(
    `control game ${g2.code}: carrier established`,
    grab2.body?.result === 'real',
    `result=${grab2.body?.result ?? grab2.body?.error}`,
  )
  advanceClock(g2.gid, 150 * 60 + 10)
  rec.clockJump({ seconds: 150 * 60 + 10, game: g2.code, reason: 'cross the deadline with nobody calling end-by-timeout' })
  const late = await post(`/api/games/${g2.gid}/complete-run`, {
    device_id: solo.device,
    player_id: solo.player,
    pos: fresh(EAST_REAL),
  })
  rec.check(
    'APP BUG: complete-run returns HTTP 500 for the expected game_expired guard',
    !(late.body?.error === 'game_expired' && late.status === 500),
    `complete-run -> ${late.status} ${late.body?.error}. complete-run/route.ts:173-176 maps not_flag_carrier/game_not_in_flag_found/player_respawning/not_found and defaults everything else to 500, but gameplay_action_guard_locked (0030:51) legitimately returns game_expired. The three challenge routes DO map it to 409 (submit-challenge/route.ts:313-318).`,
  )
  if (late.status === 500) {
    rec.note(
      'PLAYER EXPERIENCE: a carrier who reaches home one second late gets a 500. The UI shows a generic server failure, indistinguishable from a dropped connection, so they will retry at the geofence instead of being told the game is over.',
    )
  }
})

// ---------------------------------------------------------------------------
// 6. TAG LANDING MID-ATTEMPT
// ---------------------------------------------------------------------------
// Decoy target, so neither outcome ends the game and the two effects are
// mutually exclusive: a decoy sets respawning (0026:138-142) and a tag needs
// `not p.respawning` (0044:92).
await strictStep(rec, 'race: tag vs flag attempt on the same player', async () => {
  const g = await openGame(2, 2, 'race-mid')
  rec.note(`case 6 game ${g.code}`)
  await warmRoutes(g.gid)
  const attacker = g.east[0]
  const defender = g.west[0]
  // Give the attacking team an intel card to verify race outcomes preserve it.
  const buy = await post(`/api/games/${g.gid}/buy-intel`, {
    device_id: attacker.device,
    player_id: attacker.player,
    intel_ref: 'intel.north-south',
  })
  rec.note(`seed intel for East: ${buy.status} ${buy.body?.intel_ref ?? buy.body?.error}`)

  const attackerPos = offsetMeters(WEST_DECOY, 8, 0)
  const proof = await uploadFlagAttemptProof(g.gid, attacker.player, 'mid-decoy')
  await heartbeat(g, defender, WEST_DECOY)

  const [attempt, tag] = await Promise.all([
    post(`/api/games/${g.gid}/attempt-flag`, {
      device_id: attacker.device,
      player_id: attacker.player,
      landmark_ref: 'landmark.miradouro-meia-laranja',
      pos: fresh(attackerPos),
      photo_url: proof,
    }),
    post(`/api/games/${g.gid}/tag`, {
      device_id: defender.device,
      tagger_player_id: defender.player,
      tagger_pos: fresh(WEST_DECOY),
      targets: [{ player_id: attacker.player, pos: fresh(attackerPos) }],
    }),
  ])
  const attemptApplied = eventCount(g.gid, 'flag_attempt') === 1
  const tagApplied = num(`select count(*) from tags where game_id='${g.gid}';`) === 1
  const state = playerState(attacker.player)

  rec.check(
    'exactly one of {attempt, tag} is applied — never both',
    (attemptApplied ? 1 : 0) + (tagApplied ? 1 : 0) === 1,
    `attempt=${attempt.status}/${attempt.body?.result ?? attempt.body?.error} tag=${tag.status}/${JSON.stringify(tag.body?.tagged_player_ids ?? tag.body?.rejected)}`,
  )
  rec.check(
    'the loser is a clean 409 (or an empty tag), never a 500',
    attempt.status !== 500 && tag.status !== 500,
    `attemptStatus=${attempt.status} tagStatus=${tag.status}`,
  )
  rec.check(
    'the attacker ends up respawning exactly once either way',
    state.respawning === true && state.target !== null,
    `respawning=${state.respawning} target=${state.target}`,
  )
  rec.note(
    attemptApplied
      ? `attempt won: decoy applied, tag rejected as ${JSON.stringify((tag.body?.rejected ?? []).map((r) => r.reason))} (0044:92 saw respawning=true)`
      : `tag won: attempt refused with ${attempt.status} ${attempt.body?.error} (0030:66-68 player_respawning)`,
  )
  if (attemptApplied && (tag.body?.rejected ?? []).some((r) => r.reason === 'batch_aborted')) {
    rec.note(
      'PLAYER EXPERIENCE: the defender was told "batch_aborted" for a single-target tap. The label is only meaningful for a multi-raider batch; on a 1-target tag it is a confusing non-answer where "they already went down" is the truth.',
    )
  }

  // Deterministic probes for BOTH orderings, so neither branch is left
  // unexercised by a lucky interleaving.
  const attemptFirst = await openGame(2, 2, 'race-mid-a')
  await warmRoutes(attemptFirst.gid)
  const aA = attemptFirst.east[0]
  const dA = attemptFirst.west[0]
  const decoyHit = await attemptFlag(
    attemptFirst, aA, 'landmark.miradouro-meia-laranja', WEST_DECOY, 'mid-a',
  )
  await heartbeat(attemptFirst, dA, WEST_DECOY)
  const tagAfter = await post(`/api/games/${attemptFirst.gid}/tag`, {
    device_id: dA.device,
    tagger_player_id: dA.player,
    tagger_pos: fresh(WEST_DECOY),
    targets: [{ player_id: aA.player, pos: fresh(offsetMeters(WEST_DECOY, 7, 0)) }],
  })
  rec.check(
    'ordering A (attempt commits first): the later tag lands on nobody',
    decoyHit.body?.result === 'decoy' &&
      (tagAfter.body?.tagged_player_ids ?? []).length === 0 &&
      num(`select count(*) from tags where game_id='${attemptFirst.gid}';`) === 0,
    `attempt=${decoyHit.body?.result} tag=${tagAfter.status} rejected=${JSON.stringify(tagAfter.body?.rejected ?? [])}`,
  )

  const tagFirst = await openGame(2, 2, 'race-mid-b')
  await warmRoutes(tagFirst.gid)
  const aB = tagFirst.east[0]
  const dB = tagFirst.west[0]
  await heartbeat(tagFirst, dB, WEST_DECOY)
  const tagLands = await post(`/api/games/${tagFirst.gid}/tag`, {
    device_id: dB.device,
    tagger_player_id: dB.player,
    tagger_pos: fresh(WEST_DECOY),
    targets: [{ player_id: aB.player, pos: fresh(offsetMeters(WEST_DECOY, 7, 0)) }],
  })
  const attemptAfter = await attemptFlag(
    tagFirst, aB, 'landmark.miradouro-meia-laranja', WEST_DECOY, 'mid-b',
  )
  rec.check(
    'ordering B (tag commits first): the later attempt 409s with player_respawning',
    (tagLands.body?.tagged_player_ids ?? []).includes(aB.player) &&
      attemptAfter.status === 409 &&
      attemptAfter.body?.error === 'player_respawning' &&
      eventCount(tagFirst.gid, 'flag_attempt') === 0,
    `tag=${JSON.stringify(tagLands.body?.tagged_player_ids)} attempt=${attemptAfter.status} ${attemptAfter.body?.error} flag_attempt events=${eventCount(tagFirst.gid, 'flag_attempt')}`,
  )
})

// ---------------------------------------------------------------------------
// 7. CURSE EXPIRING MID-ATTEMPT
// ---------------------------------------------------------------------------
await strictStep(rec, 'race: expire-curses vs an attempt by the cursed team', async () => {
  const g = await openGame(2, 2, 'race-expiry')
  rec.note(`case 7 game ${g.code}`)
  await warmRoutes(g.gid)
  const attacker = g.east[0]
  // Full Stop on East, already elapsed but not yet swept.
  db(
    `insert into active_curses(game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${g.gid}','${g.eTeam}','curse.full-stop', now() - interval '11 minutes', now() - interval '1 minute', '{}'::jsonb);`,
  )
  rec.check(
    'a Full Stop that has elapsed is still sitting in active_curses',
    num(`select count(*) from active_curses where game_id='${g.gid}' and curse_ref='curse.full-stop';`) === 1,
    'row present, expires_at 60 s in the past',
  )

  const proof = await uploadFlagAttemptProof(g.gid, attacker.player, 'expiry-empty')
  const [sweep, attempt] = await Promise.all([
    post(`/api/games/${g.gid}/expire-curses`, { device_id: g.west[0].device }),
    post(`/api/games/${g.gid}/attempt-flag`, {
      device_id: attacker.device,
      player_id: attacker.player,
      landmark_ref: 'landmark.mercado-municipal',
      pos: fresh(WEST_EMPTY_A),
      photo_url: proof,
    }),
  ])
  const rows = num(`select count(*) from active_curses where game_id='${g.gid}';`)
  const expiredEvents = eventCount(g.gid, 'curse_expired')

  rec.check(
    'the sweep deletes the elapsed row and emits exactly one curse_expired',
    rows === 0 && expiredEvents === 1,
    `rows=${rows} curse_expired=${expiredEvents} sweep=${sweep.status} ids=${JSON.stringify(sweep.body?.expired_curse_ids ?? [])}`,
  )
  rec.check(
    'the concurrent attempt is NOT action-locked by an already-elapsed Full Stop',
    attempt.status < 400 && attempt.body?.result === 'empty',
    `status=${attempt.status} ${attempt.body?.result ?? attempt.body?.error}`,
  )
  rec.check(
    'neither request 500s and no half-applied state (0049 lock order holds)',
    sweep.status < 400 && attempt.status !== 500,
    `sweep=${sweep.status} attempt=${attempt.status}`,
  )
  rec.note(
    'isTeamActionLocked (lib/server/actionLock.ts:19-21) and the RPC guard (0030:69-75) both filter on expires_at > now(), so an unswept expired row is inert for gameplay. Only its display lingers.',
  )
})

// ---------------------------------------------------------------------------
// 8. ATTEMPT-START COOLDOWNS  (0040:57 = 60 s per landmark, 0040:66 = 15 s per team)
// ---------------------------------------------------------------------------
await strictStep(rec, 'attempt-start cooldown windows', async () => {
  const g = await openGame(2, 2, 'race-cooldown')
  rec.note(`case 8 game ${g.code}`)
  await warmRoutes(g.gid)
  const a = g.east[0]
  const startAt = (ref, p) =>
    post(`/api/games/${g.gid}/attempt-start`, {
      device_id: a.device,
      player_id: a.player,
      landmark_ref: ref,
      pos: fresh(p),
    })

  const first = await startAt('landmark.mercado-municipal', WEST_EMPTY_A)
  rec.check('first attempt-start is accepted', first.status < 400, `status=${first.status} ${first.body?.error ?? 'ok'}`)

  const sameAgain = await startAt('landmark.mercado-municipal', WEST_EMPTY_A)
  rec.check(
    'immediate re-start on the SAME landmark -> landmark_attempt_cooldown',
    sameAgain.body?.error === 'landmark_attempt_cooldown',
    `status=${sameAgain.status} error=${sameAgain.body?.error} (route maps *_cooldown to 429, attempt-start/route.ts:189)`,
  )
  const otherNow = await startAt('landmark.parque-florestal', WEST_EMPTY_B)
  rec.check(
    'immediate start on a DIFFERENT landmark -> team_attempt_cooldown (15 s)',
    otherNow.body?.error === 'team_attempt_cooldown',
    `status=${otherNow.status} error=${otherNow.body?.error}`,
  )

  advanceClock(g.gid, 20)
  rec.clockJump({ seconds: 20, game: g.code, reason: 'clear the 15 s team cooldown' })
  const otherLater = await startAt('landmark.parque-florestal', WEST_EMPTY_B)
  rec.check(
    'after +20 s the other landmark is startable again',
    otherLater.status < 400,
    `status=${otherLater.status} ${otherLater.body?.error ?? 'ok'}`,
  )

  advanceClock(g.gid, 50) // landmark A now 70 s old, team's last start 50 s old
  rec.clockJump({ seconds: 50, game: g.code, reason: 'clear the 60 s per-landmark cooldown' })
  const sameLater = await startAt('landmark.mercado-municipal', WEST_EMPTY_A)
  rec.check(
    'after +70 s the original landmark is startable again',
    sameLater.status < 400,
    `status=${sameLater.status} ${sameLater.body?.error ?? 'ok'}`,
  )

  // The advisory lock (0040:20-22) must also serialize a truly simultaneous pair.
  advanceClock(g.gid, 90)
  rec.clockJump({ seconds: 90, game: g.code, reason: 'clear all cooldowns before the race' })
  const [p1, p2] = await Promise.all([
    startAt('landmark.mercado-municipal', WEST_EMPTY_A),
    startAt('landmark.mercado-municipal', WEST_EMPTY_A),
  ])
  const accepted = [p1, p2].filter((r) => r.status < 400).length
  rec.check(
    'two simultaneous starts on one landmark: exactly one is recorded',
    accepted === 1,
    `statuses=${p1.status}/${p2.status} errors=${[p1, p2].map((r) => r.body?.error ?? 'ok').join(',')}`,
  )
})

// ---------------------------------------------------------------------------
// 9. CHALLENGE REVIEW AUTO-ACCEPT, AND THE PAUSE INTERACTION
// ---------------------------------------------------------------------------
async function pickPhotoChallenge(g, actor) {
  const list = await apiGet(`/api/games/${g.gid}/challenges?device_id=${actor.device}`)
  const def = (list.active ?? []).find((c) => c.photo_required && c.landmark_ref)
  if (!def) throw new Error(`no photo+landmark challenge in ${JSON.stringify((list.active ?? []).map((c) => c.id))}`)
  return def
}
async function submitPhotoChallenge(g, actor, def, tag) {
  const site = coord(def.landmark_ref)
  const proof = await uploadChallengeProof(g.gid, actor.player, tag)
  const res = await post(`/api/games/${g.gid}/submit-challenge`, {
    device_id: actor.device,
    player_id: actor.player,
    challenge_ref: def.id,
    pos: fresh(offsetMeters(site, 40, 0)),
    photo_url: proof,
  })
  const cardId = one(
    `select id from cards where game_id='${g.gid}' and team_id='${actor.teamId}' and ref='${def.id}' and kind='challenge';`,
  )
  return { res, cardId }
}

await strictStep(rec, 'challenge review auto-accept credits exactly once', async () => {
  const g = await openGame(2, 2, 'race-review')
  rec.note(`case 9a game ${g.code}`)
  await warmRoutes(g.gid)
  const submitter = { ...g.west[0], teamId: g.wTeam }
  const def = await pickPhotoChallenge(g, submitter)
  const before = coins(g.wTeam)
  const { res, cardId } = await submitPhotoChallenge(g, submitter, def, '9a')
  rec.check(
    `photo challenge ${def.id} submits to 'pending' without crediting`,
    res.body?.status === 'pending' &&
      one(`select state from cards where id='${cardId}';`) === 'pending' &&
      coins(g.wTeam) === before,
    `status=${res.status} ${res.body?.status ?? res.body?.error} state=${one(`select state from cards where id='${cardId}';`)} coins=${coins(g.wTeam)}`,
  )

  // Inside the 120 s window the sweep must do nothing (0048:45).
  const tooSoon = await post(`/api/games/${g.gid}/resolve-challenge-reviews`, {
    device_id: g.east[0].device,
  })
  rec.check(
    'inside the 120 s review window the sweep resolves nothing',
    (tooSoon.body?.resolved_card_ids ?? []).length === 0 && coins(g.wTeam) === before,
    `resolved=${JSON.stringify(tooSoon.body?.resolved_card_ids ?? [])} coins=${coins(g.wTeam)}`,
  )

  advanceClock(g.gid, 130)
  rec.clockJump({ seconds: 130, game: g.code, reason: 'age the review past 120 s' })
  const sweep1 = await post(`/api/games/${g.gid}/resolve-challenge-reviews`, {
    device_id: g.east[0].device,
  })
  const afterFirst = coins(g.wTeam)
  const expected = def.reward_coins + 30 // first blood (0015:128)
  rec.check(
    'after 130 s the review auto-accepts',
    (sweep1.body?.resolved_card_ids ?? []).includes(cardId) &&
      one(`select state from cards where id='${cardId}';`) === 'consumed',
    `resolved=${JSON.stringify(sweep1.body?.resolved_card_ids ?? [])} state=${one(`select state from cards where id='${cardId}';`)}`,
  )
  rec.check(
    `coins credit exactly once (+${expected} = reward ${def.reward_coins} + first blood 30)`,
    afterFirst - before === expected,
    `before=${before} after=${afterFirst} delta=${afterFirst - before}`,
  )

  const sweep2 = await post(`/api/games/${g.gid}/resolve-challenge-reviews`, {
    device_id: g.east[0].device,
  })
  rec.check(
    'calling the sweep twice does NOT double-credit',
    coins(g.wTeam) === afterFirst && (sweep2.body?.resolved_card_ids ?? []).length === 0,
    `coins=${coins(g.wTeam)} second sweep=${JSON.stringify(sweep2.body?.resolved_card_ids ?? [])}`,
  )
  rec.check(
    'exactly one challenge_auto_accepted and one challenge_completed event',
    eventCount(g.gid, 'challenge_auto_accepted') === 1 &&
      eventCount(g.gid, 'challenge_completed') === 1,
    `auto=${eventCount(g.gid, 'challenge_auto_accepted')} completed=${eventCount(g.gid, 'challenge_completed')}`,
  )

  // Two simultaneous sweeps on a freshly-aged review.
  const def2 = await pickPhotoChallenge(g, submitter)
  const coinsMid = coins(g.wTeam)
  const second = await submitPhotoChallenge(g, submitter, def2, '9a-race')
  rec.check(
    `second photo challenge ${def2.id} is pending`,
    one(`select state from cards where id='${second.cardId}';`) === 'pending',
    `submit=${second.res.status} ${second.res.body?.status ?? second.res.body?.error}`,
  )
  advanceClock(g.gid, 130)
  rec.clockJump({ seconds: 130, game: g.code, reason: 'age the second review' })
  const [s1, s2] = await Promise.all([
    post(`/api/games/${g.gid}/resolve-challenge-reviews`, { device_id: g.east[0].device }),
    post(`/api/games/${g.gid}/resolve-challenge-reviews`, { device_id: g.east[1].device }),
  ])
  const resolvedTwice =
    (s1.body?.resolved_card_ids ?? []).length + (s2.body?.resolved_card_ids ?? []).length
  rec.check(
    'two simultaneous sweeps credit the same review once',
    coins(g.wTeam) - coinsMid === def2.reward_coins && resolvedTwice === 1,
    `delta=${coins(g.wTeam) - coinsMid} expected=${def2.reward_coins} resolved_total=${resolvedTwice}`,
  )
})

await strictStep(rec, 'pause vs review auto-accept (wall clock vs game clock)', async () => {
  const g = await openGame(2, 2, 'race-pause')
  rec.note(`case 9b game ${g.code}`)
  await warmRoutes(g.gid)
  const submitter = { ...g.west[0], teamId: g.wTeam }
  const def = await pickPhotoChallenge(g, submitter)
  const before = coins(g.wTeam)
  const { cardId } = await submitPhotoChallenge(g, submitter, def, '9b')
  rec.check(
    'proof pending before the pause',
    one(`select state from cards where id='${cardId}';`) === 'pending',
    `state=${one(`select state from cards where id='${cardId}';`)}`,
  )

  const paused = await weather(g, 'pause')
  rec.check(
    'both teams vote a weather pause -> games.status = paused',
    gameStatus(g.gid) === 'paused' && paused.second.body?.applied === true,
    `first=${paused.first.status}/pending=${paused.first.body?.pending} second=${paused.second.status}/applied=${paused.second.body?.applied} status=${gameStatus(g.gid)}`,
  )

  advanceClock(g.gid, 200)
  rec.clockJump({ seconds: 200, game: g.code, reason: 'sit out 200 s of paused wall clock' })
  const duringPause = await post(`/api/games/${g.gid}/resolve-challenge-reviews`, {
    device_id: g.east[0].device,
  })
  rec.check(
    'DURING the pause the sweep is inert (route short-circuits on status, resolve-challenge-reviews/route.ts:54)',
    (duringPause.body?.resolved_card_ids ?? []).length === 0 && coins(g.wTeam) === before,
    `resolved=${JSON.stringify(duringPause.body?.resolved_card_ids ?? [])} coins=${coins(g.wTeam)} state=${one(`select state from cards where id='${cardId}';`)}`,
  )

  const resumed = await weather(g, 'resume')
  const pauseSeconds = num(
    `select coalesce((config->'weather_pause'->>'last_pause_seconds')::int, -1) from games where id='${g.gid}';`,
  )
  rec.check(
    'resume restores play and records the paused duration',
    ['live', 'flag_found'].includes(gameStatus(g.gid)) && pauseSeconds >= 195,
    `status=${gameStatus(g.gid)} last_pause_seconds=${pauseSeconds} second=${resumed.second.status}/applied=${resumed.second.body?.applied}`,
  )

  const ageAfterResume = num(
    `select round(extract(epoch from (now() - (payload->>'submitted_at')::timestamptz))) from cards where id='${cardId}';`,
  )
  const immediately = await post(`/api/games/${g.gid}/resolve-challenge-reviews`, {
    device_id: g.east[0].device,
  })
  const autoAccepted = (immediately.body?.resolved_card_ids ?? []).includes(cardId)
  // P11 FIXED by migration 0050: resume now shifts payload.submitted_at (and the
  // updated_at fallback 0048 reads for legacy rows) forward by the paused
  // duration, exactly as it already shifted games.started_at and the curse
  // endpoints. The review window is frozen for the pause, not consumed by it.
  rec.check(
    'P11 FIXED (0050): the review window SURVIVES the pause — the proof is still pending after resume, with its remaining review time intact',
    !autoAccepted &&
      one(`select state from cards where id='${cardId}';`) === 'pending' &&
      coins(g.wTeam) === before,
    `submitted_at is only ${ageAfterResume}s old after a ${pauseSeconds}s pause (pre-0050 it would have been ~${ageAfterResume + pauseSeconds}s and inside the 120 s deadline); sweep resolved=${JSON.stringify(immediately.body?.resolved_card_ids ?? [])} state=${one(`select state from cards where id='${cardId}';`)} coins still ${coins(g.wTeam)}`,
  )
  // Time preserved, not reset: the remainder must still run out on its own.
  advanceClock(g.gid, 130)
  rec.clockJump({ seconds: 130, game: g.code, reason: 'spend the preserved review remainder' })
  const afterRemainder = await post(`/api/games/${g.gid}/resolve-challenge-reviews`, {
    device_id: g.east[0].device,
  })
  rec.check(
    'the preserved remainder is finite — once genuinely spent, the review auto-accepts as normal',
    (afterRemainder.body?.resolved_card_ids ?? []).includes(cardId) &&
      one(`select state from cards where id='${cardId}';`) === 'consumed',
    `resolved=${JSON.stringify(afterRemainder.body?.resolved_card_ids ?? [])} coins ${before} -> ${coins(g.wTeam)}`,
  )
  rec.note(
    `PAUSE/REVIEW (P11, fixed): 0027:69-82 shifted games.started_at and every active_curses endpoint forward by the paused duration on resume but left cards.payload.submitted_at alone, while 0048:45 compares it against wall-clock now() - 120s — so any pause over two minutes consumed the whole review window and the resume itself awarded the coins. Migration 0050 adds the matching shift for still-pending challenge cards (payload.submitted_at plus the updated_at fallback, moved by the same ${pauseSeconds}s, deliberately NOT reset to now()), so the reviewing team resumes with exactly the review time it had left and can still reject. Semantics: the review timer does not run during a pause.`,
  )
})

// ---------------------------------------------------------------------------
// 10. ALL CLIENTS OFFLINE
// ---------------------------------------------------------------------------
// /time-tick is a 30 s client poll and camping a 5 s heartbeat, so with every
// phone closed neither runs. CURSE EXPIRY IS NO LONGER IN THAT LIST: migration
// 0052 (finding P13) schedules sweep_expired_curses via pg_cron every 30 s, so a
// timed curse now expires server-side whether or not anyone has the app open.
// The assertions below are updated accordingly — the curse is expected to be
// GONE after an offline hour, with no client call responsible for it.
await strictStep(rec, 'all clients offline: cron expires curses, time bonus back-credits, camping cannot accrue', async () => {
  const g = await openGame(2, 2, 'race-offline')
  rec.note(`case 10 game ${g.code}`)
  await warmRoutes(g.gid)
  db(`update teams set coins = 100 where game_id='${g.gid}';`)

  // A 10-minute Full Stop cast on East, with nobody's app open afterwards.
  db(
    `insert into active_curses(game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${g.gid}','${g.eTeam}','curse.full-stop', now(), now() + interval '10 minutes', '{}'::jsonb);`,
  )
  advanceClockMinutes(g.gid, 60)
  rec.clockJump({ minutes: 60, game: g.code, reason: 'one hour with every client closed' })

  const remaining = num(
    `select round(extract(epoch from (now() - expires_at))/60) from active_curses where game_id='${g.gid}' and curse_ref='curse.full-stop';`,
  )
  // P13 FIXED by migration 0052: pg_cron runs sweep_expired_curses every 30 s,
  // so the row is reaped without any client. Wait up to two cadences before
  // asserting — the schedule is wall-clock, not request-driven.
  const cronDeadline = Date.now() + 75_000
  while (
    Date.now() < cronDeadline &&
    num(`select count(*) from active_curses where game_id='${g.gid}';`) > 0
  ) {
    await new Promise((r) => setTimeout(r, 2_000))
  }
  rec.check(
    'P13 FIXED (0052): the expired Full Stop is GONE after the offline hour, swept by pg_cron with no client call',
    num(`select count(*) from active_curses where game_id='${g.gid}';`) === 0 &&
      eventCount(g.gid, 'curse_expired') === 1,
    `rows=${num(`select count(*) from active_curses where game_id='${g.gid}';`)} curse_expired events=${eventCount(g.gid, 'curse_expired')} (was ${remaining} min past expiry)`,
  )
  rec.check(
    'the housekeeping curse_expired event has no actor (it was nobody\'s action) and names the curse',
    one(
      `select coalesce(actor_player_id::text,'null')||'|'||(payload->>'curse_ref') from events where game_id='${g.gid}' and type='curse_expired';`,
    ) === 'null|curse.full-stop',
    `event=${one(`select coalesce(actor_player_id::text,'null')||'|'||(payload->>'curse_ref') from events where game_id='${g.gid}' and type='curse_expired';`)}`,
  )
  // The victim's UI no longer shows a permanent-looking curse that does nothing.
  const stillActive = await apiGet(
    `/api/games/${g.gid}/live-state?device_id=${g.east[0].device}`,
  )
  rec.check(
    'live-state no longer reports the stale curse to the cursed team (the P13 bluff is closed)',
    !(stillActive.active_curses ?? []).some((c) => c.curse_ref === 'curse.full-stop'),
    `active_curses=${JSON.stringify((stillActive.active_curses ?? []).map((c) => c.curse_ref))}`,
  )
  const proof = await uploadFlagAttemptProof(g.gid, g.east[0].player, 'offline-empty')
  const notLocked = await post(`/api/games/${g.gid}/attempt-flag`, {
    device_id: g.east[0].device,
    player_id: g.east[0].player,
    landmark_ref: 'landmark.mercado-municipal',
    pos: fresh(WEST_EMPTY_A),
    photo_url: proof,
  })
  rec.check(
    'actions are unlocked, as they already were under the expires_at filter',
    notLocked.status < 400,
    `attempt=${notLocked.status} ${notLocked.body?.result ?? notLocked.body?.error}`,
  )
  // The client poll is kept as the low-latency path; it must be a harmless no-op
  // once cron has already reaped the row (both enter the same atomic RPC).
  const sweepNow = await post(`/api/games/${g.gid}/expire-curses`, {
    device_id: g.west[0].device,
  })
  rec.check(
    'the client poll is now a no-op after the cron sweep (no double event, idempotent)',
    (sweepNow.body?.expired_curse_ids ?? []).length === 0 &&
      eventCount(g.gid, 'curse_expired') === 1,
    `swept=${JSON.stringify(sweepNow.body?.expired_curse_ids ?? [])} curse_expired=${eventCount(g.gid, 'curse_expired')}`,
  )

  // Time bonus: /time-tick back-credits every missed interval (0045:5-86).
  // Compute what is due from the clock rather than hard-coding: the game was
  // already 31 min old when the offline hour began, so 91 min -> 3 intervals.
  const elapsedMin = num(
    `select floor(extract(epoch from (now() - started_at))/60) from games where id='${g.gid}';`,
  )
  const dueIntervals = Math.min(6, Math.floor(elapsedMin / 30)) // 0045:37 caps at floor(180/30)
  const expectedCoins = dueIntervals * 20 // TIME_BONUS
  const wBefore = coins(g.wTeam)
  const eBefore = coins(g.eTeam)
  const tick = await post(`/api/games/${g.gid}/time-tick`, { device_id: g.west[0].device })
  const credited = tick.body?.credited_intervals ?? []
  const wDelta = coins(g.wTeam) - wBefore
  const eDelta = coins(g.eTeam) - eBefore
  rec.check(
    `a single late /time-tick back-credits EVERY missed 30-min interval (${elapsedMin} min elapsed -> ${dueIntervals} intervals, ${expectedCoins} coins each side)`,
    credited.length === dueIntervals && wDelta === expectedCoins && eDelta === expectedCoins,
    `credited=${JSON.stringify(credited)} westDelta=${wDelta} eastDelta=${eDelta}`,
  )
  const tickAgain = await post(`/api/games/${g.gid}/time-tick`, { device_id: g.west[0].device })
  rec.check(
    'a second tick credits nothing (one time_bonus event per interval, 0045:47-52)',
    (tickAgain.body?.credited_intervals ?? []).length === 0 &&
      coins(g.wTeam) - wBefore === expectedCoins,
    `credited=${JSON.stringify(tickAgain.body?.credited_intervals ?? [])} coins=${coins(g.wTeam)}`,
  )

  // Camping is the one accumulator a clock move cannot fast-forward (0031:82).
  const campBefore = num(
    `select coalesce(accumulated_inside_seconds,0) from player_camping_state where player_id='${g.west[0].player}';`,
  )
  await heartbeat(g, g.west[0], WEST_REAL)
  const campAfter = num(
    `select coalesce(accumulated_inside_seconds,0) from player_camping_state where player_id='${g.west[0].player}';`,
  )
  rec.check(
    'an hour offline credits at most 15 s of camping on the next heartbeat (0031:82 cap)',
    campAfter - campBefore <= 15,
    `inside_seconds ${campBefore} -> ${campAfter} after a 60-min gap`,
  )
  rec.note(
    `OFFLINE COST, quantified for one hour with every app closed (measured on ${g.code}): TIME BONUS — 0 coins lost. One late /time-tick back-credited all ${dueIntervals} due intervals (${expectedCoins} coins to EACH team) in a single call, and a second call credited nothing; the whole-game cap is floor(180/30) = 6 intervals = 120 coins per team, so no interval can ever be forfeited by being offline. CURSES — FIXED by migration 0052 (P13). Previously a 10-min Full Stop stayed in active_curses for the full 60 min with zero curse_expired events and live-state kept reporting it, so it read as permanent in ActiveCursesBanner while being functionally inert past expires_at. pg_cron now runs sweep_expired_curses every 30 s, so the row was reaped and the event emitted with NO client call and no actor; live-state no longer shows it, and the client poll is a harmless idempotent no-op afterwards. Curse durations are therefore no longer suspended by everyone being offline. CAMPING — still the one accumulator that cannot advance: 0031:82 credits at most 15 s per heartbeat, so the hour added 0 s and an offline defender remains un-lockable (client-driven by design; not addressed by 0052). NET: no coin loss, curse timers now authoritative server-side, camping rule still suspended in the camping team's favour.`,
  )
})

const { failed } = rec.finish()
process.exitCode = failed > 0 ? 1 : 0
