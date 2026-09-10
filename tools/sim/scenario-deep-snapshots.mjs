// Strict reload-depth checks: pending reviews survive the 50-event live window,
// and finished scoring/timeline use the complete paginated ledger beyond 200.

import { strict as assert } from 'node:assert'
import { mkdirSync } from 'node:fs'
import { SHOTS, db, launchBrowser, makeClient, makeGameN } from './harness.mjs'

mkdirSync(SHOTS, { recursive: true })
console.log('\n===== STRICT DEEP SNAPSHOTS =====')
const g = await makeGameN(2, 2, `deep-${Date.now()}`)
const pendingCard = db(
  `insert into cards(game_id,team_id,kind,ref,state,payload) values ('${g.gid}','${g.wTeam}','challenge','challenge.se-cathedral-date','pending',jsonb_build_object('photo_url','https://example.test/durable-review.jpg','submitted_at',clock_timestamp())) returning id;`,
)[0]
db(
  `insert into events(game_id,type,payload) select '${g.gid}','review_churn',jsonb_build_object('n',n) from generate_series(1,60) n;`,
)

const browser = await launchBrowser()
try {
  const east = await makeClient(browser, {
    deviceId: g.east[0].device,
    lat: 41.295,
    lng: -7.746,
  })
  const resultRequests = []
  east.page.on('request', (request) => {
    if (request.url().includes(`/api/games/${g.gid}/results?`)) {
      resultRequests.push(request.url())
    }
  })
  await east.goto(`/game/${g.code}`)
  await east.page.locator('.leaflet-container').waitFor({ timeout: 30000 })
  await east.tab('Actions')
  await east.page.getByText('Sé Catedral').waitFor({ timeout: 10000 })
  assert.equal(
    await east.page.getByRole('link', { name: 'View photo' }).getAttribute('href'),
    'https://example.test/durable-review.jpg',
  )
  assert.equal(
    db(`select count(*) from cards where id='${pendingCard}' and state='pending';`)[0],
    '1',
  )
  console.log('  ✅ unresolved review survives reload after 60 newer events')

  db(
    `insert into events(game_id,type,payload,created_at) values ('${g.gid}','challenge_completed','{"team_id":"${g.wTeam}","challenge_ref":"challenge.se-cathedral-date"}'::jsonb,now()-interval '10 minutes');`,
  )
  db(
    `insert into events(game_id,type,payload,created_at) select '${g.gid}','result_churn',jsonb_build_object('n',n),now()+n*interval '1 millisecond' from generate_series(1,205) n;`,
  )
  db(
    `insert into events(game_id,type,payload,created_at) values ('${g.gid}','game_won','{"winner_team_id":"${g.eTeam}","reason":"flag_returned"}'::jsonb,now()+interval '1 second'); update games set status='finished',ended_at=now() where id='${g.gid}';`,
  )

  await east.page.reload({ waitUntil: 'domcontentloaded' })
  await east.page.getByRole('heading', { name: 'Team East wins!' }).waitFor({ timeout: 30000 })
  await east.page.getByRole('button', { name: 'View full timeline' }).click()
  await east.page.getByText(/Team West completed challenge.se-cathedral-date/).waitFor({ timeout: 20000 })
  assert.ok(resultRequests.some((url) => url.includes('offset=0')))
  assert.ok(resultRequests.some((url) => url.includes('offset=100')))
  assert.ok(resultRequests.some((url) => url.includes('offset=200')))
  assert.ok(
    Number(db(`select count(*) from events where game_id='${g.gid}';`)[0]) > 200,
  )
  await east.shot('strict-deep-results-timeline.png')
  east.assertNoUnexpectedErrors()
  console.log('  ✅ authoritative results fetches every page and renders an event older than 200')
} finally {
  await browser.close()
}

console.log('2/2 strict checks passed')
