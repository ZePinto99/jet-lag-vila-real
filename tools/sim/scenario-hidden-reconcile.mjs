// Team-private state is not broadcast as raw rows (flag kind and trap location
// would leak). Verify scoped events cause the second teammate to reconcile the
// signed/filtered live-state snapshot without a browser refresh.

import {
  apiPost,
  coord,
  db,
  launchBrowser,
  makeClient,
  setupLiveGame,
} from './harness.mjs'

function expect(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`  ✅ ${message}`)
}

const g = await setupLiveGame(`hidden-reconcile-${Date.now()}`)
db(`update teams set coins=300 where id='${g.wTeam}';`)
const browser = await launchBrowser()

try {
  const pos = coord('landmark.miradouro-vila-velha')
  const west1 = await makeClient(browser, { deviceId: g.wDevice, ...pos })
  const west2 = await makeClient(browser, { deviceId: g.w2Device, ...pos })
  for (const client of [west1, west2]) {
    await client.goto(`/game/${g.code}`)
    await client.page.waitForSelector('.leaflet-container', { timeout: 20_000 })
    await client.tab('Status')
  }

  const harden1 = west1.page.getByRole('button', { name: /Harden flag · 150 coins/i })
  const harden2 = west2.page.getByRole('button', { name: /Harden flag · 150 coins/i })
  await harden1.waitFor({ state: 'visible', timeout: 10_000 })
  expect(await harden2.isEnabled(), 'both teammates initially see harden available')
  await harden1.click()
  await west1.page.getByRole('button', { name: /Confirm/i }).last().click()
  await west2.page.getByRole('button', { name: /Already hardened/i }).waitFor({ state: 'visible', timeout: 10_000 })
  expect(true, 'flag_hardened event reconciles teammate private landmark state')

  // The remaining 150 coins are enough for one hidden Snare.
  for (const client of [west1, west2]) await client.tab('Actions')
  const snarePlace = west1.page
    .locator('li')
    .filter({ hasText: /^Snare/ })
    .getByRole('button', { name: /Place · 120/i })
  await snarePlace.click()
  await west1.page.getByRole('button', { name: /Confirm/i }).last().click()
  const teammateArmed = west2.page.getByText(/Armed on /i)
  await teammateArmed.waitFor({ state: 'visible', timeout: 10_000 })
  expect(true, 'placed_curse_armed event reconciles hidden placement to teammate')

  const placedRef = db(
    `select landmark_ref from placed_curses where game_id='${g.gid}' and owner_team_id='${g.wTeam}' and armed order by created_at desc limit 1;`,
  )[0]
  const trapPos = coord(placedRef)

  await apiPost(`/api/games/${g.gid}/trigger-placed-curse`, {
    device_id: g.eDevice,
    player_id: g.ePlayer,
    pos: { ...trapPos, accuracy: 5, updated_at: Date.now() },
  })
  await teammateArmed.waitFor({ state: 'detached', timeout: 10_000 })
  expect(
    Number(db(`select count(*) from active_curses where game_id='${g.gid}' and target_team_id='${g.eTeam}' and curse_ref='curse.frozen';`)[0]) === 1,
    'placed-curse trigger casts once and removes teammate armed state without refresh',
  )

  west1.assertNoUnexpectedErrors()
  west2.assertNoUnexpectedErrors()
} finally {
  db(`delete from active_curses where game_id='${g.gid}';`)
  await browser.close()
}

console.log('hidden-state reconcile scenario passed')
