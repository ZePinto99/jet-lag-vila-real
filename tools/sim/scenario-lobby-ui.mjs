// Strict browser-driven pre-game journey: install manifest, create, join,
// switch, remove, equal 1–4 validation, ready/start, and private I7 photo
// upload during both teams' flag setup. Unlike the older visual smoke scripts,
// every check throws and the process exits non-zero on a regression.

import { strict as assert } from 'node:assert'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  BASE,
  SHOTS,
  apiGet,
  db,
  launchBrowser,
  makeClient,
  sleep,
} from './harness.mjs'

mkdirSync(SHOTS, { recursive: true })

const marks = []
function pass(label) {
  marks.push(label)
  console.log(`  ✅ ${label}`)
}

async function joinThroughUi(client, code, name, side) {
  await client.goto(`/game/join?code=${code}`)
  await client.page.waitForLoadState('networkidle')
  await client.page.getByLabel('Your name').fill(name)
  await client.page.getByText(side === 'west' ? 'West (Vila Velha)' : 'East (Biblioteca)').click()
  const chosen = client.page.getByRole('radio', {
    name: side === 'west' ? 'West (Vila Velha)' : 'East (Biblioteca)',
  })
  assert.equal(await chosen.isChecked(), true, `${name}: preferred side should be visibly selected`)
  await client.page.getByRole('button', { name: 'Join game' }).click()
  await client.page.waitForURL(new RegExp(`/game/${code}$`), { timeout: 15000 })
  await client.page.getByRole('heading', { name: 'Lobby' }).waitFor({ timeout: 15000 })
}

async function assignThroughUi(client, proofPath) {
  await client.page.getByRole('heading', { name: 'Setup phase' }).waitFor({ timeout: 15000 })
  await client.page.getByRole('button', { name: 'List' }).click()
  const pool = client.page.locator('section').filter({
    has: client.page.getByRole('heading', { name: 'Your candidate pool' }),
  })
  const rows = pool.locator('li')
  assert.ok((await rows.count()) >= 5, 'setup pool should expose at least five landmarks')
  await rows.nth(0).getByRole('button', { name: 'Real' }).click()
  await rows.nth(1).getByRole('button', { name: 'Decoy' }).click()
  await rows.nth(2).getByRole('button', { name: 'Decoy' }).click()
  await rows.nth(3).getByRole('button', { name: 'Empty' }).click()
  await rows.nth(4).getByRole('button', { name: 'Empty' }).click()

  const submit = client.page.getByRole('button', { name: 'Submit assignment' })
  assert.equal(await submit.isDisabled(), true, 'assignment stays disabled until I7 photo is supplied')
  await client.page.locator('input[type=file][accept="image/*"]').setInputFiles(proofPath)
  await client.page.getByText('✓ Surroundings photo ready').waitFor()
  assert.equal(await submit.isEnabled(), true, 'valid roles + I7 photo enable submission')
  await submit.click()
}

console.log('\n===== STRICT LOBBY + SETUP UI =====')

const manifestResponse = await fetch(`${BASE}/manifest.webmanifest`)
assert.equal(manifestResponse.status, 200)
const manifest = await manifestResponse.json()
assert.equal(manifest.display, 'standalone')
assert.equal(manifest.start_url, '/')
assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'manifest must provide an install icon')
for (const icon of manifest.icons) {
  const response = await fetch(new URL(icon.src, BASE))
  assert.equal(response.status, 200, `manifest icon ${icon.src} should load`)
}
pass('PWA manifest is standalone and every declared icon loads')

const browser = await launchBrowser()
const suffix = Date.now()
const host = await makeClient(browser, { deviceId: `ui-host-${suffix}`, lat: 41.3, lng: -7.74 })
const west2 = await makeClient(browser, { deviceId: `ui-west2-${suffix}`, lat: 41.3, lng: -7.74 })
const east1 = await makeClient(browser, { deviceId: `ui-east1-${suffix}`, lat: 41.3, lng: -7.74 })
const east2 = await makeClient(browser, { deviceId: `ui-east2-${suffix}`, lat: 41.3, lng: -7.74 })
const temp = await makeClient(browser, { deviceId: `ui-temp-${suffix}`, lat: 41.3, lng: -7.74 })

try {
  await host.goto('/game/new')
  await host.page.waitForLoadState('networkidle')
  const westRadio = host.page.getByRole('radio', { name: 'West (Vila Velha)' })
  const eastRadio = host.page.getByRole('radio', { name: 'East (Biblioteca)' })
  assert.equal(await westRadio.isChecked(), true)
  await eastRadio.locator('..').click()
  await sleep(500)
  assert.equal(await eastRadio.isChecked(), true)
  assert.match(await eastRadio.locator('..').getAttribute('class'), /ring-2/)
  await westRadio.locator('..').click()
  await sleep(500)
  assert.equal(await westRadio.isChecked(), true)
  const proofPath = await host.shot('strict-create-selected.png')
  pass('create-game team selector exposes an unambiguous selected radio + team colour')

  await host.page.getByLabel('Your name').fill('Host')
  await host.page.getByRole('button', { name: 'Create game' }).click()
  await host.page.waitForURL(/\/game\/[A-Z]{4}$/, { timeout: 15000 })
  const code = new URL(host.page.url()).pathname.split('/').pop()
  assert.match(code, /^[A-Z]{4}$/)
  await host.page.getByRole('heading', { name: 'Lobby' }).waitFor({ timeout: 15000 })
  pass(`game created through browser UI (${code})`)

  const earlyStart = host.page.getByRole('button', { name: 'Start game' })
  assert.equal(await earlyStart.isDisabled(), true)
  await host.page.getByText('Teams must be equal, with 1–4 players on each side.').waitFor()
  pass('lobby blocks empty/unbalanced starts with the exact rule')

  await joinThroughUi(west2, code, 'West Two', 'west')
  await joinThroughUi(east1, code, 'East One', 'east')
  await joinThroughUi(east2, code, 'East Two', 'east')
  await host.page.getByText('East Two').waitFor({ timeout: 10000 })
  pass('three players joined through the code form with selected-team state')

  // Switch creates an invalid 1v3 split, then restores the valid 2v2 split.
  await west2.page.getByRole('button', { name: 'Switch to other team' }).click()
  await west2.page.getByText('On East').waitFor({ timeout: 10000 })
  assert.equal(await host.page.getByRole('button', { name: 'Start game' }).isDisabled(), true)
  await west2.page.getByRole('button', { name: 'Switch to other team' }).click()
  await west2.page.getByText('On West').waitFor({ timeout: 10000 })
  pass('team switch propagates live and invalid splits cannot start')

  // Exercise host removal without sacrificing one of the four game players.
  await joinThroughUi(temp, code, 'Temporary', 'east')
  await host.page.getByText('Temporary', { exact: true }).waitFor({ timeout: 10000 })
  await host.page.getByRole('button', { name: 'Remove Temporary' }).click()
  const removeDialog = host.page.getByRole('dialog', { name: 'Remove player?' })
  await removeDialog.waitFor()
  await removeDialog.getByRole('button', { name: 'Cancel' }).click()
  await host.page.getByText('Temporary', { exact: true }).waitFor()
  await host.page.getByRole('button', { name: 'Remove Temporary' }).click()
  await host.page.getByRole('dialog', { name: 'Remove player?' })
    .getByRole('button', { name: 'Remove' }).click()
  await host.page.getByText('Temporary', { exact: true }).waitFor({ state: 'detached', timeout: 10000 })
  pass('PWA-safe kick dialog supports cancel and confirm, then updates every lobby')

  for (const client of [host, west2, east1, east2]) {
    await client.page.getByRole('button', { name: 'Ready', exact: true }).click()
  }
  await sleep(1200)
  assert.equal(await host.page.getByRole('button', { name: 'Start game' }).isEnabled(), true)
  await host.page.getByRole('button', { name: 'Start game' }).click()
  for (const client of [host, west2, east1, east2]) {
    await client.page.getByRole('heading', { name: 'Setup phase' }).waitFor({ timeout: 15000 })
  }
  pass('equal 2v2, all-ready lobby starts through the UI')

  await assignThroughUi(host, proofPath)
  await host.page.getByText(/assignment is locked in/i).first().waitFor({ timeout: 15000 })
  assert.equal(db(`select count(*) from flag_surroundings where game_id=(select id from games where code='${code}');`)[0], '1')
  pass('West setup requires and privately persists its real-flag surroundings photo')

  await assignThroughUi(east1, proofPath)
  await host.page.getByRole('button', { name: /^Map/ }).first().waitFor({ timeout: 20000 })
  const snapshot = await apiGet(`/api/games/by-code/${code}`)
  assert.equal(snapshot.game.status, 'live')
  assert.equal(db(`select count(*) from flag_surroundings where game_id='${snapshot.game.id}';`)[0], '2')
  assert.equal(db(`select count(*) from storage.objects where bucket_id='surroundings-photos' and name like '${snapshot.game.id}/%';`)[0], '2')
  pass('East setup completes the transition to live with exactly two private I7 objects')

  await host.shot('strict-live-after-ui-setup.png')
} finally {
  await browser.close()
}

console.log(`${marks.length}/${marks.length} strict checks passed`)
