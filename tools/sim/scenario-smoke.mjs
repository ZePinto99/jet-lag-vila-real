// Smoke test: bring up a live game, load one client at the UTAD library,
// enable GPS, and screenshot the live map. Validates the harness end-to-end.

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

const g = await setupLiveGame()
console.log(`game ${g.code} live (gid ${g.gid})`)

const browser = await launchBrowser()
const lib = coord('landmark.utad-main-library')
const west = await makeClient(browser, { deviceId: g.wDevice, lat: lib.lat, lng: lib.lng })
await west.goto(`/game/${g.code}`)

// Wait for the live view (map tab is default) + GPS button, enable GPS.
await west.page.waitForSelector('.leaflet-container', { timeout: 20000 })
await west.enableGps()
await sleep(4000) // let GPS fix + presence publish + tiles attempt

const stars = await west.page.locator('.challenge-star').count()
const zones = await west.page.locator('.leaflet-interactive').count()
console.log(`challenge stars on map: ${stars}`)
console.log(`leaflet vector elements (zones/markers): ${zones}`)

const shot = await west.shot('smoke-west-map.png')
console.log(`screenshot: ${shot}`)

console.log(stars > 0 ? '✅ challenge stars rendered' : '⚠️ no challenge stars')

await browser.close()
console.log('done')
