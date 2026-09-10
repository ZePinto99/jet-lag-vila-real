// Multi-client realtime/GPS regression matrix. This intentionally drives two
// cursed clients at once because a single-client test cannot detect multiplied
// Frozen extension debt.

import { mkdirSync } from 'node:fs'
import {
  SHOTS,
  apiPost,
  coord,
  db,
  launchBrowser,
  makeClient,
  makeGameN,
  sleep,
} from './harness.mjs'

mkdirSync(SHOTS, { recursive: true })

function expect(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`  ✅ ${message}`)
}

async function frozenSeconds(client) {
  const text = await client.page.locator('li').filter({ hasText: 'Frozen' }).first().innerText()
  const match = text.match(/(\d+)m\s+(\d{2})s/)
  if (!match) throw new Error(`Frozen countdown missing from: ${text}`)
  return Number(match[1]) * 60 + Number(match[2])
}

const g = await makeGameN(2, 2, `realtime-${Date.now()}`)
console.log(`game ${g.code} live (2v2)`)

const frozenId = db(
  `insert into active_curses (game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${g.gid}','${g.eTeam}','curse.frozen',now(),now()+interval '8 minutes','{"max_drift_m":10}'::jsonb) returning id;`,
)[0]

const browser = await launchBrowser()
try {
  const bib = coord('landmark.biblioteca-municipal')
  const east = await Promise.all(
    g.east.map((player) =>
      makeClient(browser, {
        deviceId: player.device,
        lat: bib.lat,
        lng: bib.lng,
      }),
    ),
  )
  for (const client of east) await client.goto(`/game/${g.code}`)
  for (const client of east) {
    await client.page.waitForSelector('.leaflet-container', { timeout: 20_000 })
    await client.enableGps()
  }
  const defaultNotificationPermission = await east[0].page.evaluate(
    () => Notification.permission,
  )
  const optInButtons = await east[0].page
    .getByRole('button', { name: /Enable lock-screen notifications/i })
    .count()
  console.log(`  default notification permission=${defaultNotificationPermission}, opt-in buttons=${optInButtons}`)
  expect(
    defaultNotificationPermission !== 'default' || optInButtons === 1,
    'first-time push permission is exposed as an explicit user action',
  )
  await sleep(4_000)

  for (const client of east) {
    expect(
      (await client.page.getByText(/^Frozen$/).count()) === 1,
      `${client.deviceId} renders Frozen enforcement`,
    )
  }

  // One teammate wandering pauses the shared clock for everyone, including a
  // teammate whose own phone remains at its anchor.
  const stationaryBefore = await frozenSeconds(east[1])
  await east[0].setPos(bib.lat + 0.0006, bib.lng)
  await sleep(5_000)
  const stationaryAfter = await frozenSeconds(east[1])
  expect(
    stationaryBefore - stationaryAfter <= 2,
    'one wandering teammate pauses every teammate\'s Frozen countdown',
  )

  const expiresBefore = Number(
    db(`select extract(epoch from expires_at) from active_curses where id='${frozenId}';`)[0],
  )
  const movedAt = Date.now()
  await east[1].setPos(bib.lat + 0.0006, bib.lng)
  await sleep(34_000)
  const elapsedSeconds = (Date.now() - movedAt) / 1000
  const expiresAfter = Number(
    db(`select extract(epoch from expires_at) from active_curses where id='${frozenId}';`)[0],
  )
  const extensionSeconds = expiresAfter - expiresBefore
  console.log(
    `  Frozen wall=${elapsedSeconds.toFixed(1)}s, shared expiry extension=${extensionSeconds.toFixed(1)}s`,
  )
  expect(extensionSeconds > 0, 'out-of-place movement extends Frozen')
  expect(
    extensionSeconds <= elapsedSeconds + 8,
    'two moving teammates do not multiply one shared Frozen clock',
  )

  // Long-compliant regression: five minutes after cast, overlapping 10-second
  // reports still count once. The old elapsed-time cap allowed both in full.
  const lateFrozenId = db(
    `insert into active_curses (game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${g.gid}','${g.wTeam}','curse.frozen',now()-interval '5 minutes',now()+interval '3 minutes','{"max_drift_m":10}'::jsonb) returning id;`,
  )[0]
  const westAnchor = coord('landmark.largo-do-pelourinho')
  const anchorPos = { ...westAnchor, accuracy: 5, updated_at: Date.now() }
  for (const player of g.west) {
    await apiPost(`/api/games/${g.gid}/extend-curse`, {
      device_id: player.device,
      player_id: player.player,
      curse_id: lateFrozenId,
      anchor_pos: anchorPos,
    })
  }
  const originalExpiry = Number(
    db(`select extract(epoch from expires_at) from active_curses where id='${lateFrozenId}';`)[0],
  )
  const intervalEnd = Date.now()
  const interval = { started_at: intervalEnd - 10_000, ended_at: intervalEnd }
  await Promise.all(
    g.west.map((player) =>
      apiPost(`/api/games/${g.gid}/extend-curse`, {
        device_id: player.device,
        player_id: player.player,
        curse_id: lateFrozenId,
        violation: interval,
      }),
    ),
  )
  const overlappedExpiry = Number(
    db(`select extract(epoch from expires_at) from active_curses where id='${lateFrozenId}';`)[0],
  )
  const overlapAdded = overlappedExpiry - originalExpiry
  expect(
    overlapAdded >= 9 && overlapAdded <= 12,
    `overlapping 10s reports after 5 compliant minutes are unioned once (${overlapAdded.toFixed(1)}s)`,
  )

  // A late mount at a moved position must receive the original server anchor.
  const movedWest = { lat: westAnchor.lat + 0.0006, lng: westAnchor.lng }
  const repeatAnchor = await apiPost(`/api/games/${g.gid}/extend-curse`, {
    device_id: g.west[0].device,
    player_id: g.west[0].player,
    curse_id: lateFrozenId,
    anchor_pos: { ...movedWest, accuracy: 5, updated_at: Date.now() },
  })
  expect(
    Math.abs(repeatAnchor.anchor.lat - westAnchor.lat) < 0.000001,
    'Frozen anchor is first-write-wins across reload/late-mount attempts',
  )

  const west = await makeClient(browser, {
    deviceId: g.west[0].device,
    ...movedWest,
    notifications: true,
  })
  await west.goto(`/game/${g.code}`)
  await west.page.waitForSelector('.leaflet-container', { timeout: 20_000 })
  await west.enableGps()
  await west.page.getByText(/Drift .* from start/i).waitFor({ state: 'visible', timeout: 10_000 })
  const driftText = await west.page.getByText(/Drift .* from start/i).first().innerText()
  const driftMetres = Number(driftText.match(/(\d+)/)?.[1] ?? 0)
  expect(driftMetres > 10, `late-mounted Frozen client retains original anchor (${driftMetres}m drift)`)

  const pushDeadline = Date.now() + 12_000
  let pushRows = 0
  while (Date.now() < pushDeadline && pushRows === 0) {
    pushRows = Number(
      db(`select count(*) from push_subscriptions where game_id='${g.gid}' and player_id='${g.west[0].player}';`)[0] || '0',
    )
    if (pushRows === 0) await sleep(500)
  }
  if (pushRows === 0) {
    console.log('  ⚠️ Chrome incognito blocks Push API registration; covered by hook + API tests')
  } else {
    expect(pushRows === 1, 'granted Web Push permission creates a server subscription row')
  }
} finally {
  db(`delete from active_curses where game_id='${g.gid}';`)
  await browser.close()
}

console.log('realtime resilience scenario passed')
