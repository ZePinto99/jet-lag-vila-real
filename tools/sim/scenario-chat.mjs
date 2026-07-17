// G22 chat: global message delivered live between clients; team channel stays
// private to the sender's team.

import { mkdirSync } from 'node:fs'
import { launchBrowser, makeClient, setupLiveGame, coord, SHOTS, sleep } from './harness.mjs'

mkdirSync(SHOTS, { recursive: true })

const g = await setupLiveGame()
console.log(`game ${g.code} live`)
const browser = await launchBrowser()
const lib = coord('landmark.utad-main-library')
const bib = coord('landmark.biblioteca-municipal')
const west = await makeClient(browser, { deviceId: g.wDevice, lat: lib.lat, lng: lib.lng })
const east = await makeClient(browser, { deviceId: g.eDevice, lat: bib.lat, lng: bib.lng })
await west.goto(`/game/${g.code}`)
await east.goto(`/game/${g.code}`)
await west.page.waitForSelector('.leaflet-container', { timeout: 20000 })
await east.page.waitForSelector('.leaflet-container', { timeout: 20000 })
await west.tab('Chat')
await east.tab('Chat')
await sleep(2500) // channels subscribe

// West sends a GLOBAL message.
await west.page.getByPlaceholder(/Message/i).fill('Hi everyone — West here')
await west.page.getByRole('button', { name: /^Send$/i }).click()

let ok1 = false
try {
  await east.page.getByText('Hi everyone — West here').first().waitFor({ state: 'visible', timeout: 6000 })
  ok1 = true
  await east.shot('chat-east-got-global.png')
  console.log('  ✅ global message delivered live to EAST')
} catch {
  await east.shot('chat-east-no-global.png')
  console.log('  ❌ global message not received')
}

// West sends a TEAM message (west team channel). East is on a different team
// channel → must NOT receive it.
await west.page.getByRole('button', { name: /My team/i }).click()
await west.page.getByPlaceholder(/Message/i).fill('west team secret plan')
await west.page.getByRole('button', { name: /^Send$/i }).click()
await sleep(3000)
// East checks its own team channel.
await east.page.getByRole('button', { name: /My team/i }).click()
await sleep(1500)
const leaked = await east.page.getByText('west team secret plan').count()
await east.shot('chat-east-team-isolated.png')
console.log(
  leaked === 0
    ? '  ✅ west team message did NOT leak to EAST team channel'
    : '  ❌ team message leaked across teams',
)
await west.shot('chat-west.png')

await browser.close()
console.log('done')
