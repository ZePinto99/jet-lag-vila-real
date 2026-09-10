// E15 Frozen: banner shows a gated countdown + drift readout; moving out of
// place turns the readout red AND extends the curse server-side (wander
// prolongs the freeze). E16 Check-in: a tap-to-acknowledge control appears.

import { mkdirSync } from 'node:fs'
import { strict as assert } from 'node:assert'
import { execSync } from 'node:child_process'
import { launchBrowser, makeClient, setupLiveGame, coord, SHOTS, sleep } from './harness.mjs'

mkdirSync(SHOTS, { recursive: true })

function db(sql) {
  const out = execSync(
    `docker exec supabase_db_jet-lag-the-game-vr psql -U postgres -d postgres -tAc ${JSON.stringify(sql)}`,
    { encoding: 'utf8' },
  )
  return out.split('\n').filter((l) => l && !/^(INSERT|UPDATE|DELETE|SELECT) \d/.test(l))
}

const g = await setupLiveGame()
console.log(`game ${g.code} live`)

// Insert a Frozen curse + a Check-in curse targeting EAST.
const frozenId = db(
  `insert into active_curses (game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${g.gid}','${g.eTeam}','curse.frozen', now(), now()+interval '8 minutes','{"max_drift_m":10}'::jsonb) returning id;`,
)[0]
db(
  `insert into active_curses (game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${g.gid}','${g.eTeam}','curse.check-in', now(), now()+interval '10 minutes','{"interval_seconds":60,"submission_window_seconds":60}'::jsonb);`,
)
console.log(`inserted frozen=${frozenId} + check-in on EAST`)

const browser = await launchBrowser()
try {
  const bib = coord('landmark.biblioteca-municipal')
  const east = await makeClient(browser, { deviceId: g.eDevice, lat: bib.lat, lng: bib.lng })
  await east.goto(`/game/${g.code}`)
  await east.page.waitForSelector('.leaflet-container', { timeout: 20000 })
  await east.enableGps()
  await sleep(4000) // GPS fix -> anchor captured; banner renders

  // In place: Frozen shown with a drift readout.
  const hasFrozen = await east.page.getByText(/^Frozen$/).count()
  const hasDrift = await east.page.getByText(/Drift .* from start/i).count()
  assert.ok(hasFrozen > 0, 'Frozen curse banner must render')
  assert.ok(hasDrift > 0, 'Frozen curse must show a live drift readout')
  await east.shot('curse-inplace.png')
  console.log('  ✅ Frozen banner and drift readout shown')

  // E16: check-in acknowledge control present, then tap it.
  const ackBtn = east.page.getByRole('button', { name: /Check in now/i })
  await ackBtn.first().waitFor({ timeout: 10000 })
  await ackBtn.first().click()
  await east.page.getByText(/Checked in/i).waitFor({ timeout: 5000 })
  await east.shot('curse-checkin-acked.png')
  console.log('  ✅ check-in prompt acknowledges immediately')

  // E15: move out of place -> drift goes red, and the curse expiry extends.
  const expBefore = db(`select extract(epoch from expires_at)::int from active_curses where id='${frozenId}';`)[0]
  await east.setPos(bib.lat + 0.0006, bib.lng) // ~66 m -> drift > 10 m
  console.log('moved east ~66 m out of place; waiting for extend…')
  await sleep(16000)
  await east.shot('curse-outofplace.png')
  const expAfter = db(`select extract(epoch from expires_at)::int from active_curses where id='${frozenId}';`)[0]
  const delta = Number(expAfter) - Number(expBefore)
  assert.ok(delta > 0, `wandering should extend Frozen expiry (delta=${delta})`)
  east.assertNoUnexpectedErrors()
  console.log(`  ✅ wandering extended the freeze server-side (+${delta}s)`)
} finally {
  // Cleanup is guaranteed even when a browser assertion fails.
  db(`delete from active_curses where game_id='${g.gid}';`)
  await browser.close()
}
console.log('done')
