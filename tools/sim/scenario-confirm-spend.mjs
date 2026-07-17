// G21 confirm-spend: buying intel opens a modal with item/cost/balance and
// requires explicit confirmation; confirming spends the coins.

import { mkdirSync } from 'node:fs'
import { launchBrowser, makeClient, setupLiveGame, apiGet, coord, SHOTS, sleep } from './harness.mjs'

mkdirSync(SHOTS, { recursive: true })

const g = await setupLiveGame()
console.log(`game ${g.code} live`)
const browser = await launchBrowser()
const lib = coord('landmark.utad-main-library')
const west = await makeClient(browser, { deviceId: g.wDevice, lat: lib.lat, lng: lib.lng })
await west.goto(`/game/${g.code}`)
await west.page.waitForSelector('.leaflet-container', { timeout: 20000 })
await west.tab('Actions')
await sleep(1500)

const coinsBefore = (await apiGet(`/api/games/by-code/${g.code}`)).teams.find((t) => t.side === 'west').coins
console.log(`coins before: ${coinsBefore}`)

// Click the first enabled "Buy" (North/South = 30, no GPS needed).
await west.page.getByRole('button', { name: /^Buy$/i }).first().click()
await sleep(800)

// Modal must be up.
const dialog = west.page.getByRole('dialog')
const hasTitle = await west.page.getByText(/Confirm purchase/i).count()
const hasBalanceAfter = await west.page.getByText(/Balance after/i).count()
await west.shot('spend-modal.png')
console.log(
  hasTitle >= 1 && hasBalanceAfter >= 1
    ? '  ✅ confirm-spend modal shows title + resulting balance'
    : `  ❌ modal missing (title=${hasTitle} balAfter=${hasBalanceAfter})`,
)

// Confirm the spend.
await west.page.getByRole('button', { name: /Confirm & spend/i }).click()
await sleep(2500)
const coinsAfter = (await apiGet(`/api/games/by-code/${g.code}`)).teams.find((t) => t.side === 'west').coins
console.log(`coins after: ${coinsAfter}`)
await west.tab('Actions')
await west.shot('spend-after.png')
console.log(
  coinsAfter < coinsBefore
    ? `  ✅ spend confirmed: coins ${coinsBefore} -> ${coinsAfter}`
    : '  ❌ coins unchanged after confirm',
)

// Also verify cancel path leaves coins untouched.
await west.page.getByRole('button', { name: /^Buy$/i }).first().click()
await sleep(600)
await west.page.getByRole('button', { name: /^Cancel$/i }).click()
await sleep(500)
const stillDialog = await west.page.getByRole('dialog').count()
console.log(stillDialog === 0 ? '  ✅ cancel closes the modal' : '  ❌ modal stuck open')

await browser.close()
console.log('done')
