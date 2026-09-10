// Realtime is not a durable queue. Verify that a mobile-style offline gap is
// recovered from the authenticated live-state snapshot on browser reconnect,
// without a force refresh.

import { db, launchBrowser, makeClient, setupLiveGame, coord } from './harness.mjs'

const g = await setupLiveGame(`reconnect-${Date.now()}`)
const browser = await launchBrowser()

try {
  const pos = coord('landmark.miradouro-vila-velha')
  const west = await makeClient(browser, { deviceId: g.wDevice, ...pos })
  await west.goto(`/game/${g.code}`)
  await west.page.waitForSelector('.leaflet-container', { timeout: 20_000 })
  const initialCoins = db(`select coins from teams where id='${g.wTeam}';`)[0]
  await west.page.getByText(new RegExp(`^${initialCoins} coins$`, 'i')).waitFor({ state: 'visible', timeout: 8_000 })

  await west.context.setOffline(true)
  db(`update teams set coins=77 where id='${g.wTeam}';`)
  db(
    `insert into events(game_id,type,actor_player_id,payload) values ('${g.gid}','curse_cast','${g.ePlayer}','{"target_team_id":"${g.wTeam}","curse_ref":"curse.mute"}'::jsonb);`,
  )
  await west.context.setOffline(false)

  await west.page.getByText(/^77 coins$/i).waitFor({ state: 'visible', timeout: 12_000 })
  const eventRecovered = await west.page.evaluate(async ({ gid, device }) => {
    const response = await fetch(`/api/games/${gid}/live-state?device_id=${encodeURIComponent(device)}`)
    const snapshot = await response.json()
    return snapshot.recent_events.some((event) => event.type === 'curse_cast')
  }, { gid: g.gid, device: g.wDevice })
  if (!eventRecovered) throw new Error('missed event absent from durable live-state history')
  console.log('  ✅ online recovery reconciles missed team state and durable event history without refresh')
  west.assertNoUnexpectedErrors([/ERR_INTERNET_DISCONNECTED/i, /Failed to fetch/i])
} finally {
  await browser.close()
}

console.log('reconnect scenario passed')
