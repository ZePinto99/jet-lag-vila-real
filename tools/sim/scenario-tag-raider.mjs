// Multi-client tag rules: ordinary enemy defenders remain immune, but an
// enemy on a defending candidate is a raider even inside overlapping unions.
// A bulk tap catches two raiders, loses at most one team intel, and independently
// clears both respawns without refreshing a browser.

import {
  BASE,
  coord,
  db,
  launchBrowser,
  makeClient,
  makeGameN,
  sleep,
} from './harness.mjs'

function expect(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`  ✅ ${message}`)
}

const g = await makeGameN(2, 2, `tag-raider-${Date.now()}`)
console.log(`game ${g.code} live (2v2)`)
const browser = await launchBrowser()

try {
  const westZone = coord('landmark.miradouro-meia-laranja')
  const eastZone = coord('landmark.biblioteca-municipal')
  const overlap = {
    lat: (westZone.lat + eastZone.lat) / 2,
    lng: (westZone.lng + eastZone.lng) / 2,
  }
  const west = await makeClient(browser, { deviceId: g.west[0].device, ...overlap })
  const east = await Promise.all(
    g.east.map((player) => makeClient(browser, { deviceId: player.device, ...overlap })),
  )
  for (const client of [west, ...east]) {
    await client.goto(`/game/${g.code}`)
    await client.page.waitForSelector('.leaflet-container', { timeout: 20_000 })
    await client.enableGps()
  }
  await sleep(5_000)

  const disabled = west.page.getByRole('button', { name: 'Tag button disabled' })
  expect(
    (await disabled.count()) === 0,
    'non-actionable Tag button stays hidden when the nearby enemy is a defender',
  )
  await west.page
    .getByText('Defense zone · Tag ready if a raider comes within 5 m')
    .waitFor({ state: 'visible', timeout: 8_000 })

  const invalidPos = { ...overlap, accuracy: 8, updated_at: Date.now() }
  const invalid = await fetch(`${BASE}/api/games/${g.gid}/tag`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      device_id: g.west[0].device,
      tagger_player_id: g.west[0].player,
      tagger_pos: invalidPos,
      targets: [{ player_id: g.east[0].player, pos: invalidPos }],
    }),
  })
  const invalidBody = await invalid.json()
  expect(
    invalidBody.rejected?.[0]?.reason === 'target_not_raider',
    'server rejects a forged tag against a defender as target_not_raider',
  )

  // The train station is a West objective that also falls inside East's
  // Biblioteca defense circle. The 50 m objective override must make the East
  // players raiders here instead of granting overlap immunity.
  const overlapObjective = coord('landmark.estacao-ferroviaria')
  await Promise.all([
    west.setPos(overlapObjective.lat, overlapObjective.lng),
    ...east.map((client) => client.setPos(overlapObjective.lat, overlapObjective.lng)),
  ])
  const overlapTagButton = west.page.getByRole('button', { name: /Tag 2 players within 5 metres/i })
  await overlapTagButton.waitFor({ state: 'visible', timeout: 12_000 })
  expect(await overlapTagButton.isEnabled(), 'enemy standing on a West candidate remains taggable inside overlapping defense unions')

  // Meia Laranja is a West candidate but >200m from East candidates. Both
  // East players become raiders while remaining within five metres of West.
  const coinsBeforeTag = Number(
    db(`select coins from teams where id='${g.eTeam}';`)[0],
  )
  await Promise.all([west.setPos(westZone.lat, westZone.lng), ...east.map((c) => c.setPos(westZone.lat, westZone.lng))])
  const tagButton = west.page.getByRole('button', { name: /Tag 2 players within 5 metres/i })
  await tagButton.waitFor({ state: 'visible', timeout: 12_000 })
  await tagButton.click()
  await west.page.getByText(/Tagged 2 players/i).waitFor({ state: 'visible', timeout: 8_000 })
  const respawningCount = Number(
    db(`select count(*) from players where id in ('${g.east[0].player}','${g.east[1].player}') and respawning;`)[0],
  )
  expect(respawningCount === 2, 'one valid multi-raider tag marks both players respawning')
  const coinsAfterTag = Number(
    db(`select coins from teams where id='${g.eTeam}';`)[0],
  )
  expect(
    coinsBeforeTag - coinsAfterTag === Math.min(40, coinsBeforeTag),
    'one bulk Tag action fines the raiding team 40 coins once',
  )

  const respawnTargets = g.east.map((player) =>
    db(`select respawn_target_ref from players where id='${player.player}';`)[0],
  )
  for (let index = 0; index < east.length; index += 1) {
    const neutral = coord(respawnTargets[index])
    await east[index].setPos(neutral.lat, neutral.lng)
    await sleep(1_000)
    const arrived = east[index].page.getByRole('button', { name: /I've reached/i })
    await arrived.waitFor({ state: 'visible', timeout: 8_000 })
    await arrived.click()
    const leave = east[index].page.getByRole('button', { name: /I've left/i })
    await leave.waitFor({ state: 'visible', timeout: 8_000 })
    await east[index].setPos(neutral.lat + 0.00055, neutral.lng)
    await sleep(1_000)
    await leave.click()
  }
  const deadline = Date.now() + 12_000
  let remaining = 2
  while (Date.now() < deadline && remaining > 0) {
    remaining = Number(
      db(`select count(*) from players where id in ('${g.east[0].player}','${g.east[1].player}') and respawning;`)[0],
    )
    if (remaining > 0) await sleep(500)
  }
  expect(
    remaining === 0,
    'both tagged players visit the assigned nearest neutral then leave its immunity zone',
  )

  west.assertNoUnexpectedErrors()
  for (const client of east) client.assertNoUnexpectedErrors()
} finally {
  await browser.close()
}

console.log('tag/raider scenario passed')
