// Self-test for the clock-control primitive. Proves the rebase reaches every
// authoritative deadline layer, using the real API and real RPCs — not mocks.
//
//   node tools/sim/selftest-clock.mjs

import { strict as assert } from 'node:assert'
import { setupLiveGame, apiPost, apiGet, coord, db, uploadFlagAttemptProof } from './harness.mjs'
import { advanceClockMinutes, advanceClock, clockSnapshot, campingSet, campingGet } from './clock.mjs'

const tag = `clk-${Date.now()}`
console.log('\n===== CLOCK SELF-TEST =====')
const g = await setupLiveGame(tag)
console.log(`game ${g.code} live (${g.gid})`)

// --- 1. games.started_at: the 30-min protection window (attempt-flag:119) ---
{
  const before = clockSnapshot(g.gid)
  assert.ok(before.elapsedSeconds < 120, `fresh game should be young, got ${before.elapsedSeconds}s`)

  // The protection window must REJECT an attempt at T+0.
  const proof = await uploadFlagAttemptProof(g.gid, g.ePlayer, 'early')
  const early = await fetch(
    `${process.env.SIM_BASE || 'http://localhost:3001'}/api/games/${g.gid}/attempt-flag`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        device_id: g.eDevice,
        player_id: g.ePlayer,
        landmark_ref: 'landmark.miradouro-meia-laranja',
        pos: { ...coord('landmark.miradouro-meia-laranja'), accuracy: 5, updated_at: Date.now() },
        photo_url: proof,
      }),
    },
  )
  const earlyBody = await early.json()
  assert.equal(early.status, 409, `expected 409 inside protection window, got ${early.status}`)
  assert.equal(earlyBody.error, 'attempts_locked')
  console.log('  ✅ protection window blocks an attempt at T+0 (409 attempts_locked)')

  // Advance past it.
  advanceClockMinutes(g.gid, 31)
  const after = clockSnapshot(g.gid)
  assert.ok(
    after.elapsedSeconds >= 31 * 60,
    `after rebase elapsed should be >=1860s, got ${after.elapsedSeconds}`,
  )
  console.log(`  ✅ advanceClock(31min): elapsed ${before.elapsedSeconds}s -> ${after.elapsedSeconds}s`)
}

// --- 2. GPS freshness must SURVIVE the rebase (the key design claim) ---
{
  // A position stamped with real wall-clock Date.now() must still be accepted
  // after a clock rebase. If we had faked a clock forward instead, this 409s.
  const proof = await uploadFlagAttemptProof(g.gid, g.ePlayer, 'fresh')
  const r = await apiPost(`/api/games/${g.gid}/attempt-flag`, {
    device_id: g.eDevice,
    player_id: g.ePlayer,
    landmark_ref: 'landmark.miradouro-meia-laranja',
    pos: { ...coord('landmark.miradouro-meia-laranja'), accuracy: 5, updated_at: Date.now() },
    photo_url: proof,
  })
  assert.equal(r.result, 'decoy', `expected decoy, got ${r.result}`)
  console.log('  ✅ wall-clock GPS stamp still fresh after rebase (attempt accepted) — 30s band intact')
}

// --- 3. events.created_at: the 15-min landmark lockout (0026:107) ---
{
  // The decoy attempt above locked that landmark. Re-attempting must 409.
  await db(`update players set respawning=false, respawn_arrived=false where id='${g.ePlayer}';`)
  const proof = await uploadFlagAttemptProof(g.gid, g.ePlayer, 'locked')
  const blocked = await fetch(
    `${process.env.SIM_BASE || 'http://localhost:3001'}/api/games/${g.gid}/attempt-flag`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        device_id: g.eDevice,
        player_id: g.ePlayer,
        landmark_ref: 'landmark.miradouro-meia-laranja',
        pos: { ...coord('landmark.miradouro-meia-laranja'), accuracy: 5, updated_at: Date.now() },
        photo_url: proof,
      }),
    },
  )
  const body = await blocked.json()
  assert.equal(blocked.status, 409, `expected lockout 409, got ${blocked.status} ${JSON.stringify(body)}`)
  assert.equal(body.error, 'landmark_locked_out')
  console.log('  ✅ 15-min landmark lockout enforced from events.created_at')

  // Now age the events past the lockout. This is the immutable-column path.
  advanceClockMinutes(g.gid, 16)
  await db(`update players set respawning=false, respawn_arrived=false where id='${g.ePlayer}';`)
  const proof2 = await uploadFlagAttemptProof(g.gid, g.ePlayer, 'unlocked')
  const ok = await apiPost(`/api/games/${g.gid}/attempt-flag`, {
    device_id: g.eDevice,
    player_id: g.ePlayer,
    landmark_ref: 'landmark.miradouro-meia-laranja',
    pos: { ...coord('landmark.miradouro-meia-laranja'), accuracy: 5, updated_at: Date.now() },
    photo_url: proof2,
  })
  assert.equal(ok.result, 'decoy')
  console.log('  ✅ events.created_at rebased past the lockout (immutable column reached)')
}

// --- 4. Curse split-brain: started_at (PG) + expires_at (Next) shift together ---
{
  db(`update teams set coins = 900 where game_id='${g.gid}';`)
  await apiPost(`/api/games/${g.gid}/buy-curse`, {
    device_id: g.wDevice,
    player_id: g.wPlayer,
    num_dice: 1,
  })
  const before = clockSnapshot(g.gid)
  assert.ok(before.activeCurses.length >= 1, 'a curse should be active')
  const c0 = before.activeCurses[0]

  if (c0.remainingS == null) {
    console.log(`  ⏭  rolled an untimed curse (${c0.ref}); duration invariance not applicable`)
  } else {
    const durBefore = c0.ageS + c0.remainingS
    advanceClock(g.gid, 120)
    const after = clockSnapshot(g.gid)
    const c1 = after.activeCurses.find((c) => c.ref === c0.ref)
    assert.ok(c1, `curse ${c0.ref} should still exist`)
    const durAfter = c1.ageS + c1.remainingS
    // The invariant that matters: total duration is preserved, age advanced.
    assert.ok(
      Math.abs(durAfter - durBefore) <= 2,
      `curse duration must survive rebase: ${durBefore}s -> ${durAfter}s`,
    )
    assert.ok(
      c1.ageS >= c0.ageS + 118,
      `curse age must advance ~120s: ${c0.ageS} -> ${c1.ageS}`,
    )
    console.log(
      `  ✅ curse ${c0.ref}: age ${c0.ageS}s->${c1.ageS}s, duration ${durBefore}s->${durAfter}s (preserved)`,
    )
  }

  // And expiry must actually fire through the production lifecycle.
  advanceClockMinutes(g.gid, 45)
  await apiPost(`/api/games/${g.gid}/expire-curses`, { device_id: g.wDevice })
  const remaining = Number(db(`select count(*) from active_curses where game_id='${g.gid}';`)[0])
  assert.equal(remaining, 0, 'all curses should have expired after +45min')
  console.log('  ✅ curse expiry fires via /expire-curses after rebase (0049 authority)')
}

// --- 5. Camping: unreachable by clock move, reachable by direct write (0031:82) ---
{
  campingSet(g.gid, g.wPlayer, g.wTeam, { insideZone: true, insideSeconds: 118, locked: false })
  const seeded = campingGet(g.wPlayer)
  assert.equal(seeded.insideSeconds, 118)
  assert.equal(seeded.locked, false)

  // One real heartbeat inside the zone should now cross the 120 s lock.
  const own = coord('landmark.miradouro-vila-velha')
  await apiPost(`/api/games/${g.gid}/camping-heartbeat`, {
    device_id: g.wDevice,
    player_id: g.wPlayer,
    pos: { ...own, accuracy: 5, updated_at: Date.now() },
  })
  const locked = campingGet(g.wPlayer)
  assert.equal(locked.locked, true, `expected camping lock, got ${JSON.stringify(locked)}`)
  console.log(`  ✅ camping lock reached via seeded accumulator + 1 real heartbeat (${locked.insideSeconds}s)`)
}

// --- 6. Game timeout: 180 min (0045:153 + 0030:50 game_expired) ---
{
  const early = await fetch(
    `${process.env.SIM_BASE || 'http://localhost:3001'}/api/games/${g.gid}/end-by-timeout`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device_id: g.wDevice }) },
  )
  assert.equal(early.status, 409, 'timeout before deadline must 409')
  assert.equal((await early.json()).error, 'not_yet_expired')
  console.log('  ✅ end-by-timeout 409s before the 180-min deadline')

  advanceClockMinutes(g.gid, 190)
  const fin = await apiPost(`/api/games/${g.gid}/end-by-timeout`, { device_id: g.wDevice })
  assert.equal(db(`select status from games where id='${g.gid}';`)[0], 'finished')
  assert.ok(fin.winner_team_id != null || fin.reason, `expected a resolution, got ${JSON.stringify(fin)}`)
  console.log(`  ✅ 180-min timeout fires after rebase → finished (reason=${fin.reason})`)
}

// --- 7. Trigger is re-armed: production append-only guard still intact ---
{
  let raised = null
  try {
    db(`update events set created_at = now() where game_id='${g.gid}';`)
  } catch (e) {
    raised = String(e.message || e)
  }
  assert.ok(
    raised && /immutable/.test(raised),
    `append-only guard must be re-armed after rebase, got: ${raised}`,
  )
  console.log('  ✅ events append-only trigger re-armed (session_replication_role reset)')
}

// --- 7. Frozen violation buckets survive a rebase (regression: PK collision) ---
{
  // frozen_violation_seconds has a non-deferrable PK on (curse_id, second_at).
  // Shifting a contiguous block of 1-second rows backward by a delta smaller
  // than the block's own span collided with itself mid-statement and aborted the
  // whole rebase. The formula only reads count(*) (0027:143), so advanceClock
  // preserves the count and re-parks the buckets sparsely.
  const g2 = await setupLiveGame(`${tag}-frozen`)
  db(`update teams set coins = 900 where game_id='${g2.gid}';`)
  const curseId = db(
    `insert into active_curses (game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${g2.gid}','${g2.eTeam}','curse.frozen', now(), now()+interval '8 minutes', '{"max_drift_m":10}'::jsonb) returning id;`,
  )[0]
  // 40 contiguous 1-second buckets, then shift by only 10 s — the colliding case.
  db(
    `insert into frozen_violation_seconds (curse_id, second_at) select '${curseId}', date_trunc('second', now()) + make_interval(secs => n) from generate_series(0,39) n;`,
  )
  const before = Number(
    db(`select count(*) from frozen_violation_seconds where curse_id='${curseId}';`)[0],
  )
  assert.equal(before, 40, `expected 40 buckets, got ${before}`)

  advanceClock(g2.gid, 10) // delta smaller than the 40 s block span
  const after = Number(
    db(`select count(*) from frozen_violation_seconds where curse_id='${curseId}';`)[0],
  )
  assert.equal(after, 40, `bucket count must survive the rebase: ${before} -> ${after}`)
  const distinct = Number(
    db(`select count(distinct second_at) from frozen_violation_seconds where curse_id='${curseId}';`)[0],
  )
  assert.equal(distinct, 40, `buckets must stay distinct, got ${distinct}`)
  console.log(
    `  ✅ 40 contiguous frozen buckets survive a 10 s rebase (no PK collision, count + distinctness preserved)`,
  )
}

console.log('\nAll clock self-tests passed.')
