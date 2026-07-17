// A1 join team-select visible state; A2-A4 map-first flag setup (tap a point to
// cycle role, color-coded, name labels, Map/List toggle with list fallback).

import { mkdirSync } from 'node:fs'
import { launchBrowser, makeClient, apiPost, BASE, SHOTS, sleep } from './harness.mjs'

mkdirSync(SHOTS, { recursive: true })

// Bring a game only to the SETUP phase (create -> join -> ready -> start).
async function setupPhaseGame() {
  const tag = String(Date.now())
  const wDevice = `sim-w-${tag}`
  const eDevice = `sim-e-${tag}`
  const c = await apiPost('/api/games', { display_name: 'West', device_id: wDevice, preferred_side: 'west' })
  const gid = c.game.id, code = c.game.code, wPlayer = c.me.id
  const j = await apiPost(`/api/games/${gid}/join`, { display_name: 'East', device_id: eDevice, preferred_side: 'east' })
  const ePlayer = j.player?.id ?? j.me?.id ?? j.id
  await apiPost(`/api/games/${gid}/ready`, { player_id: wPlayer, device_id: wDevice, ready: true })
  await apiPost(`/api/games/${gid}/ready`, { player_id: ePlayer, device_id: eDevice, ready: true })
  await apiPost(`/api/games/${gid}/start`, { device_id: wDevice })
  return { gid, code, wDevice }
}

const browser = await launchBrowser()

// ---- A1: join screen selected state ----
const joiner = await makeClient(browser, { deviceId: 'sim-join', lat: 41.3, lng: -7.74 })
await joiner.goto('/game/join')
await joiner.page.waitForSelector('text=Preferred side', { timeout: 15000 })
await joiner.shot('join-default.png')
await joiner.page.getByText('East (Biblioteca)').click()
await sleep(400)
await joiner.shot('join-east-selected.png')
console.log('  ✅ A1 join screenshots captured (default + East selected)')

// ---- A2-A4: setup map ----
const g = await setupPhaseGame()
console.log(`setup-phase game ${g.code}`)
const west = await makeClient(browser, { deviceId: g.wDevice, lat: 41.286, lng: -7.74 })
await west.goto(`/game/${g.code}`)
await west.page.waitForSelector('.leaflet-container', { timeout: 20000 })
await sleep(1500)

const hasMapTab = await west.page.getByRole('button', { name: /^Map$/ }).count()
const hasListTab = await west.page.getByRole('button', { name: /^List$/ }).count()
const labels = await west.page.locator('.leaflet-tooltip').count()
console.log(`  Map/List toggle: map=${hasMapTab} list=${hasListTab}; permanent labels on map=${labels}`)
await west.shot('setup-map-default.png')

// A3: tap pool markers to assign roles. Click each interactive marker once.
const markers = west.page.locator('path.leaflet-interactive')
const n = await markers.count()
let clicks = 0
for (let i = 0; i < n && clicks < 6; i++) {
  try {
    await markers.nth(i).click({ timeout: 1500, force: true })
    clicks++
    await sleep(250)
  } catch {}
}
await sleep(500)
const roleBadges = await west.page.locator('.leaflet-tooltip').filter({ hasText: /real|decoy|empty/i }).count()
await west.shot('setup-map-assigned.png')
console.log(
  hasMapTab && hasListTab && labels > 0
    ? `  ✅ A2/A4: Map+List toggle & name labels present`
    : `  ⚠️ toggle/labels check (map=${hasMapTab} list=${hasListTab} labels=${labels})`,
)
console.log(
  roleBadges > 0
    ? `  ✅ A3: tapping map points assigned roles (${roleBadges} role badge(s) visible)`
    : `  ⚠️ A3: no role badges detected after ${clicks} marker clicks`,
)

// List fallback still works.
if (hasListTab) {
  await west.page.getByRole('button', { name: /^List$/ }).click()
  await sleep(600)
  await west.shot('setup-list.png')
  console.log('  ✅ list fallback view captured')
}

await browser.close()
console.log('done')
