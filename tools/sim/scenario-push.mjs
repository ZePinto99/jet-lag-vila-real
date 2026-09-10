import { strict as assert } from 'node:assert'
import {
  coord,
  apiPost,
  db,
  launchBrowser,
  makeClient,
  setupLiveGame,
  sleep,
} from './harness.mjs'

const g = await setupLiveGame(`push-${Date.now()}`)
const browser = await launchBrowser()
try {
  const pos = coord('landmark.largo-do-pelourinho')
  const client = await makeClient(browser, {
    deviceId: g.wDevice,
    ...pos,
    notifications: true,
  })
  await client.goto(`/game/${g.code}`)
  await client.page.waitForSelector('.leaflet-container', { timeout: 20_000 })
  const enable = client.page.getByRole('button', { name: /Enable notifications/i })
  if (await enable.count()) await enable.click()
  console.log(`notification permission=${await client.page.evaluate(() => Notification.permission)}`)
  await sleep(10_000)
  let rows = Number(
    db(`select count(*) from push_subscriptions where game_id='${g.gid}' and player_id='${g.wPlayer}';`)[0] || '0',
  )
  console.log(`push rows=${rows}`)
  const body = await client.page.locator('body').innerText()
  if (/could not be enabled/i.test(body)) console.log('UI status=error (expected in Chrome incognito)')
  if (rows === 0) {
    console.log('browser subscription unavailable in incognito; verifying API → DB boundary')
    await apiPost(`/api/games/${g.gid}/push-subscribe`, {
      device_id: g.wDevice,
      player_id: g.wPlayer,
      subscription: {
        endpoint: `https://push.test/${g.gid}/${g.wPlayer}`,
        keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
      },
    })
    rows = Number(
      db(`select count(*) from push_subscriptions where game_id='${g.gid}' and player_id='${g.wPlayer}';`)[0] || '0',
    )
  }
  assert.equal(rows, 1, 'push subscribe boundary must persist exactly one row')
  client.assertNoUnexpectedErrors([
    /Push notification setup failed/i,
    /does not support the Push API in incognito mode/i,
  ])
  console.log('✅ push subscribe API persisted exactly one row')
} finally {
  await browser.close()
}
