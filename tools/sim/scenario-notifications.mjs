// F18-F20 notifications: (1) history is NOT replayed as a toast burst on load,
// (2) a fresh event pushes a toast to an already-open client WITHOUT a refresh.
//
// Uses the D14 review toast: west submits a photo challenge -> the EAST client
// (reviewing team) should get "A challenge photo needs your review".

import { mkdirSync } from 'node:fs'
import { strict as assert } from 'node:assert'
import {
  launchBrowser,
  makeClient,
  setupLiveGame,
  apiGet,
  apiPost,
  coord,
  uploadChallengeProof,
  SHOTS,
  sleep,
} from './harness.mjs'

mkdirSync(SHOTS, { recursive: true })

// West submits the first available photo challenge (server marks it pending +
// emits challenge_submitted, reviewing_team = east). Returns the ref.
async function westSubmitsPhotoChallenge(g) {
  const ch = await apiGet(`/api/games/${g.gid}/challenges?device_id=${g.wDevice}`)
  const c = ch.active.find((x) => x.photo_required && x.landmark_ref)
  assert.ok(c, 'West should have an active landmark photo challenge')
  const pos = { ...coord(c.landmark_ref), accuracy: 5, updated_at: Date.now() }
  const proofUrl = await uploadChallengeProof(g.gid, g.wPlayer, `notification-${Date.now()}`)
  await apiPost(`/api/games/${g.gid}/submit-challenge`, {
    device_id: g.wDevice,
    player_id: g.wPlayer,
    challenge_ref: c.id,
    pos,
    photo_url: proofUrl,
  })
  return c.location_name
}

const g = await setupLiveGame()
console.log(`game ${g.code} live`)

// HISTORY: one review already exists before east ever loads.
const past = await westSubmitsPhotoChallenge(g)
console.log(`history review created: ${past}`)

const browser = await launchBrowser()
try {
  const bib = coord('landmark.biblioteca-municipal')
  const east = await makeClient(browser, { deviceId: g.eDevice, lat: bib.lat, lng: bib.lng })
  await east.goto(`/game/${g.code}`)
  await east.page.waitForSelector('.leaflet-container', { timeout: 20000 })

  // F20: history must NOT replay as a toast on load.
  await sleep(4500)
  const replayToasts = await east.page.getByText(/needs your review/i).count()
  assert.equal(replayToasts, 0, 'historical notifications must not replay as toasts on load')
  await east.shot('notif-east-onload.png')
  console.log('  ✅ no history-replay toast on load (F20)')

  // F18/F19: a NEW event pushes a toast live, no refresh.
  console.log('west submits a NEW challenge (live)…')
  const fresh = await westSubmitsPhotoChallenge(g)
  console.log(`fresh review: ${fresh}`)
  await east.page.getByText(/needs your review/i).first().waitFor({ state: 'visible', timeout: 8000 })
  await east.shot('notif-east-live-toast.png')
  console.log('  ✅ live toast delivered without refresh (F18/F19)')

  // The pending review should also be actionable in the Actions tab.
  await east.tab('Actions')
  const accept = east.page.getByRole('button', { name: /Accept/i })
  await accept.first().waitFor({ timeout: 10000 })
  const reviewable = await accept.count()
  assert.ok(reviewable >= 1, 'fresh review notification must have an actionable review control')
  await east.shot('notif-east-review-panel.png')
  east.assertNoUnexpectedErrors()
  console.log(`  ✅ review panel shows ${reviewable} accept/reject control(s)`)
} finally {
  await browser.close()
}
console.log('done')
