// Map navigation fence: a player may physically be well outside Vila Real,
// but that GPS fix must never expand the game map. The UI projects the player
// onto the nearest recovery edge and offers a walking route back inside.

import { strict as assert } from 'node:assert'
import { launchBrowser, makeClient, setupLiveGame, sleep } from './harness.mjs'

const PLAY_AREA_CENTRE = { lat: 41.2955, lng: -7.7461 }

const g = await setupLiveGame(`map-boundary-${Date.now()}`)
console.log(`game ${g.code} live (gid ${g.gid})`)

const browser = await launchBrowser()
try {
  const farOutside = {
    lat: PLAY_AREA_CENTRE.lat + 5_000 / 111_320,
    lng: PLAY_AREA_CENTRE.lng,
  }
  const west = await makeClient(browser, {
    deviceId: g.wDevice,
    lat: farOutside.lat,
    lng: farOutside.lng,
  })
  await west.goto(`/game/${g.code}`)
  await west.page.waitForSelector('.leaflet-container', { timeout: 20_000 })
  await west.enableGps()

  // Five kilometres north is far beyond both the 1.5 km play disk and its
  // 300 m recovery belt. It exercises the cold-start/outside-barrier case.
  await west.page.locator('[data-boundary-status="outside"]').waitFor({ timeout: 15_000 })

  const directions = west.page.getByRole('link', { name: 'Directions back' })
  await directions.waitFor({ state: 'visible' })
  const href = await directions.getAttribute('href')
  assert.match(href ?? '', /travelmode=walking/, 'return route must explicitly be walking')

  // The permanent red self-marker must remain inside the rendered map. If it
  // used the raw 5 km coordinate it would be far outside this viewport.
  await west.page.getByText(/You · [0-9]+ m outside/).waitFor({ timeout: 15_000 })
  const marker = west.page.locator('path.leaflet-interactive[fill="#ef4444"]').last()
  await marker.waitFor({ state: 'visible' })
  const markerBox = await marker.boundingBox()
  const mapBox = await west.page.locator('.leaflet-container').boundingBox()
  assert.ok(markerBox && mapBox, 'map and outside-player marker should have layout boxes')
  assert.ok(
    markerBox.x + markerBox.width >= mapBox.x &&
      markerBox.x <= mapBox.x + mapBox.width &&
      markerBox.y + markerBox.height >= mapBox.y &&
      markerBox.y <= mapBox.y + mapBox.height,
    'outside-player marker should be projected onto the visible recovery edge',
  )

  await west.page.getByRole('button', { name: /Open settings/i }).click()
  let settings = west.page.getByRole('dialog', { name: /Settings/i })
  await settings.getByRole('button', { name: 'View play area' }).click()
  await settings.waitFor({ state: 'hidden' })
  await sleep(300)
  const fittedMarkerBox = await marker.boundingBox()

  await west.page.getByRole('button', { name: /Open settings/i }).click()
  settings = west.page.getByRole('dialog', { name: /Settings/i })
  await settings.getByRole('button', { name: 'Show return edge' }).waitFor()
  await settings.getByRole('button', { name: 'Show return edge' }).click()
  await settings.waitFor({ state: 'hidden' })
  await sleep(500)

  // Recenter must use the projected point, not attempt a 5 km camera trip.
  const recenteredMarkerBox = await marker.boundingBox()
  const recenteredMapBox = await west.page.locator('.leaflet-container').boundingBox()
  assert.ok(recenteredMarkerBox && recenteredMapBox, 'recentered marker should remain mounted')
  const markerCentre = {
    x: recenteredMarkerBox.x + recenteredMarkerBox.width / 2,
    y: recenteredMarkerBox.y + recenteredMarkerBox.height / 2,
  }
  const mapCentre = {
    x: recenteredMapBox.x + recenteredMapBox.width / 2,
    y: recenteredMapBox.y + recenteredMapBox.height / 2,
  }
  assert.ok(
    fittedMarkerBox &&
      recenteredMarkerBox.width > fittedMarkerBox.width * 1.5 &&
      Math.abs(
        markerCentre.y - (fittedMarkerBox.y + fittedMarkerBox.height / 2),
      ) > 100,
    'return-edge recenter should leave the fitted overview and focus the projected edge',
  )
  // At the north edge Leaflet must keep the viewport itself inside maxBounds,
  // so the marker sits on the upper edge rather than the literal screen
  // centre. It should still be horizontally focused and fully visible.
  assert.ok(
    Math.abs(markerCentre.x - mapCentre.x) < 30,
    'return-edge recenter should horizontally focus the projected player',
  )
  assert.ok(
    recenteredMarkerBox.x + recenteredMarkerBox.width >= recenteredMapBox.x &&
      recenteredMarkerBox.x <= recenteredMapBox.x + recenteredMapBox.width &&
      recenteredMarkerBox.y + recenteredMarkerBox.height >= recenteredMapBox.y &&
      recenteredMarkerBox.y <= recenteredMapBox.y + recenteredMapBox.height,
    'recenter should keep the projected return-edge marker inside the map',
  )
  await west.shot('map-boundary-far-outside.png')

  west.assertNoUnexpectedErrors([
    // Existing OpenFreeMap Liberty sprite catalog warnings; unrelated to the
    // navigation fence and already present in the baseline smoke scenario.
    /Image ".*" could not be loaded/,
  ])
  console.log('✅ far-outside GPS stays on the map edge and exposes a walking route back')
} finally {
  await browser.close()
}
