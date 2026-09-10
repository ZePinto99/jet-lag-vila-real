// Browser enforcement matrix for category A movement mechanics plus category
// B/C/L prompts. One-shot ledger curses and catalog metadata are covered by
// API/Jest matrices; Pilgrimage, Detour, and Frozen have dedicated scenarios.

import { coord, db, launchBrowser, makeClient, setupLiveGame, sleep } from './harness.mjs'

function expect(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`  ✅ ${message}`)
}

const g = await setupLiveGame(`movement-curses-${Date.now()}`)
const refs = [
  ['curse.slow-walk', 5, '{"max_speed_kmh":2.5}'],
  ['curse.buddy-up', 15, '{"max_pairwise_distance_m":10}'],
  ['curse.solo-quarantine', 15, '{"max_pairwise_distance_m":50}'],
  ['curse.full-stop', 10, '{"lock_actions":true}'],
]
for (const [ref, minutes, params] of refs) {
  db(
    `insert into active_curses(game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${g.gid}','${g.eTeam}','${ref}',now(),now()+interval '${minutes} minutes','${params}'::jsonb);`,
  )
}

const browser = await launchBrowser()
try {
  const origin = coord('landmark.biblioteca-municipal')
  const east1 = await makeClient(browser, { deviceId: g.eDevice, ...origin })
  const east2 = await makeClient(browser, { deviceId: g.e2Device, ...origin })
  for (const client of [east1, east2]) {
    await client.goto(`/game/${g.code}`)
    await client.page.waitForSelector('.leaflet-container', { timeout: 20_000 })
    await client.enableGps()
  }
  const spread = east1.page.getByText(/Team spread \d+ m/i)
  const quarantine = east1.page.getByText(/Quarantine spread \d+ m/i)
  await spread.waitFor({ state: 'visible', timeout: 10_000 })
  await quarantine.waitFor({ state: 'visible', timeout: 10_000 })
  expect((await spread.getAttribute('class'))?.includes('text-emerald-300'), 'Buddy Up passes while every teammate is within 10 m')
  expect((await quarantine.getAttribute('class'))?.includes('text-emerald-300'), 'Team Quarantine passes while the team stays within 50 m')

  await east2.setPos(origin.lat + 0.0006, origin.lng)
  await sleep(2_000)
  expect((await spread.getAttribute('class'))?.includes('text-red-300'), 'Buddy Up flags a teammate outside 10 m')
  expect((await quarantine.getAttribute('class'))?.includes('text-red-300'), 'Team Quarantine flags a teammate outside 50 m')

  await east1.setPos(origin.lat + 0.00012, origin.lng)
  const speed = east1.page.getByText(/^Speed .* km\/h$/i)
  await speed.waitFor({ state: 'visible', timeout: 8_000 })
  let speeding = Boolean((await speed.getAttribute('class'))?.includes('text-red-300'))
  for (let step = 2; step <= 5 && !speeding; step += 1) {
    await east1.setPos(origin.lat + step * 0.00012, origin.lng)
    await sleep(350)
    speeding = Boolean((await speed.getAttribute('class'))?.includes('text-red-300'))
  }
  expect(speeding, 'Slow Walk flags live speed above 2.5 km/h')

  const promptRefs = [
    ['curse.single-file', 5, '{"prompts_per_curse":2}'],
    ['curse.photo-tax', 8, '{"interval_seconds":90,"submission_window_seconds":30}'],
    ['curse.check-in', 10, '{"interval_seconds":60,"submission_window_seconds":60}'],
    ['curse.outfit-swap', 20, '{"before_after_required":true}'],
    ['curse.mute', 15, '{"ping_interval_seconds":60}'],
    ['curse.backwards', 10, '{}'],
    ['curse.pose-patrol', 12, '{"interval_seconds":120,"submission_window_seconds":30}'],
  ]
  for (const [ref, minutes, params] of promptRefs) {
    db(
      `insert into active_curses(game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${g.gid}','${g.eTeam}','${ref}',now(),now()+interval '${minutes} minutes','${params}'::jsonb);`,
    )
  }

  for (const reminder of [
    /Group photo from the front/i,
    /Selfie at any sign/i,
    /Check in now/i,
    /Before\/after outfit photo/i,
    /Still muted/i,
    /Keep walking backwards/i,
    /Strike the pose/i,
  ]) {
    await east1.page.getByText(reminder).first().waitFor({ state: 'visible', timeout: 8_000 })
    expect(true, `renders ${reminder} reminder`)
  }
  await east1.tab('Chat')
  expect(await east1.page.getByPlaceholder(/Message/i).isDisabled(), 'Full Stop locks chat and regular actions')
  east1.assertNoUnexpectedErrors()
  east2.assertNoUnexpectedErrors()
} finally {
  db(`delete from active_curses where game_id='${g.gid}';`)
  await browser.close()
}

console.log('movement curse scenario passed')
