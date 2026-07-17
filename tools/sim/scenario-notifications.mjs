// F18-F20 notifications: (1) history is NOT replayed as a toast burst on load,
// (2) a fresh event pushes a toast to an already-open client WITHOUT a refresh.
//
// Uses the D14 review toast: west submits a photo challenge -> the EAST client
// (reviewing team) should get "A challenge photo needs your review".

import { mkdirSync } from 'node:fs'
import {
  launchBrowser,
  makeClient,
  setupLiveGame,
  apiGet,
  apiPost,
  coord,
  SHOTS,
  sleep,
} from './harness.mjs'

mkdirSync(SHOTS, { recursive: true })

// West submits the first available photo challenge (server marks it pending +
// emits challenge_submitted, reviewing_team = east). Returns the ref.
async function westSubmitsPhotoChallenge(g) {
  const ch = await apiGet(`/api/games/${g.gid}/challenges?device_id=${g.wDevice}`)
  const c = ch.active.find((x) => x.photo_required && x.landmark_ref)
  const pos = { ...coord(c.landmark_ref), accuracy: 5, updated_at: Date.now() }
  await apiPost(`/api/games/${g.gid}/submit-challenge`, {
    device_id: g.wDevice,
    player_id: g.wPlayer,
    challenge_ref: c.id,
    pos,
    photo_url: 'http://x/proof.jpg',
  })
  return c.location_name
}

const g = await setupLiveGame()
console.log(`game ${g.code} live`)

// HISTORY: one review already exists before east ever loads.
const past = await westSubmitsPhotoChallenge(g)
console.log(`history review created: ${past}`)

const browser = await launchBrowser()
const bib = coord('landmark.biblioteca-municipal')
const east = await makeClient(browser, { deviceId: g.eDevice, lat: bib.lat, lng: bib.lng })
await east.goto(`/game/${g.code}`)
await east.page.waitForSelector('.leaflet-container', { timeout: 20000 })

// F20: history must NOT replay as a toast on load.
await sleep(4500)
const replayToasts = await east.page.getByText(/needs your review/i).count()
await east.shot('notif-east-onload.png')
console.log(
  replayToasts === 0
    ? '  ✅ no history-replay toast on load (F20)'
    : `  ❌ ${replayToasts} history toast(s) replayed on load`,
)

// F18/F19: a NEW event pushes a toast live, no refresh.
console.log('west submits a NEW challenge (live)…')
const fresh = await westSubmitsPhotoChallenge(g)
console.log(`fresh review: ${fresh}`)
let live = false
try {
  await east.page.getByText(/needs your review/i).first().waitFor({ state: 'visible', timeout: 8000 })
  live = true
  await east.shot('notif-east-live-toast.png')
  console.log('  ✅ live toast delivered without refresh (F18/F19)')
} catch {
  await east.shot('notif-east-no-live.png')
  console.log('  ❌ no live toast within 8s')
}

// The pending review should also be actionable in the Actions tab.
if (live) {
  await east.tab('Actions')
  await sleep(1500)
  const reviewable = await east.page.getByRole('button', { name: /Accept/i }).count()
  await east.shot('notif-east-review-panel.png')
  console.log(
    reviewable >= 1
      ? `  ✅ review panel shows ${reviewable} accept/reject control(s)`
      : '  ⚠️ no accept controls found',
  )
}

await browser.close()
console.log('done')
