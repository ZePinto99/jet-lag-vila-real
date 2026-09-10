// Durable camping matrix: browser reload, direct route/RPC bypass attempts,
// weather-pause clock freeze, 60 s outside cooldown, and post-cooldown tag.

import { strict as assert } from 'node:assert'
import {
  BASE,
  coord,
  db,
  launchBrowser,
  makeClient,
  makeGameN,
  sleep,
} from './harness.mjs'

console.log('\n===== DURABLE CAMPING =====')
const g = await makeGameN(2, 2, `camping-${Date.now()}`)
const browser = await launchBrowser()
const ownCandidate = coord('landmark.miradouro-vila-velha')
// About 89 m from the candidate: outside the camping circle but still inside
// the 200 m West defense union, so Tag remains otherwise legal.
const outsideCamping = { lat: ownCandidate.lat + 0.0008, lng: ownCandidate.lng }

async function rawPost(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

function position(point, updatedAt = Date.now()) {
  return { ...point, accuracy: 8, updated_at: updatedAt }
}

function heartbeat(point, overrides = {}) {
  return rawPost(`/api/games/${g.gid}/camping-heartbeat`, {
    device_id: g.west[0].device,
    player_id: g.west[0].player,
    pos: position(point),
    ...overrides,
  })
}

async function pauseVote(action) {
  await rawPost(`/api/games/${g.gid}/pause`, {
    device_id: g.west[0].device,
    player_id: g.west[0].player,
    action,
  })
  return rawPost(`/api/games/${g.gid}/pause`, {
    device_id: g.east[0].device,
    player_id: g.east[0].player,
    action,
  })
}

function gameSecondMinus(seconds) {
  return `(select greatest(0, floor(extract(epoch from (now()-started_at)))::bigint-${seconds}) from games where id='${g.gid}')`
}

try {
  const west = await makeClient(browser, {
    deviceId: g.west[0].device,
    ...ownCandidate,
  })
  await west.goto(`/game/${g.code}`)
  await west.page.waitForSelector('.leaflet-container', { timeout: 20_000 })
  await west.enableGps()

  const stateDeadline = Date.now() + 10_000
  while (
    Date.now() < stateDeadline &&
    db(`select count(*) from player_camping_state where player_id='${g.west[0].player}';`)[0] !== '1'
  ) await sleep(250)
  assert.equal(
    db(`select count(*) from player_camping_state where player_id='${g.west[0].player}';`)[0],
    '1',
    'browser heartbeat should create durable derived camping state',
  )
  const campingColumns = db(
    `select column_name from information_schema.columns where table_schema='public' and table_name='player_camping_state' and column_name in ('lat','lng','accuracy','position');`,
  )
  assert.equal(campingColumns.length, 0, 'durable ledger must not persist GPS coordinates')

  const stale = await heartbeat(ownCandidate, {
    pos: position(ownCandidate, Date.now() - 31_000),
  })
  assert.equal(stale.status, 409)
  assert.equal(stale.body.error, 'stale_position')
  const forged = await heartbeat(ownCandidate, { device_id: 'wrong-device' })
  assert.equal(forged.status, 403)
  assert.equal(forged.body.error, 'forbidden')
  console.log('  ✅ heartbeat accepts only fresh GPS for the matching device/player and stores no coordinates')

  // Engage a persisted lock, observe it in the browser, then reload the whole
  // page. The first new heartbeat must hydrate the same lock, not start at 0.
  db(`update player_camping_state set inside_zone=true, accumulated_inside_seconds=120, accumulated_outside_seconds=0, locked=true, last_game_second=${gameSecondMinus(0)}, last_heartbeat_at=now() where player_id='${g.west[0].player}';`)
  await west.page.getByText(/Camping locked/i).waitFor({ timeout: 8_000 })
  await west.page.reload({ waitUntil: 'domcontentloaded' })
  await west.page.waitForSelector('.leaflet-container', { timeout: 20_000 })
  await west.enableGps()
  await west.page.getByText(/Camping locked/i).waitFor({ timeout: 8_000 })
  console.log('  ✅ 120-second camping lock survives a full browser reload')

  const lockedTagPos = position(ownCandidate)
  const lockedTag = await rawPost(`/api/games/${g.gid}/tag`, {
    device_id: g.west[0].device,
    tagger_player_id: g.west[0].player,
    tagger_pos: lockedTagPos,
    targets: [{ player_id: g.east[0].player, pos: lockedTagPos }],
  })
  assert.equal(lockedTag.status, 409)
  assert.equal(lockedTag.body.error, 'camping_locked')
  assert.equal(
    db(`select respawning from players where id='${g.east[0].player}';`)[0],
    'f',
    'locked direct route call must not mutate target',
  )

  db(`update player_camping_state set locked=false, inside_zone=false, accumulated_inside_seconds=0, accumulated_outside_seconds=0, last_heartbeat_at=now()-interval '30 seconds' where player_id='${g.west[0].player}';`)
  const staleHeartbeatAt = db(`select last_heartbeat_at::text from player_camping_state where player_id='${g.west[0].player}';`)[0]
  const staleRpc = JSON.parse(db(
    `select apply_tags_atomic('${g.gid}',array['${g.east[0].player}'::uuid],'${g.west[0].player}',${ownCandidate.lat},${ownCandidate.lng},'landmark.se-catedral','${staleHeartbeatAt}'::timestamptz)::text;`,
  )[0])
  assert.equal(staleRpc.error, 'camping_state_stale')
  assert.equal(db(`select respawning from players where id='${g.east[0].player}';`)[0], 'f')

  await heartbeat(ownCandidate)
  const firstHeartbeatAt = db(`select last_heartbeat_at::text from player_camping_state where player_id='${g.west[0].player}';`)[0]
  await sleep(25)
  await heartbeat(ownCandidate)
  const replacedStateRpc = JSON.parse(db(
    `select apply_tags_atomic('${g.gid}',array['${g.east[0].player}'::uuid],'${g.west[0].player}',${ownCandidate.lat},${ownCandidate.lng},'landmark.se-catedral','${firstHeartbeatAt}'::timestamptz)::text;`,
  )[0])
  assert.equal(replacedStateRpc.error, 'camping_state_changed')
  assert.equal(db(`select respawning from players where id='${g.east[0].player}';`)[0], 'f')
  console.log('  ✅ route/RPC bypasses cannot use locked, stale, or replaced camping state')

  // Freeze a near-warning counter across a real pause interval.
  await heartbeat(ownCandidate)
  db(`update player_camping_state set inside_zone=true, accumulated_inside_seconds=100, accumulated_outside_seconds=0, locked=false, last_game_second=${gameSecondMinus(0)}, last_heartbeat_at=now() where player_id='${g.west[0].player}';`)
  const paused = await pauseVote('pause')
  assert.equal(paused.status, 200)
  assert.equal(db(`select status from games where id='${g.gid}';`)[0], 'paused')
  const beforePauseSeconds = db(`select accumulated_inside_seconds from player_camping_state where player_id='${g.west[0].player}';`)[0]
  await sleep(2_500)
  const pausedHeartbeat = await heartbeat(ownCandidate)
  assert.equal(pausedHeartbeat.status, 200)
  assert.equal(
    db(`select accumulated_inside_seconds from player_camping_state where player_id='${g.west[0].player}';`)[0],
    beforePauseSeconds,
    'paused heartbeat must not accrue camping seconds',
  )
  const resumed = await pauseVote('resume')
  assert.equal(resumed.status, 200)
  assert.equal(db(`select status from games where id='${g.gid}';`)[0], 'live')
  console.log('  ✅ weather pause freezes the authoritative camping game clock')

  // Start the outside transition, then place the authoritative cooldown at
  // 59 s and let one observed gameplay second finish it.
  db(`update player_camping_state set inside_zone=true, accumulated_inside_seconds=120, accumulated_outside_seconds=0, locked=true, last_game_second=${gameSecondMinus(0)}, last_heartbeat_at=now() where player_id='${g.west[0].player}';`)
  await west.setPos(outsideCamping.lat, outsideCamping.lng)
  await heartbeat(outsideCamping)
  db(`update player_camping_state set inside_zone=false, accumulated_inside_seconds=120, accumulated_outside_seconds=59, locked=true, last_game_second=${gameSecondMinus(2)}, last_heartbeat_at=now() where player_id='${g.west[0].player}';`)
  await sleep(1_100)
  const cooled = await heartbeat(outsideCamping)
  assert.equal(cooled.status, 200)
  assert.equal(cooled.body.locked, false)
  assert.equal(cooled.body.seconds_in_zone, 0)
  await west.page.getByText(/Camping locked/i).waitFor({ state: 'detached', timeout: 8_000 })

  const legalPos = position(outsideCamping)
  const postCooldownTag = await rawPost(`/api/games/${g.gid}/tag`, {
    device_id: g.west[0].device,
    tagger_player_id: g.west[0].player,
    tagger_pos: legalPos,
    targets: [{ player_id: g.east[0].player, pos: legalPos }],
  })
  assert.equal(postCooldownTag.status, 200)
  assert.deepEqual(postCooldownTag.body.tagged_player_ids, [g.east[0].player])
  assert.equal(db(`select respawning from players where id='${g.east[0].player}';`)[0], 't')
  console.log('  ✅ 60 observed outside seconds clears the lock and Tag succeeds inside the 200 m defense zone')

  west.assertNoUnexpectedErrors()
} finally {
  await browser.close()
}

console.log('5/5 durable camping checks passed')
