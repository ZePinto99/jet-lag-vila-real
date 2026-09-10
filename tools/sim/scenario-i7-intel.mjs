// Strict browser E2E for I7 surroundings privacy/reveal and the immutable
// purchase-time Hot/Cold bracket. Requires migrations 0014 and 0038.

import { strict as assert } from 'node:assert'
import { mkdirSync } from 'node:fs'
import {
  BASE,
  SHOTS,
  coord,
  db,
  launchBrowser,
  makeClient,
  makeGameN,
  sleep,
} from './harness.mjs'

mkdirSync(SHOTS, { recursive: true })
console.log('\n===== STRICT I7 + HOT/COLD INTEL =====')

const g = await makeGameN(2, 2, `i7-${Date.now()}`)
db(`update teams set coins=500 where game_id='${g.gid}';`)
const eastPhotoPath = db(`select object_path from flag_surroundings where game_id='${g.gid}' and team_id='${g.eTeam}';`)[0]
assert.ok(eastPhotoPath)

// Private means even a caller who knows the path cannot use a public-object
// URL. Only a signed URL created after I7 purchase may read it.
const publicGuess = `${new URL(BASE).protocol}//127.0.0.1:54321/storage/v1/object/public/surroundings-photos/${eastPhotoPath}`
const guessed = await fetch(publicGuess)
assert.notEqual(guessed.status, 200)
console.log('  ✅ setup surroundings object rejects unsigned public reads')

const westHome = coord('landmark.miradouro-vila-velha')
const eastFlag = coord('landmark.biblioteca-municipal')
const browser = await launchBrowser()
const west = await makeClient(browser, {
  deviceId: g.west[0].device,
  lat: westHome.lat,
  lng: westHome.lng,
})

try {
  await west.goto(`/game/${g.code}`)
  await west.page.waitForSelector('.leaflet-container', { timeout: 20000 })
  await west.enableGps()
  await west.tab('Status')
  const harden = west.page.getByRole('button', { name: /Harden flag · 150 coins/i })
  await harden.click()
  let hardenDialog = west.page.getByRole('dialog', { name: 'Confirm purchase' })
  await hardenDialog.getByRole('button', { name: 'Cancel' }).click()
  assert.equal(db(`select count(*) from landmarks where game_id='${g.gid}' and team_id='${g.wTeam}' and hardened=true;`)[0], '0')
  await harden.click()
  hardenDialog = west.page.getByRole('dialog', { name: 'Confirm purchase' })
  await hardenDialog.getByRole('button', { name: 'Confirm & spend' }).click()
  await west.page.getByRole('button', { name: 'Already hardened' }).waitFor({ timeout: 10000 })
  assert.equal(db(`select count(*) from landmarks where game_id='${g.gid}' and team_id='${g.wTeam}' and hardened=true;`)[0], '1')
  console.log('  ✅ hardening cancel spends nothing; confirm spends once and locks the control')

  await west.tab('Actions')

  const surroundingsRow = west.page.locator('li').filter({ hasText: 'Surroundings' }).first()
  await surroundingsRow.getByRole('button', { name: 'Buy' }).click()
  const i7Dialog = west.page.getByRole('dialog', { name: 'Confirm purchase' })
  await i7Dialog.waitFor()
  await i7Dialog.getByRole('button', { name: 'Confirm & spend' }).click()
  await west.page.getByText(/Intel acquired/).waitFor({ timeout: 10000 })
  assert.equal(db(`select count(*) from cards where team_id='${g.wTeam}' and ref='intel.surroundings';`)[0], '1')
  const storedPayload = JSON.parse(db(`select payload::text from cards where team_id='${g.wTeam}' and ref='intel.surroundings';`)[0])
  assert.deepEqual(storedPayload, { intel_ref: 'intel.surroundings' })
  assert.equal('object_path' in storedPayload, false)
  assert.equal('photo_url' in storedPayload, false)
  assert.equal(db(`select count(*) from events where game_id='${g.gid}' and payload::text like '%${eastPhotoPath}%';`)[0], '0')
  console.log('  ✅ I7 persists neither the private path nor signed URL in its card/events')

  await west.tab('Status')
  const photo = west.page.getByRole('img', { name: 'Surroundings near the enemy real flag' })
  await photo.waitFor({ timeout: 10000 })
  await west.page.waitForFunction(
    () => {
      const image = document.querySelector('img[alt="Surroundings near the enemy real flag"]')
      return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
    },
    { timeout: 10000 },
  )
  const signedUrl = await photo.getAttribute('src')
  assert.ok(signedUrl?.includes('/storage/v1/object/sign/surroundings-photos/'))
  await west.shot('strict-i7-photo.png')
  console.log('  ✅ purchased I7 renders the real private image through a signed URL')

  await sleep(1100)
  await west.page.reload({ waitUntil: 'domcontentloaded' })
  await west.page.waitForSelector('.leaflet-container', { timeout: 20000 })
  await west.tab('Status')
  const reloadedPhoto = west.page.getByRole('img', { name: 'Surroundings near the enemy real flag' })
  await reloadedPhoto.waitFor({ timeout: 10000 })
  await west.page.waitForFunction(
    () => {
      const image = document.querySelector('img[alt="Surroundings near the enemy real flag"]')
      return image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0
    },
    { timeout: 10000 },
  )
  const refreshedSignedUrl = await reloadedPhoto.getAttribute('src')
  assert.ok(refreshedSignedUrl?.includes('/storage/v1/object/sign/surroundings-photos/'))
  assert.notEqual(refreshedSignedUrl, signedUrl)
  console.log('  ✅ reload re-signs the durable path and the refreshed private image still loads')

  await west.tab('Map')
  await west.page.waitForSelector('.leaflet-container', { timeout: 15000 })
  await west.enableGps()
  await west.tab('Actions')
  const hotColdRow = west.page.locator('li').filter({ hasText: 'Hot/Cold' }).first()
  await hotColdRow.getByRole('button', { name: 'Buy' }).click()
  const hotDialog = west.page.getByRole('dialog', { name: 'Confirm purchase' })
  await hotDialog.getByRole('button', { name: 'Confirm & spend' }).click()
  await west.page.getByText(/Intel acquired/).waitFor({ timeout: 10000 })
  const hotPayload = JSON.parse(db(`select payload::text from cards where team_id='${g.wTeam}' and ref='intel.hot-cold';`)[0])
  assert.equal('target' in hotPayload, false)
  await west.tab('Status')
  const boughtDistance = west.page.getByText(/Real flag distance when bought:/)
  await boughtDistance.waitFor({ timeout: 10000 })
  const bracketBeforeMove = await boughtDistance.textContent()
  await west.setPos(eastFlag.lat, eastFlag.lng)
  await sleep(300)
  assert.equal(await boughtDistance.textContent(), bracketBeforeMove)
  await west.shot('strict-hot-cold-immutable.png')
  console.log('  ✅ Hot/Cold persists no target coordinates and its purchase-time bracket stays unchanged after moving')
} finally {
  await browser.close()
}

console.log('7/7 strict checks passed')
