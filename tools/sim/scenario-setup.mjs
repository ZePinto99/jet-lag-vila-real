// A1 join team-select visible state; A2-A4 map-first flag setup (focused own
// pool, numbered markers, explicit role picker, Map/List fallback).

import { mkdirSync } from 'node:fs'
import { strict as assert } from 'node:assert'
import { launchBrowser, makeClient, apiPost, BASE, SHOTS, sleep } from './harness.mjs'

mkdirSync(SHOTS, { recursive: true })

// Bring a game only to the SETUP phase (create -> join -> ready -> start).
async function setupPhaseGame() {
  const tag = String(Date.now())
  const wDevice = `sim-w-${tag}`
  const eDevice = `sim-e-${tag}`
  const c = await apiPost('/api/games', { display_name: 'West', device_id: wDevice, preferred_side: 'west' })
  const gid = c.game.id, code = c.game.code, wPlayer = c.me.id
  const w2Device = `sim-w2-${tag}`
  const w2 = await apiPost(`/api/games/${gid}/join`, { display_name: 'West 2', device_id: w2Device, preferred_side: 'west' })
  const w2Player = w2.player?.id ?? w2.me?.id ?? w2.id
  const j = await apiPost(`/api/games/${gid}/join`, { display_name: 'East', device_id: eDevice, preferred_side: 'east' })
  const ePlayer = j.player?.id ?? j.me?.id ?? j.id
  const e2Device = `sim-e2-${tag}`
  const e2 = await apiPost(`/api/games/${gid}/join`, { display_name: 'East 2', device_id: e2Device, preferred_side: 'east' })
  const e2Player = e2.player?.id ?? e2.me?.id ?? e2.id
  for (const p of [
    { player: wPlayer, device: wDevice },
    { player: w2Player, device: w2Device },
    { player: ePlayer, device: eDevice },
    { player: e2Player, device: e2Device },
  ]) {
    await apiPost(`/api/games/${gid}/ready`, { player_id: p.player, device_id: p.device, ready: true })
  }
  await apiPost(`/api/games/${gid}/start`, { device_id: wDevice })
  return { gid, code, wDevice }
}

const browser = await launchBrowser()
try {
  // ---- A1: join screen selected state ----
  const joiner = await makeClient(browser, { deviceId: 'sim-join', lat: 41.3, lng: -7.74 })
  await joiner.goto('/game/join')
  await joiner.page.waitForSelector('text=Preferred side', { timeout: 15000 })
  const westRadio = joiner.page.getByRole('radio', { name: 'West (Vila Velha)' })
  const eastRadio = joiner.page.getByRole('radio', { name: 'East (Biblioteca)' })
  assert.equal(await westRadio.isChecked(), true, 'West should be selected by default')
  await joiner.shot('join-default.png')
  await joiner.page.getByText('East (Biblioteca)').click()
  assert.equal(await eastRadio.isChecked(), true, 'East selection must update the native radio state')
  await joiner.shot('join-east-selected.png')
  console.log('  ✅ A1 join selector exposes its selected team to UI and accessibility APIs')

  // ---- A2-A4: setup map ----
  const g = await setupPhaseGame()
  console.log(`setup-phase game ${g.code}`)
  const west = await makeClient(browser, { deviceId: g.wDevice, lat: 41.286, lng: -7.74 })
  await west.goto(`/game/${g.code}`)
  await west.page.waitForSelector('.leaflet-container', { timeout: 20000 })
  await sleep(1500)

  const mapTab = west.page.getByRole('button', { name: /^Map$/ })
  const listTab = west.page.getByRole('button', { name: /^List$/ })
  assert.equal(await mapTab.count(), 1, 'setup should expose one Map tab')
  assert.equal(await listTab.count(), 1, 'setup should expose one List tab')
  assert.equal(await mapTab.getAttribute('aria-pressed'), 'true', 'Map must be the primary default view')
  const labels = await west.page.locator('.setup-map-index').count()
  assert.equal(labels, 7, 'setup map should show one compact number per West candidate')
  await west.shot('setup-map-default.png')
  console.log(`  ✅ A2/A4 Map+List controls and ${labels} uncluttered markers are present`)

  // A3: select a marker, then choose an explicit role in the panel below.
  const markers = west.page.locator('path.leaflet-interactive')
  const n = await markers.count()
  assert.equal(n, 7, 'only the seven West candidates should be interactive')
  await markers.nth(0).click({ timeout: 1500, force: true })
  const picker = west.page.getByTestId('setup-map-role-picker')
  await picker.waitFor()
  await picker
    .getByRole('group', { name: 'Choose this landmark’s role:' })
    .getByRole('button', { name: 'Real' })
    .click()
  await west.page.getByText('1 of 5 assigned').waitFor()
  assert.ok(
    (await picker.getByText('Real', { exact: true }).count()) >= 1,
    'selected landmark should display its assigned role',
  )
  await west.shot('setup-map-assigned.png')
  console.log('  ✅ A3 marker selection + explicit role assignment stay in sync')

  // List fallback still works and reflects the same role state.
  await west.page.getByRole('button', { name: /^List$/ }).click()
  await west.page.getByRole('heading', { name: 'Your candidate pool' }).waitFor()
  assert.equal(await listTab.getAttribute('aria-pressed'), 'true')
  assert.ok((await west.page.getByRole('button', { pressed: true }).count()) > 0)
  await west.shot('setup-list.png')
  console.log('  ✅ list fallback view captured')
  joiner.assertNoUnexpectedErrors()
  west.assertNoUnexpectedErrors()
} finally {
  await browser.close()
}
console.log('done')
