// Terminal paths + the timeout tiebreak ladder (RULEBOOK §13).
//
//   node tools/sim/scenario-terminal-ties.mjs [seed]
//
// Only two terminal paths exist: flag carried home, and the 180-min timeout.
// This covers the timeout ladder end to end — points, challenges, coins, and
// the mandatory coin flip on an exact tie — plus the recompute path that
// end-by-timeout uses when re-read after the game is already finished.

import { makeGameN, coord, db, BASE, uploadFlagAttemptProof } from './harness.mjs'
import { advanceClockMinutes } from './clock.mjs'
import { makeRecorder, strictStep } from './artifact.mjs'

const seed = Number(process.argv[2] || 4242)
const rec = makeRecorder({ scenario: 'terminal-ties', seed })

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

// Build a game, optionally skew the score, then time it out.
async function timeoutGame(label, prep) {
  const g = await makeGameN(1, 1, `tt-${seed}-${label}`)
  db(`update teams set coins = 300 where game_id='${g.gid}';`)
  advanceClockMinutes(g.gid, 31)
  if (prep) await prep(g)
  advanceClockMinutes(g.gid, 190)
  const r = await post(`/api/games/${g.gid}/end-by-timeout`, { device_id: g.west[0].device })
  return { g, r }
}

// --- 1. Exact tie → coin flip, never a null winner (0045:236) ---
await strictStep(rec, 'exact tie', async () => {
  const { g, r } = await timeoutGame('tie', null)
  rec.check(
    'exact tie yields a concrete winner (RULEBOOK §13 coin flip), not a null tie',
    r.body.winner_team_id != null,
    `winner=${r.body.winner_team_id} reason=${r.body.reason}`,
  )
  rec.check(
    'tie reason is timeout_coin_flip',
    r.body.reason === 'timeout_coin_flip',
    `reason=${r.body.reason}`,
  )
  const scores = r.body.scores ?? []
  rec.check(
    'curse_points and coin_points are 0 for both teams (§13 stats-only)',
    scores.length === 2 && scores.every((s) => s.curse_points === 0 && s.coin_points === 0),
    JSON.stringify(scores.map((s) => ({ t: s.total, c: s.curse_points, co: s.coin_points }))),
  )

  // The recompute path: re-read a finished game. Before the fix this fell
  // through to pickTimeoutWinner(), which has no coin-flip branch and would
  // answer winner=null / reason=timeout_tied — contradicting the persisted flip.
  const again = await post(`/api/games/${g.gid}/end-by-timeout`, { device_id: g.west[0].device })
  rec.check(
    'idempotent re-read returns the SAME persisted winner (no null-tie regression)',
    again.body.winner_team_id === r.body.winner_team_id,
    `first=${r.body.winner_team_id} second=${again.body.winner_team_id} reason=${again.body.reason}`,
  )
  rec.check(
    'idempotent re-read keeps the coin-flip reason',
    again.body.reason === r.body.reason,
    `first=${r.body.reason} second=${again.body.reason}`,
  )

  // And the results route must agree with end-by-timeout.
  const results = await get(
    `/api/games/${g.gid}/results?device_id=${encodeURIComponent(g.west[0].device)}`,
  )
  rec.check(
    'results route agrees with the timeout winner',
    results.body.winner_team_id === r.body.winner_team_id,
    `status=${results.status} results=${results.body.winner_team_id} reason=${results.body.reason}`,
  )

  // Simulate the legacy/partial case the fix targets: a finished timeout game
  // whose game_won row is absent. The winner must still come from the persisted
  // timeout event rather than being recomputed as a tie.
  //
  // Done LAST because it destroys a terminal event; the checks above need the
  // intact game. events has no DELETE guard (0006 dropped it), so this works.
  db(`delete from events where game_id='${g.gid}' and type='game_won';`)
  const legacy = await post(`/api/games/${g.gid}/end-by-timeout`, { device_id: g.west[0].device })
  rec.check(
    'winner survives a missing game_won row (reads the timeout event payload)',
    legacy.body.winner_team_id === r.body.winner_team_id,
    `winner=${legacy.body.winner_team_id} reason=${legacy.body.reason}`,
  )
})

// --- 2. Points decide when totals differ (flag photo = +10) ---
await strictStep(rec, 'points win', async () => {
  const { g, r } = await timeoutGame('pts', async (g) => {
    // East photographs West's real flag: +10 pts, no home run, so the game
    // still ends by timeout rather than by a flag run.
    const proof = await uploadFlagAttemptProof(g.gid, g.east[0].player, 'pts')
    const a = await post(`/api/games/${g.gid}/attempt-flag`, {
      device_id: g.east[0].device,
      player_id: g.east[0].player,
      landmark_ref: 'landmark.miradouro-vila-velha',
      pos: { ...coord('landmark.miradouro-vila-velha'), accuracy: 5, updated_at: Date.now() },
      photo_url: proof,
    })
    rec.check('East photographed the real flag (+10 pts)', a.body.result === 'real', `result=${a.body.result}`)
  })
  const east = (r.body.scores ?? []).find((s) => s.team_id === g.eTeam)
  rec.check(
    'flag photo scores +10 and decides the timeout on points',
    r.body.winner_team_id === g.eTeam && r.body.reason === 'timeout_points',
    `winner=${r.body.winner_team_id === g.eTeam ? 'East' : r.body.winner_team_id} reason=${r.body.reason} eastTotal=${east?.total} flag=${east?.flag_points}`,
  )
})

// --- 3. Coins as the SECOND tiebreaker (equal points, equal challenges) ---
await strictStep(rec, 'coin tiebreak', async () => {
  const { g, r } = await timeoutGame('coins', async (g) => {
    db(`update teams set coins = 500 where id='${g.wTeam}';`)
    db(`update teams set coins = 100 where id='${g.eTeam}';`)
  })
  rec.check(
    'with points and challenges level, more coins wins (§13 second tiebreaker)',
    r.body.winner_team_id === g.wTeam && r.body.reason === 'timeout_tiebreaker',
    `winner=${r.body.winner_team_id === g.wTeam ? 'West' : 'East'} reason=${r.body.reason}`,
  )
  rec.check(
    'coins still contribute 0 points despite deciding the tie',
    (r.body.scores ?? []).every((s) => s.coin_points === 0),
    JSON.stringify((r.body.scores ?? []).map((s) => s.coin_points)),
  )
})

// --- 4. Timeout must not fire early, and a finished game stays finished ---
await strictStep(rec, 'timeout gating', async () => {
  const g = await makeGameN(1, 1, `tt-${seed}-gate`)
  advanceClockMinutes(g.gid, 31)
  const early = await post(`/api/games/${g.gid}/end-by-timeout`, { device_id: g.west[0].device })
  rec.check(
    'end-by-timeout 409s not_yet_expired before 180 min',
    early.status === 409 && early.body.error === 'not_yet_expired',
    `status=${early.status} error=${early.body.error}`,
  )
  rec.check(
    'the 409 tells the player how long is left (ms_remaining)',
    typeof early.body.details?.ms_remaining === 'number',
    `details=${JSON.stringify(early.body.details)}`,
  )
  advanceClockMinutes(g.gid, 190)
  await post(`/api/games/${g.gid}/end-by-timeout`, { device_id: g.west[0].device })
  const terminalCount = Number(
    db(
      `select count(*) from events where game_id='${g.gid}' and type in ('game_won','game_ended_by_timeout');`,
    )[0],
  )
  rec.check(
    'exactly one timeout settlement is recorded (2 events: won + ended_by_timeout)',
    terminalCount === 2,
    `terminal events=${terminalCount}`,
  )
})

const { failed } = rec.finish()
process.exitCode = failed > 0 ? 1 : 0
