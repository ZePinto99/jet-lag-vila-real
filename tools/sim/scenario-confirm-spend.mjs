// G21 confirm-spend: buying intel opens a modal with item/cost/balance and
// requires explicit confirmation; confirming spends the coins.

import { mkdirSync } from 'node:fs'
import { strict as assert } from 'node:assert'
import { launchBrowser, makeClient, setupLiveGame, apiGet, coord, SHOTS, sleep } from './harness.mjs'

mkdirSync(SHOTS, { recursive: true })

const g = await setupLiveGame()
console.log(`game ${g.code} live`)
const browser = await launchBrowser()
try {
  const lib = coord('landmark.miradouro-vila-velha')
  const west = await makeClient(browser, { deviceId: g.wDevice, lat: lib.lat, lng: lib.lng })
  await west.goto(`/game/${g.code}`)
  await west.page.waitForSelector('.leaflet-container', { timeout: 20000 })
  await west.tab('Actions')
  await sleep(1500)

  const westTeamBefore = (await apiGet(`/api/games/by-code/${g.code}`)).teams.find((t) => t.side === 'west')
  assert.ok(westTeamBefore, 'West team snapshot must exist')
  const coinsBefore = westTeamBefore.coins
  console.log(`coins before: ${coinsBefore}`)

  // Click the first enabled "Buy" (North/South = 30, no GPS needed).
  await west.page.getByRole('button', { name: /^Buy$/i }).first().click()
  const dialog = west.page.getByRole('dialog', { name: /Confirm purchase/i })
  await dialog.waitFor()
  await dialog.getByText(/Balance after/i).waitFor()
  assert.equal(
    await dialog.getByRole('button', { name: /^Cancel$/i }).evaluate((button) => button === document.activeElement),
    true,
  )
  await west.shot('spend-modal.png')
  console.log('  ✅ confirm-spend modal shows balance impact and starts on the safe action')

  await dialog.getByRole('button', { name: /Confirm & spend/i }).click()
  await dialog.waitFor({ state: 'detached', timeout: 10000 })
  const westTeamAfter = (await apiGet(`/api/games/by-code/${g.code}`)).teams.find((t) => t.side === 'west')
  assert.ok(westTeamAfter, 'West team must still exist after purchase')
  const coinsAfter = westTeamAfter.coins
  assert.equal(coinsAfter, coinsBefore - 30, 'North/South intel confirmation must spend exactly 30 coins')
  await west.tab('Actions')
  await west.shot('spend-after.png')
  console.log(`  ✅ spend confirmed: coins ${coinsBefore} -> ${coinsAfter}`)

  // Cancel path must close the modal and leave the persisted balance untouched.
  await west.page.getByRole('button', { name: /^Buy$/i }).first().click()
  const cancelDialog = west.page.getByRole('dialog', { name: /Confirm purchase/i })
  await cancelDialog.getByRole('button', { name: /^Cancel$/i }).click()
  await cancelDialog.waitFor({ state: 'detached' })
  const coinsAfterCancel = (await apiGet(`/api/games/by-code/${g.code}`)).teams.find((t) => t.side === 'west')?.coins
  assert.equal(coinsAfterCancel, coinsAfter, 'cancel must not spend coins')
  west.assertNoUnexpectedErrors()
  console.log('  ✅ cancel closes the modal without spending')
} finally {
  await browser.close()
}
console.log('done')
