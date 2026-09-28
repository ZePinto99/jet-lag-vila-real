// Endgame and scoring edge cases: the degenerate games, the pagination
// contract, and the spectator security boundary.
//
//   node tools/sim/scenario-endgame-edges.mjs [seed]
//
// Pure-API (no browser), so every assertion lands on SERVER authority.
//
// WHY THIS EXISTS ALONGSIDE scenario-terminal-ties.mjs
// ---------------------------------------------------------------------------
// That scenario walks the tiebreak LADDER (points, then challenges, then coins,
// then the coin flip) on games that have something to score. What is not covered
// there is the degenerate end of the range — a game where literally nothing
// happened, a stripped carrier, and the shapes the results/observer ENDPOINTS
// answer with rather than the ladder they implement.
//
// Covered here:
//   1. A game where NOBODY completes a challenge — no divide-by-zero, no
//      misreport, and the ladder still lands on a concrete winner.
//   2. A genuine 0-0-0 tie -> the coin flip. Two authorities disagree by
//      construction: finish_game_by_timeout_atomic ALWAYS flips (0045:236) while
//      the shared TS helper pickTimeoutWinner can answer null/timeout_tied
//      (scoring.ts:126). Which one a player actually sees is measured.
//   3. /results pagination: default, limit=1, a mid-range offset, an offset past
//      the end, and the Zod bounds (limit=0 / limit=101). Rejected vs clamped is
//      measured, not assumed.
//   4. Scoring after flag_carrier_stripped (0053): the photo keeps its +10 per
//      RULEBOOK §13, and the stripped run must NOT also credit a win.
//   5. /observer-state across lobby / setup / live / finished, and the security
//      boundary it is responsible for: enemy `kind`/`hardened` must never appear
//      (CLAUDE.md decision 5 — the hiding is done by the curated API, NOT RLS,
//      so this endpoint is the only thing standing between a spectator and the
//      flag locations).
//   6. Timeout with a flag_found but no completed run: who wins, and does the
//      +10 still count?

import {
  makeGameN,
  coord,
  db,
  apiPost,
  BASE,
  uploadFlagAttemptProof,
  uploadChallengeProof,
  uploadSurroundingsPhoto,
  WEST_ASSIGN,
  EAST_ASSIGN,
} from './harness.mjs'
import { advanceClockMinutes } from './clock.mjs'
import { makeRecorder, strictStep } from './artifact.mjs'
import { offsetMeters } from './movement.mjs'
import { haversineMeters as hav } from './geoutil.mjs'

const seed = Number(process.argv[2] || 20260928)
const rec = makeRecorder({ scenario: 'endgame-edges', seed })

const WEST_REAL = coord('landmark.miradouro-vila-velha') // West real flag + West home
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
const gameStatus = (gid) => one(`select status from games where id='${gid}';`)
const eventCount = (gid, type) =>
  num(`select count(*) from events where game_id='${gid}' and type='${type}';`)

const results = (gid, device, query = '') =>
  get(`/api/games/${gid}/results?device_id=${encodeURIComponent(device)}${query}`)
const observer = (gid) => get(`/api/games/${gid}/observer-state`)

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

/**
 * Next dev compiles a route on its FIRST hit; a cold route can answer a
 * spurious 500. Warm every route this scenario asserts on, so a 500 here is
 * always the app's and never the bundler's. /results and /observer-state are
 * warmed by GET because they have no POST handler.
 */
async function warmRoutes(gid) {
  const routes = [
    'end-by-timeout', 'attempt-flag', 'complete-run', 'tag', 'camping-heartbeat',
    'submit-challenge', 'accept-challenge', 'respawn-clear', 'expire-curses',
    'time-tick',
  ]
  await Promise.all(routes.map((r) => post(`/api/games/${gid}/${r}`, {})))
  await get(`/api/games/${gid}/results?device_id=warm`)
  await observer(gid)
  await get(`/api/games/${gid}/challenges?device_id=warm`)
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
  return g
}

/** Production binding for a tag: a camping heartbeat <=15 s old (0044:72). */
const heartbeat = (g, actor, pos) =>
  post(`/api/games/${g.gid}/camping-heartbeat`, {
    device_id: actor.device,
    player_id: actor.player,
    pos: fresh(pos),
  })

const findings = []

await waitForServer()

// ---------------------------------------------------------------------------
// 1. A GAME WHERE NOTHING HAPPENED
// ---------------------------------------------------------------------------
// Every scoring term is 0 for both teams: no flag photo, no challenge, no tag,
// equal coins. The arithmetic must not divide by zero (challenge_points is a
// multiply, not a divide, but the SHAPE is what is being pinned), the ladder must
// fall all the way through to the coin flip, and a player must never be shown
// "nobody won".
await strictStep(rec, 'degenerate: nobody completes a challenge, nothing is scored', async () => {
  const g = await openGame(1, 1, 'edge-empty')
  rec.bindGame(g.gid, g.code)
  rec.note(`case 1 game ${g.code} — no challenges, no tags, no flag photos`)
  // Equal balances, so coins cannot break the tie either.
  db(`update teams set coins = 300 where game_id='${g.gid}';`)

  rec.check(
    'precondition: zero challenge_completed, zero tag, zero real flag_attempt events',
    eventCount(g.gid, 'challenge_completed') === 0 &&
      eventCount(g.gid, 'tag') === 0 &&
      num(
        `select count(*) from events where game_id='${g.gid}' and type='flag_attempt' and payload->>'result'='real';`,
      ) === 0,
    `challenges=${eventCount(g.gid, 'challenge_completed')} tags=${eventCount(g.gid, 'tag')} real attempts=0`,
  )

  advanceClockMinutes(g.gid, 190)
  rec.clockJump({ minutes: 190, game: g.code, reason: 'cross the 180-min deadline' })
  const to = await post(`/api/games/${g.gid}/end-by-timeout`, { device_id: g.west[0].device })
  rec.check(
    'the timeout settles a completely empty game without erroring',
    to.status === 200 && gameStatus(g.gid) === 'finished',
    `status=${to.status} game=${gameStatus(g.gid)} error=${to.body?.error ?? 'none'}`,
  )
  const scores = to.body?.scores ?? []
  rec.check(
    'both teams score exactly 0 on every term, with no NaN / null / negative anywhere',
    scores.length === 2 &&
      scores.every(
        (s) =>
          s.total === 0 &&
          s.flag_points === 0 &&
          s.challenge_points === 0 &&
          s.tag_points === 0 &&
          s.challenges_completed === 0 &&
          s.tags_made === 0 &&
          s.found_real_flag === false &&
          Number.isFinite(s.coins_remaining),
      ),
    JSON.stringify(
      scores.map((s) => ({
        side: s.team_side,
        total: s.total,
        flag: s.flag_points,
        ch: s.challenge_points,
        tag: s.tag_points,
        coins: s.coins_remaining,
      })),
    ),
  )
  rec.check(
    'the ladder falls through points -> challenges -> coins and lands on the coin flip',
    to.body?.reason === 'timeout_coin_flip',
    `reason=${to.body?.reason} (all three rungs tied: totals 0=0, challenges 0=0, coins ${scores[0]?.coins_remaining}=${scores[1]?.coins_remaining})`,
  )
  rec.check(
    'a CONCRETE winner is named — a player is never shown a null winner',
    to.body?.winner_team_id != null &&
      [g.wTeam, g.eTeam].includes(to.body.winner_team_id),
    `winner=${to.body?.winner_team_id === g.wTeam ? 'West' : to.body?.winner_team_id === g.eTeam ? 'East' : to.body?.winner_team_id}`,
  )
  rec.check(
    'exactly one game_won and one game_ended_by_timeout event, both naming that winner',
    eventCount(g.gid, 'game_won') === 1 &&
      eventCount(g.gid, 'game_ended_by_timeout') === 1 &&
      num(
        `select count(*) from events where game_id='${g.gid}' and type in ('game_won','game_ended_by_timeout') and payload->>'winner_team_id'='${to.body.winner_team_id}';`,
      ) === 2,
    `game_won=${eventCount(g.gid, 'game_won')} timeout=${eventCount(g.gid, 'game_ended_by_timeout')}`,
  )

  // And the results route must tell the same story to a player.
  const res = await results(g.gid, g.west[0].device)
  rec.check(
    '/results agrees with the timeout on winner AND reason for the empty game',
    res.status === 200 &&
      res.body?.winner_team_id === to.body.winner_team_id &&
      res.body?.reason === to.body.reason,
    `status=${res.status} winner match=${res.body?.winner_team_id === to.body.winner_team_id} reason=${res.body?.reason}`,
  )
  rec.check(
    '/results scores are the FROZEN payload, not a recompute (§13 immutable history)',
    // Compared field-by-field on a canonical key order, NOT by stringifying: the
    // payload is jsonb, which does not preserve insertion order, so a raw text
    // comparison would fail on key ordering alone and prove nothing.
    (() => {
      const persisted = JSON.parse(
        one(
          `select (payload->'scores')::text from events where game_id='${g.gid}' and type='game_ended_by_timeout' order by created_at desc limit 1;`,
        ),
      )
      const canon = (rows) =>
        JSON.stringify(
          [...rows]
            .sort((a, b) => String(a.team_id).localeCompare(String(b.team_id)))
            .map((s) => Object.fromEntries(Object.entries(s).sort(([a], [b]) => a.localeCompare(b)))),
        )
      return canon(res.body?.scores ?? []) === canon(persisted)
    })(),
    'results.scores is field-for-field identical to the persisted game_ended_by_timeout payload (canonical key order; jsonb does not preserve insertion order)',
  )
  rec.check(
    'the empty game still has a non-empty timeline (lobby/setup events), so the page is not blank',
    (res.body?.timeline_total ?? 0) > 0 && (res.body?.timeline_events ?? []).length > 0,
    `timeline_total=${res.body?.timeline_total} returned=${(res.body?.timeline_events ?? []).length}`,
  )
})

// ---------------------------------------------------------------------------
// 2. THE 0-0 TIE: WHICH AUTHORITY DECIDES?
// ---------------------------------------------------------------------------
// Two implementations of §13 exist and they disagree on the tie:
//   finish_game_by_timeout_atomic (0045:230-237) always flips a coin.
//   pickTimeoutWinner (scoring.ts:120-126) returns null / 'timeout_tied'.
// end-by-timeout's recompute path only reaches the TS helper when NEITHER
// terminal event carries a winner (end-by-timeout/route.ts:183-195). This step
// proves which one a player sees in normal play, and then destroys the terminal
// events to reach the helper deliberately — so the disagreement is measured
// rather than argued about.
await strictStep(rec, 'tie: the RPC coin flip is what players see; the TS helper is unreachable in normal play', async () => {
  const g = await openGame(1, 1, 'edge-tie')
  rec.note(`case 2 game ${g.code} — exact 0-0-0 tie`)
  db(`update teams set coins = 250 where game_id='${g.gid}';`)
  advanceClockMinutes(g.gid, 190)
  rec.clockJump({ minutes: 190, game: g.code, reason: 'cross the deadline on a dead-even game' })

  const first = await post(`/api/games/${g.gid}/end-by-timeout`, { device_id: g.west[0].device })
  const flipped = first.body?.winner_team_id
  rec.check(
    'the RPC decides the tie with a coin flip and persists a concrete winner',
    first.body?.reason === 'timeout_coin_flip' && flipped != null,
    `reason=${first.body?.reason} winner=${flipped ? 'set' : 'NULL'}`,
  )

  // Repeated reads must be STABLE. A second flip would let a team refresh until
  // it liked the answer.
  const rereads = []
  for (let i = 0; i < 4; i++) {
    const again = await post(`/api/games/${g.gid}/end-by-timeout`, {
      device_id: (i % 2 === 0 ? g.west[0] : g.east[0]).device,
    })
    rereads.push(`${again.body?.winner_team_id === flipped ? 'same' : 'DIFFERENT'}/${again.body?.reason}`)
  }
  rec.check(
    'the flip is decided ONCE: four re-reads from both devices return the same winner and reason',
    rereads.every((r) => r === `same/timeout_coin_flip`),
    `re-reads=${JSON.stringify(rereads)}`,
  )
  const resTie = await results(g.gid, g.east[0].device)
  rec.check(
    '/results reports the same flipped winner to the LOSING side too',
    resTie.body?.winner_team_id === flipped && resTie.body?.reason === 'timeout_coin_flip',
    `results winner match=${resTie.body?.winner_team_id === flipped} reason=${resTie.body?.reason}`,
  )
  rec.check(
    'the observer board also names the flipped winner (no null-tie for a spectator)',
    await (async () => {
      const obs = await observer(g.gid)
      const terminal = (obs.body?.recent_events ?? [])
        .filter((e) => e.type === 'game_won' || e.type === 'game_ended_by_timeout')
      return (
        terminal.length === 2 &&
        terminal.every((e) => e.payload?.winner_team_id === flipped)
      )
    })(),
    'both terminal events in the observer feed carry the flipped winner id',
  )

  // --- now reach the TS helper on purpose ---------------------------------
  // events has no DELETE guard (0006 dropped it), so the legacy/partial shape
  // can be constructed. Done LAST because it destroys the terminal record.
  db(`delete from events where game_id='${g.gid}' and type in ('game_won','game_ended_by_timeout');`)
  const helper = await post(`/api/games/${g.gid}/end-by-timeout`, { device_id: g.west[0].device })
  rec.check(
    'with BOTH terminal events gone, end-by-timeout falls through to pickTimeoutWinner and answers a NULL winner',
    helper.status === 200 &&
      helper.body?.winner_team_id === null &&
      helper.body?.reason === 'timeout_tied',
    `status=${helper.status} winner=${helper.body?.winner_team_id} reason=${helper.body?.reason} — scoring.ts:126 has no coin-flip branch`,
  )
  const resOrphan = await results(g.gid, g.west[0].device)
  rec.check(
    '/results refuses that state outright rather than rendering a tie (terminal_result_missing, 500)',
    resOrphan.status === 500 && resOrphan.body?.error === 'terminal_result_missing',
    `status=${resOrphan.status} error=${resOrphan.body?.error} (results/route.ts:98-103 requires a terminal event)`,
  )
  const finding =
    `MEASURED (not a live bug, but a real divergence): §13's tie rule has two implementations that do not agree. finish_game_by_timeout_atomic (0045:230-237) ALWAYS flips a coin and persists reason='timeout_coin_flip'; the shared TS helper pickTimeoutWinner (lib/results/scoring.ts:120-126) has no flip branch and returns { winner_team_id: null, reason: 'timeout_tied' }. On ${g.code}, a dead-even 0-0-0 game: the RPC flipped, four re-reads from both devices returned the SAME winner, /results agreed for the losing side, and the observer feed carried the same id — so in normal play a player can never see a null winner, and the helper is dead code on this path. The ONLY way to reach it is for BOTH terminal events to be missing from the log, which end-by-timeout/route.ts:183-195 treats as the legacy case. Forced that state by deleting both events: end-by-timeout then answered winner=null / reason='timeout_tied' with HTTP 200, contradicting RULEBOOK §13, while /results independently refused the same state with 500 terminal_result_missing. So the two READ endpoints disagree with each other about an unreachable state, and one of them disagrees with the rulebook. Low priority because it is unreachable in production, but it is a live trap for anyone who later reuses pickTimeoutWinner as "the" scoring helper — a client that called it directly would render a tie the server had already decided. NOT FIXED — reported for decision (the obvious fix is a deterministic tiebreak in the helper, e.g. lowest team id, so it can never contradict a persisted flip).`
  findings.push(finding)
  rec.note(finding)
})

// ---------------------------------------------------------------------------
// 3. /results PAGINATION CONTRACT
// ---------------------------------------------------------------------------
// QuerySchema: offset >= 0 default 0; limit 1..100 default 100
// (results/route.ts:14-18). The page itself is a Supabase .range(), so the
// interesting question is what an offset past the end does.
await strictStep(rec, 'results: pagination bounds, and an offset past the end', async () => {
  const g = await openGame(1, 1, 'edge-paging')
  rec.note(`case 3 game ${g.code} — /results offset/limit contract`)
  advanceClockMinutes(g.gid, 190)
  rec.clockJump({ minutes: 190, game: g.code, reason: 'finish the game so /results is available' })
  await post(`/api/games/${g.gid}/end-by-timeout`, { device_id: g.west[0].device })
  const device = g.west[0].device

  const base = await results(g.gid, device)
  const total = base.body?.timeline_total
  rec.check(
    'default page: limit defaults to 100, offset to 0, and timeline_total is the true event count',
    base.status === 200 &&
      base.body?.timeline_offset === 0 &&
      total === num(`select count(*) from events where game_id='${g.gid}';`) &&
      (base.body?.timeline_events ?? []).length === Math.min(100, total),
    `total=${total} returned=${(base.body?.timeline_events ?? []).length} offset=${base.body?.timeline_offset} next=${base.body?.timeline_next_offset}`,
  )
  rec.check(
    'a game this small fits one page, so timeline_next_offset is null',
    total <= 100 && base.body?.timeline_next_offset === null,
    `total=${total} next=${base.body?.timeline_next_offset}`,
  )
  rec.check(
    'the timeline is newest-first (created_at desc, results/route.ts:116)',
    await (async () => {
      const rows = base.body?.timeline_events ?? []
      for (let i = 1; i < rows.length; i++) {
        if (Date.parse(rows[i - 1].created_at) < Date.parse(rows[i].created_at)) return false
      }
      return rows.length > 1
    })(),
    `${(base.body?.timeline_events ?? []).length} rows in descending created_at order`,
  )

  // --- limit=1: one row, and next_offset points at the second -------------
  const one1 = await results(g.gid, device, '&limit=1')
  rec.check(
    'limit=1 returns exactly one event and advertises timeline_next_offset=1',
    one1.status === 200 &&
      (one1.body?.timeline_events ?? []).length === 1 &&
      one1.body?.timeline_next_offset === 1 &&
      one1.body?.timeline_total === total,
    `n=${(one1.body?.timeline_events ?? []).length} next=${one1.body?.timeline_next_offset} total=${one1.body?.timeline_total}`,
  )
  rec.check(
    'limit=1 returns the SAME newest event the default page put first (stable ordering)',
    one1.body?.timeline_events?.[0]?.id === base.body?.timeline_events?.[0]?.id,
    `limit=1 first id matches default first id`,
  )
  // Walking the whole log one row at a time must visit every event exactly once.
  const walked = []
  let cursor = 0
  for (let guard = 0; guard < total + 5 && cursor !== null; guard++) {
    const page = await results(g.gid, device, `&limit=1&offset=${cursor}`)
    for (const e of page.body?.timeline_events ?? []) walked.push(e.id)
    cursor = page.body?.timeline_next_offset
  }
  rec.check(
    'paging limit=1 from 0 to the end visits every event exactly once, with no gaps or repeats',
    walked.length === total && new Set(walked).size === total,
    `walked=${walked.length} distinct=${new Set(walked).size} total=${total}`,
  )

  // --- a mid-range offset -------------------------------------------------
  const midOffset = Math.max(1, Math.floor(total / 2))
  const mid = await results(g.gid, device, `&offset=${midOffset}&limit=5`)
  rec.check(
    `a mid-range offset (${midOffset}) returns the expected slice and echoes its offset`,
    mid.status === 200 &&
      mid.body?.timeline_offset === midOffset &&
      (mid.body?.timeline_events ?? []).length === Math.min(5, total - midOffset) &&
      mid.body?.timeline_total === total,
    `offset=${mid.body?.timeline_offset} n=${(mid.body?.timeline_events ?? []).length} next=${mid.body?.timeline_next_offset}`,
  )
  rec.check(
    'the mid-range slice matches the same window of the full page (offset arithmetic is consistent)',
    JSON.stringify((mid.body?.timeline_events ?? []).map((e) => e.id)) ===
      JSON.stringify(
        (base.body?.timeline_events ?? []).slice(midOffset, midOffset + 5).map((e) => e.id),
      ),
    `slice ids equal base[${midOffset}..${midOffset + 5}]`,
  )

  // --- offset exactly AT the end, and past it -----------------------------
  const atEnd = await results(g.gid, device, `&offset=${total}&limit=10`)
  rec.check(
    'offset exactly == total is accepted and returns an empty page (not an error)',
    atEnd.status === 200 &&
      (atEnd.body?.timeline_events ?? []).length === 0 &&
      atEnd.body?.timeline_next_offset === null,
    `status=${atEnd.status} n=${(atEnd.body?.timeline_events ?? []).length} next=${atEnd.body?.timeline_next_offset}`,
  )
  // Past the end. This case PINNED the old buggy behaviour on purpose so a fix
  // would flip it — which is exactly what happened. An offset beyond the last row
  // is a valid request for an empty page, not a server fault, and it is reachable
  // without malice: the response advertises timeline_next_offset, so any client
  // that keeps paging lands there. Requested twice, because a single 500 from Next
  // dev can be the cold-route artifact rather than the app.
  const past = await results(g.gid, device, `&offset=${total + 1}&limit=10`)
  const far = await results(g.gid, device, '&offset=99999&limit=10')
  const pastAgain = await results(g.gid, device, `&offset=${total + 1}&limit=10`)
  const overrunIsEmptyPage =
    [past, pastAgain, far].every(
      (r) =>
        r.status === 200 &&
        Array.isArray(r.body?.timeline_events) &&
        r.body.timeline_events.length === 0 &&
        r.body.timeline_total === total &&
        r.body.timeline_next_offset === null,
    )
  rec.check(
    'FIXED: an offset past the end returns an empty 200 page with next_offset=null, not a 500',
    overrunIsEmptyPage && atEnd.status === 200,
    `offset=${total} -> ${atEnd.status}; offset=${total + 1} -> ${past.status} rows=${past.body?.timeline_events?.length} next=${JSON.stringify(past.body?.timeline_next_offset)}; repeat -> ${pastAgain.status}; offset=99999 -> ${far.status} rows=${far.body?.timeline_events?.length}`,
  )
  rec.note(
    `FIXED (was a real bug, found by this scenario): /api/games/[id]/results 500'd for ANY offset past the last event. Measured on a ${total}-event game: offset=${total} returned 200 with an empty page, but offset=${total + 1} returned HTTP 500 {"error":"events_lookup_failed","details":"Requested range not satisfiable"} — off by exactly one from the request shape immediately below it — and so did offset=99999. Cause: QuerySchema validated offset >= 0 but never against the row count, and the bare .range(offset, offset + limit - 1) let PostgREST's range error funnel into the same generic 500 branch as a genuine DB failure. Since the response advertises timeline_next_offset, a client that keeps paging reaches it without malice, and a 500 is indistinguishable from a dropped connection. Fix: short-circuit to an empty page when offset >= total, using the event count already loaded for the terminal-event lookup (so the count is free). next_offset is null past the end, which stops a paging client rather than looping it.`,
  )

  // --- the Zod bounds: rejected, or silently clamped? ---------------------
  const zeroLimit = await results(g.gid, device, '&limit=0')
  rec.check(
    'limit=0 is REJECTED by Zod with 400 invalid_query — not silently clamped to 1',
    zeroLimit.status === 400 && zeroLimit.body?.error === 'invalid_query',
    `status=${zeroLimit.status} error=${zeroLimit.body?.error} (min(1) at route.ts:17)`,
  )
  const overLimit = await results(g.gid, device, '&limit=101')
  rec.check(
    'limit=101 is REJECTED with 400 invalid_query — not silently clamped to 100',
    overLimit.status === 400 && overLimit.body?.error === 'invalid_query',
    `status=${overLimit.status} error=${overLimit.body?.error} (max(100) at route.ts:17)`,
  )
  rec.check(
    'both rejections name the offending field, so a client can tell which bound it broke',
    Array.isArray(zeroLimit.body?.details) &&
      zeroLimit.body.details.some((issue) => (issue.path ?? []).includes('limit')) &&
      Array.isArray(overLimit.body?.details) &&
      overLimit.body.details.some((issue) => (issue.path ?? []).includes('limit')),
    `limit=0 details=${JSON.stringify(zeroLimit.body?.details?.[0] ?? null)}`,
  )
  const negOffset = await results(g.gid, device, '&offset=-1')
  rec.check(
    'offset=-1 is REJECTED with 400 (min(0)), never coerced to 0',
    negOffset.status === 400 && negOffset.body?.error === 'invalid_query',
    `status=${negOffset.status} error=${negOffset.body?.error}`,
  )
  const nonNumeric = await results(g.gid, device, '&limit=abc')
  rec.check(
    'a non-numeric limit is rejected rather than falling back to the default',
    nonNumeric.status === 400 && nonNumeric.body?.error === 'invalid_query',
    `status=${nonNumeric.status} error=${nonNumeric.body?.error} (z.coerce.number() yields NaN, which fails int())`,
  )
  const boundary = await results(g.gid, device, '&limit=100')
  rec.check(
    'the inclusive bounds themselves are accepted (limit=1 above, limit=100 here)',
    boundary.status === 200,
    `limit=100 -> ${boundary.status}`,
  )

  // --- and the auth/phase guards on the same endpoint ---------------------
  const stranger = await results(g.gid, 'not-a-player-device')
  rec.check(
    '/results is 403 for a device that is not in the game (soft auth holds on the results page)',
    stranger.status === 403 && stranger.body?.error === 'forbidden',
    `status=${stranger.status} error=${stranger.body?.error}`,
  )
  const unfinished = await openGame(1, 1, 'edge-paging-live')
  const early = await results(unfinished.gid, unfinished.west[0].device)
  rec.check(
    '/results is 409 game_not_finished while the game is still live',
    early.status === 409 && early.body?.error === 'game_not_finished',
    `status=${early.status} error=${early.body?.error}`,
  )
})

// ---------------------------------------------------------------------------
// 4. SCORING AFTER flag_carrier_stripped (migration 0053)
// ---------------------------------------------------------------------------
// RULEBOOK §13: photographing the enemy real flag is worth +10 whether or not
// the run completes. 0053 made a tag END the run. So a stripped raid must keep
// the +10 and must NOT also produce a win.
await strictStep(rec, 'scoring: a stripped carrier keeps the +10 but does not win', async () => {
  const g = await openGame(2, 2, 'edge-stripped')
  rec.note(`case 4 game ${g.code} — tagged carrier, then timeout`)
  advanceClockMinutes(g.gid, 31)
  rec.clockJump({ minutes: 31, game: g.code, reason: 'clear the 30-min protection window' })

  const carrier = g.east[0]
  const defender = g.west[0]
  const proof = await uploadFlagAttemptProof(g.gid, carrier.player, 'stripped')
  const grab = await post(`/api/games/${g.gid}/attempt-flag`, {
    device_id: carrier.device,
    player_id: carrier.player,
    landmark_ref: 'landmark.miradouro-vila-velha',
    pos: fresh(WEST_REAL),
    photo_url: proof,
  })
  rec.check(
    'East photographs the West real flag and becomes carrier',
    grab.body?.result === 'real' &&
      one(`select flag_carrier from players where id='${carrier.player}';`) === 't' &&
      gameStatus(g.gid) === 'flag_found',
    `result=${grab.body?.result ?? grab.body?.error} game=${gameStatus(g.gid)}`,
  )

  await heartbeat(g, defender, WEST_REAL)
  const tag = await post(`/api/games/${g.gid}/tag`, {
    device_id: defender.device,
    tagger_player_id: defender.player,
    tagger_pos: fresh(WEST_REAL),
    targets: [{ player_id: carrier.player, pos: fresh(offsetMeters(WEST_REAL, 6, 0)) }],
  })
  rec.check(
    '0053: the tag lands and STRIPS the carrier flag',
    (tag.body?.tagged_player_ids ?? []).includes(carrier.player) &&
      one(`select flag_carrier from players where id='${carrier.player}';`) === 'f' &&
      eventCount(g.gid, 'flag_carrier_stripped') === 1,
    `tagged=${JSON.stringify(tag.body?.tagged_player_ids)} flag_carrier=${one(`select flag_carrier from players where id='${carrier.player}';`)} stripped events=${eventCount(g.gid, 'flag_carrier_stripped')}`,
  )
  rec.check(
    'games.status stays flag_found — the flag stays DISCOVERED, so the photo is not retroactively voided',
    gameStatus(g.gid) === 'flag_found',
    `status=${gameStatus(g.gid)}`,
  )

  // The stripped ex-carrier completes the respawn cycle and reaches home: the
  // run must still be refused, so no win can be credited.
  const target = one(`select respawn_target_ref from players where id='${carrier.player}';`)
  const neutral = coord(target)
  await post(`/api/games/${g.gid}/respawn-clear`, {
    device_id: carrier.device,
    player_id: carrier.player,
    pos: fresh(neutral),
  })
  await post(`/api/games/${g.gid}/respawn-clear`, {
    device_id: carrier.device,
    player_id: carrier.player,
    pos: fresh(offsetMeters(neutral, 60, 0)),
  })
  const run = await post(`/api/games/${g.gid}/complete-run`, {
    device_id: carrier.device,
    player_id: carrier.player,
    pos: fresh(EAST_REAL),
  })
  rec.check(
    'the stripped player cannot complete the run even standing at their own home base',
    run.status >= 400 && run.body?.error === 'not_flag_carrier',
    `status=${run.status} error=${run.body?.error} respawn cleared, at home (${hav(EAST_REAL, EAST_REAL).toFixed(0)} m)`,
  )
  rec.check(
    'the stripped run credits NO win: zero game_won events while the game is still in play',
    eventCount(g.gid, 'game_won') === 0 && gameStatus(g.gid) === 'flag_found',
    `game_won=${eventCount(g.gid, 'game_won')} status=${gameStatus(g.gid)}`,
  )

  advanceClockMinutes(g.gid, 190)
  rec.clockJump({ minutes: 190, game: g.code, reason: 'let the stripped game time out' })
  const to = await post(`/api/games/${g.gid}/end-by-timeout`, { device_id: defender.device })
  const east = (to.body?.scores ?? []).find((s) => s.team_id === g.eTeam)
  const west = (to.body?.scores ?? []).find((s) => s.team_id === g.wTeam)
  rec.check(
    'RULEBOOK §13: the +10 SURVIVES the strip — the raiding team still scores flag_points 10',
    east?.flag_points === 10 && east?.found_real_flag === true,
    `east flag_points=${east?.flag_points} found_real_flag=${east?.found_real_flag} total=${east?.total}`,
  )
  rec.check(
    'the defending team is credited its tag (+1), including the tag that did the stripping',
    west?.tags_made === 1 && west?.tag_points === 1,
    `west tags_made=${west?.tags_made} tag_points=${west?.tag_points} total=${west?.total}`,
  )
  rec.check(
    'the raider still wins on POINTS (10 > 1) — the strip costs the run, not the score',
    to.body?.winner_team_id === g.eTeam && to.body?.reason === 'timeout_points',
    `winner=${to.body?.winner_team_id === g.eTeam ? 'East (raider)' : 'West'} reason=${to.body?.reason} east=${east?.total} west=${west?.total}`,
  )
  rec.check(
    'the ending is a TIMEOUT, not a flag return: exactly one game_won whose reason is the timeout reason',
    eventCount(g.gid, 'game_won') === 1 &&
      num(
        `select count(*) from events where game_id='${g.gid}' and type='game_won' and payload->>'reason'='flag_returned';`,
      ) === 0,
    `game_won=${eventCount(g.gid, 'game_won')} flag_returned wins=0 timeout events=${eventCount(g.gid, 'game_ended_by_timeout')}`,
  )
  const res = await results(g.gid, defender.device)
  rec.check(
    '/results shows the same +10 and the same timeout winner after the strip',
    res.body?.winner_team_id === to.body.winner_team_id &&
      (res.body?.scores ?? []).find((s) => s.team_id === g.eTeam)?.flag_points === 10,
    `results winner match=${res.body?.winner_team_id === to.body.winner_team_id} east flag_points=${(res.body?.scores ?? []).find((s) => s.team_id === g.eTeam)?.flag_points}`,
  )
  rec.check(
    'the flag_carrier_stripped event itself contributes no score (computeScores ignores it)',
    (res.body?.scores ?? []).reduce((sum, s) => sum + s.total, 0) === 11,
    `combined total=${(res.body?.scores ?? []).reduce((sum, s) => sum + s.total, 0)} (10 flag + 1 tag; the strip event adds nothing)`,
  )
})

// ---------------------------------------------------------------------------
// 5. /observer-state ACROSS EVERY PHASE, AND THE SECURITY BOUNDARY
// ---------------------------------------------------------------------------
// This endpoint is PUBLIC (no device auth at all) and it is the ONLY thing
// hiding flag locations from a spectator: 0008:37 grants anon `select using
// (true)` on landmarks, so RLS does not help here (CLAUDE.md decision 5). A leak
// of `kind` or `hardened` would hand a watcher every flag position.
await strictStep(rec, 'observer-state: sane payload in every phase, and no kind/hardened leak', async () => {
  const tag = `edge-obs-${seed}-${Date.now()}`
  const create = await apiPost('/api/games', {
    display_name: 'W1',
    device_id: `w-${tag}`,
    preferred_side: 'west',
  })
  const gid = create.game.id
  const wTeam = create.teams.find((t) => t.side === 'west').id
  const eTeam = create.teams.find((t) => t.side === 'east').id
  rec.note(`case 5 game ${create.game.code} — observer across lobby -> setup -> live -> finished`)
  await warmRoutes(gid)

  const SAFE_LANDMARK_KEYS = ['id', 'ref', 'lat', 'lng', 'team_id']
  const SAFE_PLAYER_KEYS = ['id', 'team_id', 'display_name', 'flag_carrier', 'respawning']
  const LEAKY_KEYS = ['kind', 'hardened']
  /** Assert the redaction contract on whatever phase we are in. */
  const assertRedacted = (phase, body) => {
    const landmarks = body?.landmarks ?? []
    const players = body?.players ?? []
    const leaked = landmarks.filter((l) => LEAKY_KEYS.some((k) => k in l))
    const extraLandmarkKeys = [
      ...new Set(landmarks.flatMap((l) => Object.keys(l))),
    ].filter((k) => !SAFE_LANDMARK_KEYS.includes(k))
    const extraPlayerKeys = [
      ...new Set(players.flatMap((p) => Object.keys(p))),
    ].filter((k) => !SAFE_PLAYER_KEYS.includes(k))
    rec.check(
      `${phase}: NO landmark exposes kind or hardened (the flag-location boundary holds)`,
      leaked.length === 0,
      `${landmarks.length} landmarks, ${leaked.length} leaking; key union=${JSON.stringify([...new Set(landmarks.flatMap((l) => Object.keys(l)))])}`,
    )
    rec.check(
      `${phase}: landmarks are stripped to exactly ${SAFE_LANDMARK_KEYS.join('/')} — nothing extra slipped in`,
      extraLandmarkKeys.length === 0,
      extraLandmarkKeys.length === 0 ? 'no unexpected keys' : `UNEXPECTED: ${JSON.stringify(extraLandmarkKeys)}`,
    )
    rec.check(
      `${phase}: players are stripped to identity + visible status only (no device_id, no is_host)`,
      extraPlayerKeys.length === 0 &&
        !players.some((p) => 'device_id' in p),
      extraPlayerKeys.length === 0 ? `${players.length} players, safe shape` : `UNEXPECTED: ${JSON.stringify(extraPlayerKeys)}`,
    )
    rec.check(
      `${phase}: the payload omits cards / active_curses / placed_curses entirely (private team state)`,
      !['cards', 'active_curses', 'placed_curses', 'intel', 'flag_surroundings'].some(
        (k) => k in (body ?? {}),
      ),
      `top-level keys=${JSON.stringify(Object.keys(body ?? {}))}`,
    )
  }

  // --- LOBBY ---------------------------------------------------------------
  const lobby = await observer(gid)
  rec.check(
    'lobby: 200 with both teams, the creator, a zero scoreboard and no landmarks yet',
    lobby.status === 200 &&
      lobby.body?.game?.status === 'lobby' &&
      (lobby.body?.teams ?? []).length === 2 &&
      (lobby.body?.players ?? []).length === 1 &&
      (lobby.body?.landmarks ?? []).length === 0 &&
      (lobby.body?.scores ?? []).length === 2 &&
      (lobby.body?.scores ?? []).every((s) => s.total === 0),
    `status=${lobby.body?.game?.status} teams=${(lobby.body?.teams ?? []).length} players=${(lobby.body?.players ?? []).length} landmarks=${(lobby.body?.landmarks ?? []).length} scores=${JSON.stringify((lobby.body?.scores ?? []).map((s) => s.total))}`,
  )
  assertRedacted('lobby', lobby.body)

  // --- SETUP --------------------------------------------------------------
  const join = await apiPost(`/api/games/${gid}/join`, {
    display_name: 'E1',
    device_id: `e-${tag}`,
    preferred_side: 'east',
  })
  const ePlayer = join.player?.id ?? join.me?.id ?? join.id
  await apiPost(`/api/games/${gid}/ready`, {
    player_id: create.me.id,
    device_id: `w-${tag}`,
    ready: true,
  })
  await apiPost(`/api/games/${gid}/ready`, {
    player_id: ePlayer,
    device_id: `e-${tag}`,
    ready: true,
  })
  await apiPost(`/api/games/${gid}/start`, { device_id: `w-${tag}` })
  const setup = await observer(gid)
  rec.check(
    'setup: 200, phase reported as setup, still no landmarks (neither team has placed)',
    setup.status === 200 &&
      setup.body?.game?.status === 'setup' &&
      (setup.body?.landmarks ?? []).length === 0 &&
      (setup.body?.players ?? []).length === 2,
    `status=${setup.body?.game?.status} landmarks=${(setup.body?.landmarks ?? []).length} players=${(setup.body?.players ?? []).length}`,
  )
  assertRedacted('setup', setup.body)

  // HALF-SETUP is the sharpest version of the leak question: West's 5 candidates
  // exist (one of them the real flag) while East has placed nothing, so any
  // `kind` field here would name West's real flag outright.
  await apiPost(`/api/games/${gid}/flag-setup`, {
    device_id: `w-${tag}`,
    assignments: WEST_ASSIGN,
    surroundings_photo_path: await uploadSurroundingsPhoto(gid, wTeam, `${tag}-w`),
  })
  const half = await observer(gid)
  rec.check(
    'half-setup: West\'s 5 candidates are visible as bare coordinates, with the real flag among them unmarked',
    (half.body?.landmarks ?? []).length === 5 &&
      (half.body?.landmarks ?? []).every((l) => l.team_id === wTeam) &&
      num(
        `select count(*) from landmarks where game_id='${gid}' and team_id='${wTeam}' and kind='flag_real';`,
      ) === 1,
    `landmarks=${(half.body?.landmarks ?? []).length} all West=${(half.body?.landmarks ?? []).every((l) => l.team_id === wTeam)}; DB confirms 1 flag_real among them, none of it exposed`,
  )
  assertRedacted('half-setup', half.body)

  // --- LIVE ---------------------------------------------------------------
  await apiPost(`/api/games/${gid}/flag-setup`, {
    device_id: `e-${tag}`,
    assignments: EAST_ASSIGN,
    surroundings_photo_path: await uploadSurroundingsPhoto(gid, eTeam, `${tag}-e`),
  })
  const live = await observer(gid)
  rec.check(
    'live: all 10 candidates from BOTH teams are visible, ownership included',
    live.status === 200 &&
      live.body?.game?.status === 'live' &&
      (live.body?.landmarks ?? []).length === 10 &&
      new Set((live.body?.landmarks ?? []).map((l) => l.team_id)).size === 2,
    `status=${live.body?.game?.status} landmarks=${(live.body?.landmarks ?? []).length} distinct owners=${new Set((live.body?.landmarks ?? []).map((l) => l.team_id)).size}`,
  )
  assertRedacted('live', live.body)
  rec.check(
    'live: the DB holds 2 real flags and 4 decoys for these same refs — none of that classification reaches the spectator',
    num(`select count(*) from landmarks where game_id='${gid}' and kind='flag_real';`) === 2 &&
      num(`select count(*) from landmarks where game_id='${gid}' and kind='flag_decoy';`) === 4,
    `DB: flag_real=${num(`select count(*) from landmarks where game_id='${gid}' and kind='flag_real';`)} flag_decoy=${num(`select count(*) from landmarks where game_id='${gid}' and kind='flag_decoy';`)} flag_empty=${num(`select count(*) from landmarks where game_id='${gid}' and kind='flag_empty';`)} — observer payload carries no kind at all`,
  )

  // Hardening is the other secret: only a real flag can be hardened, so a
  // `hardened` field would be a direct pointer. Harden West's flag and re-check.
  db(`update teams set coins = 900 where id='${wTeam}';`)
  // harden-flag requires the landmark_ref of the team's OWN real flag, so the ref
  // is read from the DB (the route re-verifies ownership and kind itself).
  const westRealRef = one(
    `select ref from landmarks where game_id='${gid}' and team_id='${wTeam}' and kind='flag_real';`,
  )
  const harden = await post(`/api/games/${gid}/harden-flag`, {
    device_id: `w-${tag}`,
    player_id: create.me.id,
    landmark_ref: westRealRef,
  })
  rec.check(
    'West hardens its real flag (only a real flag can be hardened, so the flag is now DB-distinguishable)',
    harden.status < 400 &&
      num(`select count(*) from landmarks where game_id='${gid}' and hardened;`) === 1,
    `status=${harden.status} ${harden.body?.error ?? 'ok'} ref=${westRealRef} hardened rows=${num(`select count(*) from landmarks where game_id='${gid}' and hardened;`)}`,
  )
  const afterHarden = await observer(gid)
  assertRedacted('live+hardened', afterHarden.body)

  // A live curse and a placed curse must not surface either.
  db(
    `insert into active_curses(game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${gid}','${eTeam}','curse.mute', now(), now()+interval '15 minutes','{}'::jsonb);`,
  )
  await post(`/api/games/${gid}/place-curse`, {
    device_id: `w-${tag}`,
    player_id: create.me.id,
    landmark_ref: 'landmark.miradouro-vila-velha',
    placed_ref: 'placed.slow-trap',
  })
  const withSecrets = await observer(gid)
  rec.check(
    'a live curse and an armed placed curse exist in the DB but appear nowhere in the observer payload',
    num(`select count(*) from active_curses where game_id='${gid}';`) >= 1 &&
      num(`select count(*) from placed_curses where game_id='${gid}' and armed;`) >= 1 &&
      !['active_curses', 'placed_curses'].some((k) => k in (withSecrets.body ?? {})),
    `DB active_curses=${num(`select count(*) from active_curses where game_id='${gid}';`)} armed placements=${num(`select count(*) from placed_curses where game_id='${gid}' and armed;`)}; payload keys=${JSON.stringify(Object.keys(withSecrets.body ?? {}))}`,
  )
  assertRedacted('live+secrets', withSecrets.body)
  rec.check(
    'the recent_events feed is capped at 80 and is ascending (oldest first), as the client expects',
    (withSecrets.body?.recent_events ?? []).length <= 80 &&
      (() => {
        const rows = withSecrets.body?.recent_events ?? []
        for (let i = 1; i < rows.length; i++) {
          if (Date.parse(rows[i - 1].created_at) > Date.parse(rows[i].created_at)) return false
        }
        return true
      })(),
    `recent_events=${(withSecrets.body?.recent_events ?? []).length} ascending=true`,
  )

  // --- FINISHED -----------------------------------------------------------
  advanceClockMinutes(gid, 190)
  rec.clockJump({ minutes: 190, game: create.game.code, reason: 'finish the observed game' })
  await post(`/api/games/${gid}/end-by-timeout`, { device_id: `w-${tag}` })
  const finished = await observer(gid)
  rec.check(
    'finished: 200, status reported as finished, and the terminal events are in the feed',
    finished.status === 200 &&
      finished.body?.game?.status === 'finished' &&
      (finished.body?.recent_events ?? []).some((e) => e.type === 'game_ended_by_timeout') &&
      (finished.body?.recent_events ?? []).some((e) => e.type === 'game_won'),
    `status=${finished.body?.game?.status} has timeout event=${(finished.body?.recent_events ?? []).some((e) => e.type === 'game_ended_by_timeout')}`,
  )
  rec.check(
    'finished: the scoreboard is present and finite for both teams',
    (finished.body?.scores ?? []).length === 2 &&
      (finished.body?.scores ?? []).every((s) => Number.isFinite(s.total)),
    JSON.stringify((finished.body?.scores ?? []).map((s) => ({ side: s.team_side, total: s.total }))),
  )
  rec.check(
    'finished: STILL no kind/hardened — the flag locations stay hidden even after the game is over',
    ((finished.body?.landmarks ?? []).length === 10) &&
      !(finished.body?.landmarks ?? []).some((l) => 'kind' in l || 'hardened' in l),
    `landmarks=${(finished.body?.landmarks ?? []).length}, none carrying kind/hardened`,
  )
  assertRedacted('finished', finished.body)
  rec.note(
    'The observer payload never carries kind or hardened in any phase — verified at lobby, setup, half-setup (West\'s real flag placed and East\'s not), live, live+hardened, live+curses and finished. Worth stating plainly what this does and does NOT prove: it pins the CURATED endpoint, which CLAUDE.md decision 5 names as the only thing hiding flag kinds. It says nothing about the v1.1 REST gap — 0008:37 still grants anon `select using (true)` on landmarks, so a spectator who uses the anon key directly against /rest/v1/landmarks reads `kind` regardless of this endpoint. That gap is a known open item, not something this scenario can close.',
  )

  // 404 / malformed id handling on a PUBLIC endpoint.
  const missing = await observer('00000000-0000-0000-0000-000000000000')
  rec.check(
    'a non-existent game id is a clean 404 not_found',
    missing.status === 404 && missing.body?.error === 'not_found',
    `status=${missing.status} error=${missing.body?.error}`,
  )
  const malformed = await observer('not-a-uuid')
  const malformedAgain = await observer('not-a-uuid')
  const malformedIs500 =
    malformed.status === 500 &&
    malformed.body?.error === 'game_lookup_failed' &&
    malformedAgain.status === 500
  rec.check(
    'PINNED (and wrong — see FINDING): a malformed game id returns 500 game_lookup_failed with the raw DB message, where a well-formed unknown id returns 404',
    malformedIs500 && missing.status === 404,
    `malformed -> ${malformed.status} ${malformed.body?.error} details=${JSON.stringify(malformed.body?.details ?? '').slice(0, 120)}; repeat -> ${malformedAgain.status}; unknown-but-valid uuid -> ${missing.status}`,
  )
  if (malformedIs500) {
    const finding =
      'FINDING (minor, public endpoint): GET /api/games/[id]/observer-state answers HTTP 500 {"error":"game_lookup_failed"} for a syntactically invalid game id, where a non-existent but well-formed uuid correctly answers 404 not_found. The route has no uuid validation (observer-state/route.ts:62-77 goes straight to .eq(\'id\', gameId)), so Postgres\'s invalid-input-syntax error is surfaced as a server fault with the raw DB message in the details field. It is reachable by anyone — the endpoint takes no auth at all — by mistyping an observer link, and it leaks a database error string to an unauthenticated caller. Compare /results, which validates its query with Zod but has the same unvalidated id. Fix: a z.string().uuid() check on the path param, answering 404 (or 400) instead. NOT FIXED — reported for decision.'
    findings.push(finding)
    rec.note(finding)
  }
})

// ---------------------------------------------------------------------------
// 6. TIMEOUT WITH A flag_found BUT NO COMPLETED RUN
// ---------------------------------------------------------------------------
// The photo landed, the carrier never got home, the clock ran out. Who wins,
// and does the +10 count? Distinct from case 4: here the carrier is still
// flagged at the deadline, so the run was interrupted by TIME, not by a tag.
await strictStep(rec, 'timeout: flag photographed, carrier never got home', async () => {
  const g = await openGame(1, 1, 'edge-flagfound-timeout')
  rec.note(`case 6 game ${g.code} — flag_found at the deadline, run never completed`)
  advanceClockMinutes(g.gid, 31)
  rec.clockJump({ minutes: 31, game: g.code, reason: 'clear the 30-min protection window' })

  const carrier = g.east[0]
  const proof = await uploadFlagAttemptProof(g.gid, carrier.player, 'ff-timeout')
  const grab = await post(`/api/games/${g.gid}/attempt-flag`, {
    device_id: carrier.device,
    player_id: carrier.player,
    landmark_ref: 'landmark.miradouro-vila-velha',
    pos: fresh(WEST_REAL),
    photo_url: proof,
  })
  rec.check(
    'East photographs the real flag; the game moves to flag_found with a live carrier',
    grab.body?.result === 'real' &&
      gameStatus(g.gid) === 'flag_found' &&
      one(`select flag_carrier from players where id='${carrier.player}';`) === 't',
    `result=${grab.body?.result ?? grab.body?.error} status=${gameStatus(g.gid)} carrier=${one(`select flag_carrier from players where id='${carrier.player}';`)}`,
  )
  // The carrier is stranded far from home when the clock runs out.
  const strandedAt = offsetMeters(WEST_REAL, 30, 30)
  rec.check(
    `the carrier is still ${Math.round(hav(strandedAt, EAST_REAL))} m from their home base when the deadline arrives`,
    hav(strandedAt, EAST_REAL) > 100,
    `distance to East home=${Math.round(hav(strandedAt, EAST_REAL))} m`,
  )

  advanceClockMinutes(g.gid, 190)
  rec.clockJump({ minutes: 190, game: g.code, reason: 'the deadline arrives mid-run' })
  const to = await post(`/api/games/${g.gid}/end-by-timeout`, { device_id: g.west[0].device })
  const east = (to.body?.scores ?? []).find((s) => s.team_id === g.eTeam)
  const west = (to.body?.scores ?? []).find((s) => s.team_id === g.wTeam)
  rec.check(
    'a game in flag_found CAN be ended by timeout (the status is accepted, not rejected)',
    to.status === 200 && gameStatus(g.gid) === 'finished',
    `status=${to.status} error=${to.body?.error ?? 'none'} game=${gameStatus(g.gid)}`,
  )
  rec.check(
    'the +10 COUNTS even though the run never completed (§13: the photo scores, not the delivery)',
    east?.flag_points === 10 && east?.found_real_flag === true && east?.total === 10,
    `east flag_points=${east?.flag_points} found=${east?.found_real_flag} total=${east?.total} | west total=${west?.total}`,
  )
  rec.check(
    'the photographing team wins on points, decided by the +10 alone',
    to.body?.winner_team_id === g.eTeam && to.body?.reason === 'timeout_points',
    `winner=${to.body?.winner_team_id === g.eTeam ? 'East (photographer)' : 'West'} reason=${to.body?.reason} 10 vs ${west?.total}`,
  )
  rec.check(
    'the win is recorded as a TIMEOUT, never as flag_returned',
    num(
      `select count(*) from events where game_id='${g.gid}' and type='game_won' and payload->>'reason'='flag_returned';`,
    ) === 0 && eventCount(g.gid, 'game_ended_by_timeout') === 1,
    `flag_returned wins=0 timeout events=${eventCount(g.gid, 'game_ended_by_timeout')} reason on game_won=${one(`select payload->>'reason' from events where game_id='${g.gid}' and type='game_won' limit 1;`)}`,
  )
  rec.check(
    'the carrier flag is left SET on the stranded player — the timeout does not tidy it',
    one(`select flag_carrier from players where id='${carrier.player}';`) === 't',
    `flag_carrier=${one(`select flag_carrier from players where id='${carrier.player}';`)} (a cosmetic leftover; the game is finished so it can no longer be acted on)`,
  )
  const late = await post(`/api/games/${g.gid}/complete-run`, {
    device_id: carrier.device,
    player_id: carrier.player,
    pos: fresh(EAST_REAL),
  })
  rec.check(
    'a carrier who reaches home AFTER the timeout cannot convert it into a flag win',
    eventCount(g.gid, 'game_won') === 1 &&
      num(
        `select count(*) from events where game_id='${g.gid}' and type='game_won' and payload->>'reason'='flag_returned';`,
      ) === 0,
    `complete-run -> ${late.status} ${late.body?.error ?? JSON.stringify(late.body?.reason ?? '')}; game_won still ${eventCount(g.gid, 'game_won')} with no flag_returned`,
  )
  const res = await results(g.gid, carrier.device)
  rec.check(
    '/results tells the carrier the same thing: +10 kept, timeout winner, no flag return',
    res.body?.reason === 'timeout_points' &&
      res.body?.winner_team_id === g.eTeam &&
      (res.body?.scores ?? []).find((s) => s.team_id === g.eTeam)?.flag_points === 10,
    `reason=${res.body?.reason} winner=East=${res.body?.winner_team_id === g.eTeam} flag_points=${(res.body?.scores ?? []).find((s) => s.team_id === g.eTeam)?.flag_points}`,
  )
  const obs = await observer(g.gid)
  rec.check(
    'the observer board shows the stranded carrier and the same finished scoreboard',
    (obs.body?.players ?? []).some((p) => p.id === carrier.player && p.flag_carrier === true) &&
      (obs.body?.scores ?? []).find((s) => s.team_id === g.eTeam)?.total === 10,
    `observer carrier flagged=${(obs.body?.players ?? []).some((p) => p.id === carrier.player && p.flag_carrier)} east total=${(obs.body?.scores ?? []).find((s) => s.team_id === g.eTeam)?.total}`,
  )
})

// ---------------------------------------------------------------------------
rec.note('--- FINDINGS ---')
if (findings.length === 0) rec.note('none')
for (const f of findings) rec.note(f)

const { failed } = rec.finish({ endgameFindings: findings })
process.exitCode = failed > 0 ? 1 : 0
