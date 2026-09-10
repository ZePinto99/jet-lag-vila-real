// Strict two-client weather pause/resume UI journey. Proves two-key voting,
// paused routing/action locks, observer clock freeze, and authoritative timer
// shifting on resume.

import { strict as assert } from 'node:assert'
import { mkdirSync } from 'node:fs'
import { SHOTS, coord, db, launchBrowser, makeClient, makeGameN, sleep } from './harness.mjs'

mkdirSync(SHOTS, { recursive: true })
console.log('\n===== STRICT WEATHER PAUSE =====')

const g = await makeGameN(2, 2, `weather-${Date.now()}`)
const curseId = db(
  `insert into active_curses(game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${g.gid}','${g.wTeam}','curse.buddy-up',now(),now()+interval '15 minutes','{"max_pairwise_distance_m":10}'::jsonb) returning id;`,
)[0]
const browser = await launchBrowser()

function epoch(sql) {
  return Number(db(sql)[0])
}

try {
  const westPos = coord('landmark.miradouro-vila-velha')
  const eastPos = coord('landmark.biblioteca-municipal')
  const west = await makeClient(browser, { deviceId: g.west[0].device, ...westPos })
  const east = await makeClient(browser, { deviceId: g.east[0].device, ...eastPos })
  const observer = await makeClient(browser, {
    deviceId: `observer-${Date.now()}`,
    lat: 41.295,
    lng: -7.746,
  })
  await west.goto(`/game/${g.code}`)
  await east.goto(`/game/${g.code}`)
  await observer.goto(`/observer/${g.code}`)
  await west.page.waitForSelector('.leaflet-container', { timeout: 20000 })
  await east.page.waitForSelector('.leaflet-container', { timeout: 20000 })
  await observer.page.getByText('Spectator').waitFor({ timeout: 20000 })

  const startedBefore = epoch(`select extract(epoch from started_at)::int from games where id='${g.gid}';`)
  const curseStartedBefore = epoch(`select extract(epoch from started_at)::int from active_curses where id='${curseId}';`)
  const curseExpiresBefore = epoch(`select extract(epoch from expires_at)::int from active_curses where id='${curseId}';`)

  await west.page.getByRole('button', { name: 'Open settings' }).click()
  await west.page.getByRole('button', { name: 'Request weather pause' }).click()
  const requested = west.page.getByRole('button', { name: 'Pause requested' })
  await requested.waitFor({ timeout: 10000 })
  assert.equal(await requested.isDisabled(), true, 'requesting team cannot self-confirm')
  await west.page.getByRole('button', { name: 'Close' }).click()
  const confirmPause = east.page.getByRole('button', { name: 'Confirm weather pause' })
  await confirmPause.waitFor({ timeout: 10000 })
  await confirmPause.click()

  await west.page.getByText('Weather pause — Paused').waitFor({ timeout: 10000 })
  await east.page.getByText('Weather pause — Paused').waitFor({ timeout: 10000 })
  await observer.page.getByText('Paused', { exact: true }).waitFor({ timeout: 10000 })
  assert.equal(db(`select status from games where id='${g.gid}';`)[0], 'paused')
  assert.equal(epoch(`select extract(epoch from started_at)::int from games where id='${g.gid}';`), startedBefore)

  await west.tab('Chat')
  await west.page.getByRole('alert').filter({ hasText: /all gameplay actions are locked/i }).first().waitFor()
  assert.equal(await west.page.getByRole('textbox', { name: 'Message…' }).isDisabled(), true)

  const observerClock = observer.page.locator('header span.font-mono.tabular-nums')
  const frozenClock = await observerClock.innerText()
  await sleep(3000)
  assert.equal(await observerClock.innerText(), frozenClock, 'observer countdown must freeze while paused')
  assert.equal(epoch(`select extract(epoch from expires_at)::int from active_curses where id='${curseId}';`), curseExpiresBefore)
  await observer.shot('strict-weather-paused-observer.png')
  await west.shot('strict-weather-paused-player.png')
  console.log('  ✅ two-team confirmation pauses the game, locks actions, and freezes observer/curse clocks')

  await west.page.getByRole('button', { name: 'Open settings' }).click()
  await west.page.getByRole('button', { name: 'Request resume' }).click()
  await west.page.getByRole('button', { name: 'Close' }).click()
  const confirmResume = east.page.getByRole('button', { name: 'Confirm resume' })
  await confirmResume.waitFor({ timeout: 10000 })
  await confirmResume.click()
  await west.page.getByRole('button', { name: 'Open settings' }).click()
  await west.page.getByRole('button', { name: 'Request weather pause' }).waitFor({ timeout: 10000 })
  await west.page.getByRole('button', { name: 'Close' }).click()
  await observer.page.getByText('Live', { exact: true }).waitFor({ timeout: 10000 })

  const pauseSeconds = epoch(
    `select (payload->>'pause_seconds')::int from events where game_id='${g.gid}' and type='game_resumed' order by created_at desc limit 1;`,
  )
  assert.ok(pauseSeconds >= 3, `pause should persist a real duration, got ${pauseSeconds}s`)
  assert.equal(
    epoch(`select extract(epoch from started_at)::int from games where id='${g.gid}';`) - startedBefore,
    pauseSeconds,
  )
  assert.equal(
    epoch(`select extract(epoch from started_at)::int from active_curses where id='${curseId}';`) - curseStartedBefore,
    pauseSeconds,
  )
  assert.equal(
    epoch(`select extract(epoch from expires_at)::int from active_curses where id='${curseId}';`) - curseExpiresBefore,
    pauseSeconds,
  )
  assert.equal(db(`select count(*) from events where game_id='${g.gid}' and type='game_paused';`)[0], '1')
  assert.equal(db(`select count(*) from events where game_id='${g.gid}' and type='game_resumed';`)[0], '1')

  const resumedClock = await observerClock.innerText()
  await sleep(2200)
  assert.notEqual(await observerClock.innerText(), resumedClock, 'observer countdown must continue after resume')
  west.assertNoUnexpectedErrors()
  east.assertNoUnexpectedErrors()
  observer.assertNoUnexpectedErrors()
  console.log(`  ✅ two-team resume shifts match + curse timers by the same ${pauseSeconds}s and clock continues`)
} finally {
  db(`delete from active_curses where game_id='${g.gid}';`)
  await browser.close()
}

console.log('2/2 strict checks passed')
