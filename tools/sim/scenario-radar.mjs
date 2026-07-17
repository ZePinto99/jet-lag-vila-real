// C11 enemy radar: an east raider standing inside WEST's defense zone should
// appear on the WEST client's map — but only pulsed (radar blip), and NOT on
// the EAST client's map (west player is outside EAST's zones → zone-gating).

import { mkdirSync } from 'node:fs'
import {
  launchBrowser,
  makeClient,
  setupLiveGame,
  coord,
  SHOTS,
  sleep,
} from './harness.mjs'

mkdirSync(SHOTS, { recursive: true })

async function maxBlips(page, ms) {
  let max = 0
  const end = Date.now() + ms
  while (Date.now() < end) {
    max = Math.max(max, await page.locator('.radar-blip').count())
    await sleep(700)
  }
  return max
}

const g = await setupLiveGame()
console.log(`game ${g.code} live`)

const browser = await launchBrowser()
const lib = coord('landmark.utad-main-library') // a WEST candidate

// West defender AT the library (inside own zone). East raider ~20 m away —
// inside west's 200 m defense zone, far outside any east zone.
const west = await makeClient(browser, { deviceId: g.wDevice, lat: lib.lat, lng: lib.lng })
const east = await makeClient(browser, { deviceId: g.eDevice, lat: lib.lat + 0.0002, lng: lib.lng })

await west.goto(`/game/${g.code}`)
await east.goto(`/game/${g.code}`)
await west.page.waitForSelector('.leaflet-container', { timeout: 20000 })
await east.page.waitForSelector('.leaflet-container', { timeout: 20000 })
await west.enableGps()
await east.enableGps()
console.log('both GPS on; waiting for presence sync…')
await sleep(6000)

// WEST should see the east raider pulse. Catch an ON window.
console.log('waiting for radar blip on WEST…')
let westSaw = false
try {
  await west.page.waitForSelector('.radar-blip', { timeout: 22000, state: 'attached' })
  westSaw = true
  await west.shot('radar-west-ON.png')
  console.log('  ✅ WEST sees a radar blip (captured during ON window)')
} catch {
  console.log('  ❌ WEST never showed a radar blip')
  await west.shot('radar-west-noblip.png')
}

// Capture an OFF window on WEST to demonstrate the pulse.
if (westSaw) {
  try {
    await west.page.waitForSelector('.radar-blip', { timeout: 22000, state: 'detached' })
    await west.shot('radar-west-OFF.png')
    console.log('  ✅ blip disappears between pulses (radar OFF window captured)')
  } catch {
    console.log('  ⚠️ blip did not clear within a cycle')
  }
}

// EAST should NEVER see the west player (outside east zones). Poll a full cycle.
console.log('checking EAST sees no enemy (zone-gating)…')
const eastMax = await maxBlips(east.page, 22000)
await east.shot('radar-east-none.png')
console.log(
  eastMax === 0
    ? '  ✅ EAST shows no radar blip (west player is outside east zones)'
    : `  ❌ EAST showed ${eastMax} blip(s) — zone-gating leak`,
)

await browser.close()
console.log('done')
