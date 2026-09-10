// Strict two-team browser journey for a real challenge photo: submit, reject,
// resubmit a different PNG, accept, first-blood credit, and proof links in the
// live Status history.

import { strict as assert } from 'node:assert'
import { mkdirSync } from 'node:fs'
import {
  SHOTS,
  apiGet,
  coord,
  db,
  launchBrowser,
  makeClient,
  makeGameN,
} from './harness.mjs'

mkdirSync(SHOTS, { recursive: true })
console.log('\n===== STRICT CHALLENGE REVIEW UI =====')

const g = await makeGameN(2, 2, `challenge-ui-${Date.now()}`)
const challenges = await apiGet(`/api/games/${g.gid}/challenges?device_id=${g.west[0].device}`)
const challenge = challenges.active.find((entry) => entry.photo_required && entry.landmark_ref)
assert.ok(challenge, 'West should have a location-based photo challenge active')
const location = coord(challenge.landmark_ref)

const browser = await launchBrowser()
const west = await makeClient(browser, {
  deviceId: g.west[0].device,
  lat: location.lat,
  lng: location.lng,
})
const east = await makeClient(browser, {
  deviceId: g.east[0].device,
  lat: location.lat,
  lng: location.lng,
})

try {
  await west.goto(`/game/${g.code}`)
  await east.goto(`/game/${g.code}`)
  await west.page.waitForSelector('.leaflet-container', { timeout: 20000 })
  await east.page.waitForSelector('.leaflet-container', { timeout: 20000 })
  await west.enableGps()
  await east.enableGps()
  const firstProof = await west.shot('strict-challenge-proof-first.png')
  const secondProof = await east.shot('strict-challenge-proof-second.png')

  await west.tab('Actions')
  const challengeRow = () => west.page.locator('li').filter({ hasText: challenge.location_name }).first()
  await challengeRow().locator('input[type=file]').setInputFiles(firstProof)
  await challengeRow().getByRole('button', { name: 'Submit' }).click()
  await west.page.getByText(/Waiting for the other team — auto-accepts/).first().waitFor({ timeout: 10000 })
  const firstPath = db(`select payload->>'photo_url' from events where game_id='${g.gid}' and type='challenge_submitted' order by created_at desc limit 1;`)[0]
  assert.ok(firstPath?.includes('/challenge-photos/'))
  console.log('  ✅ West uploaded a real PNG and entered pending peer review')

  await east.tab('Actions')
  const review = east.page.locator('li').filter({ hasText: challenge.location_name }).first()
  await review.getByRole('link', { name: 'View photo' }).waitFor({ timeout: 10000 })
  await review.getByRole('button', { name: 'Reject' }).click()
  await review.waitFor({ state: 'detached', timeout: 10000 })
  await west.page.getByText('Rejected — submit a new photo.').waitFor({ timeout: 10000 })
  console.log('  ✅ East rejected the photo and West received a resubmit state')

  await challengeRow().locator('input[type=file]').setInputFiles(secondProof)
  await challengeRow().getByRole('button', { name: 'Submit' }).click()
  await west.page.getByText(/Waiting for the other team — auto-accepts/).first().waitFor({ timeout: 10000 })
  const secondPath = db(`select payload->>'photo_url' from events where game_id='${g.gid}' and type='challenge_submitted' order by created_at desc limit 1;`)[0]
  assert.notEqual(secondPath, firstPath)
  console.log('  ✅ West resubmitted a distinct replacement photo')

  const secondReview = east.page.locator('li').filter({ hasText: challenge.location_name }).first()
  await secondReview.getByRole('button', { name: 'Accept' }).waitFor({ timeout: 10000 })
  await secondReview.getByRole('button', { name: 'Accept' }).click()
  await secondReview.waitFor({ state: 'detached', timeout: 10000 })
  const completed = JSON.parse(db(`select payload::text from events where game_id='${g.gid}' and type='challenge_completed' order by created_at desc limit 1;`)[0])
  assert.equal(completed.first_blood, true)
  assert.equal(completed.photo_url, secondPath)
  assert.equal(Number(db(`select coins from teams where id='${g.wTeam}';`)[0]), 100 + challenge.reward_coins + 30)
  console.log('  ✅ acceptance credited reward + first blood exactly once')

  await west.tab('Status')
  // Anchor to the heading's direct panel. Filtering every ancestor `div`
  // could accidentally select the whole Status tab and its older Timeline
  // proof link instead of Challenge History's accepted replacement proof.
  const history = west.page
    .getByRole('heading', { name: 'Challenge history' })
    .locator('..')
  const proofLink = history.getByRole('link', { name: 'View photo' }).first()
  await proofLink.waitFor({ timeout: 10000 })
  assert.equal(await proofLink.getAttribute('href'), secondPath)
  const stored = await west.page.request.get(secondPath)
  assert.equal(stored.status(), 200)
  await west.shot('strict-challenge-accepted-history.png')
  console.log('  ✅ accepted replacement proof is linked and loadable in live history')
} finally {
  await browser.close()
}

console.log('5/5 strict checks passed')
