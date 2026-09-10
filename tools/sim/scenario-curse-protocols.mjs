// GPS/action protocol coverage for Detour, Pilgrimage, pause gating, and
// expiry event reconciliation. Catalog/render mechanics for enabled curses are
// covered deterministically in Jest; this exercises the real browser/API/DB
// boundaries that require multiple asynchronous systems.

import {
  BASE,
  apiPost,
  coord,
  db,
  launchBrowser,
  makeClient,
  setupLiveGame,
  sleep,
} from './harness.mjs'

function expect(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`  ✅ ${message}`)
}

async function waitDb(sql, expected, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs
  let value = ''
  while (Date.now() < deadline) {
    value = db(sql)[0] ?? ''
    if (value === String(expected)) return
    await sleep(400)
  }
  throw new Error(`DB wait failed: expected ${expected}, got ${value}`)
}

const g = await setupLiveGame(`curse-protocols-${Date.now()}`)
console.log(`game ${g.code} live (2v2)`)
const pilgrimageTarget = 'landmark.largo-do-pelourinho'
const pilgrimageId = db(
  `insert into active_curses (game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${g.gid}','${g.eTeam}','curse.pilgrimage',now(),null,'{"geofence_required":true,"target_landmark_ref":"${pilgrimageTarget}"}'::jsonb) returning id;`,
)[0]
db(
  `insert into active_curses (game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${g.gid}','${g.eTeam}','curse.detour',now(),now()+interval '15 minutes','{"banned_street_name":"Avenida Carvalho Araújo","banned_street_polyline":[[41.29363,-7.74609],[41.29430,-7.74620],[41.29510,-7.74667],[41.29633,-7.74652]],"corridor_m":18}'::jsonb);`,
)

const browser = await launchBrowser()
try {
  const bannedStreet = { lat: 41.2943, lng: -7.7462 }
  const east = await makeClient(browser, { deviceId: g.eDevice, ...bannedStreet })
  await east.goto(`/game/${g.code}`)
  await east.page.waitForSelector('.leaflet-container', { timeout: 20_000 })
  await east.enableGps()
  const detour = east.page.getByText(/Avenida Carvalho Araújo: \d+ m away/i)
  await detour.waitFor({ state: 'visible', timeout: 10_000 })
  expect((await detour.getAttribute('class'))?.includes('text-red-300'), 'Detour entry is live-flagged red inside its selected corridor')

  await east.tab('Chat')
  const chatInput = east.page.getByPlaceholder(/Message/i)
  expect(await chatInput.isDisabled(), 'Pilgrimage disables regular browser actions')

  const locked = await fetch(`${BASE}/api/games/${g.gid}/buy-curse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      device_id: g.eDevice,
      player_id: g.ePlayer,
      num_dice: 1,
    }),
  })
  expect(locked.status === 409 && (await locked.json()).error === 'actions_locked', 'Pilgrimage action lock is server-authoritative')

  const farCompletion = await fetch(`${BASE}/api/games/${g.gid}/complete-pilgrimage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      device_id: g.eDevice,
      player_id: g.ePlayer,
      curse_id: pilgrimageId,
      pos: { ...bannedStreet, accuracy: 8, updated_at: Date.now() },
    }),
  })
  expect(
    farCompletion.status === 409 && (await farCompletion.json()).error === 'not_at_pilgrimage_target',
    'Pilgrimage refuses completion outside the 30 m target geofence',
  )

  const target = coord(pilgrimageTarget)
  await east.setPos(target.lat, target.lng)
  await waitDb(`select count(*) from active_curses where id='${pilgrimageId}';`, 0)
  await east.page.getByText(/^Pilgrimage$/).waitFor({ state: 'detached', timeout: 8_000 })
  expect(!(await chatInput.isDisabled()), 'target arrival completes Pilgrimage and unlocks UI without refresh')
  expect((await detour.getAttribute('class'))?.includes('text-emerald-300'), 'Detour readout clears green outside its corridor')

  // Expiry DELETE payloads can be incomplete, so the durable curse_expired
  // event must remove the banner/action state without a force refresh.
  const backwardsId = db(
    `insert into active_curses (game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${g.gid}','${g.eTeam}','curse.backwards',now(),now()+interval '3 seconds','{}'::jsonb) returning id;`,
  )[0]
  await east.page.getByText(/^Backwards$/).waitFor({ state: 'visible', timeout: 8_000 })
  await sleep(3_500)
  await apiPost(`/api/games/${g.gid}/expire-curses`, { device_id: g.eDevice })
  await east.page.getByText(/^Backwards$/).waitFor({ state: 'detached', timeout: 8_000 })
  expect(
    Number(db(`select count(*) from active_curses where id='${backwardsId}';`)[0]) === 0,
    'curse expiry removes the live banner through realtime without refresh',
  )

  // Weather pause: arriving at a Pilgrimage target must not auto-complete
  // until play resumes.
  const pausedTarget = 'landmark.igreja-dos-clerigos'
  const pausedId = db(
    `insert into active_curses (game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${g.gid}','${g.eTeam}','curse.pilgrimage',now(),null,'{"geofence_required":true,"target_landmark_ref":"${pausedTarget}"}'::jsonb) returning id;`,
  )[0]
  const pausedFrozenId = db(
    `insert into active_curses (game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${g.gid}','${g.eTeam}','curse.frozen',now(),now()+interval '8 minutes','{"max_drift_m":10}'::jsonb) returning id;`,
  )[0]
  await east.page.getByText(/^Pilgrimage$/).waitFor({ state: 'visible', timeout: 8_000 })
  await east.page.getByText(/^Frozen$/).waitFor({ state: 'visible', timeout: 8_000 })
  await waitDb(`select count(*) from frozen_player_anchors where curse_id='${pausedFrozenId}';`, 1)
  await apiPost(`/api/games/${g.gid}/pause`, {
    device_id: g.wDevice,
    player_id: g.wPlayer,
    action: 'pause',
  })
  await apiPost(`/api/games/${g.gid}/pause`, {
    device_id: g.eDevice,
    player_id: g.ePlayer,
    action: 'pause',
  })
  await sleep(1_500)
  const pausedPos = coord(pausedTarget)
  await east.setPos(pausedPos.lat, pausedPos.lng)
  await sleep(3_500)
  expect(
    Number(db(`select count(*) from active_curses where id='${pausedId}';`)[0]) === 1,
    'weather pause suppresses Pilgrimage GPS completion',
  )
  expect(
    Number(db(`select count(*) from frozen_violation_seconds where curse_id='${pausedFrozenId}';`)[0]) === 0,
    'moving during weather pause accrues zero Frozen violation seconds',
  )
  await apiPost(`/api/games/${g.gid}/pause`, {
    device_id: g.wDevice,
    player_id: g.wPlayer,
    action: 'resume',
  })
  await apiPost(`/api/games/${g.gid}/pause`, {
    device_id: g.eDevice,
    player_id: g.ePlayer,
    action: 'resume',
  })
  await sleep(1_500)
  await east.setPos(pausedPos.lat + 0.000005, pausedPos.lng)
  await waitDb(`select count(*) from active_curses where id='${pausedId}';`, 0)
  expect(true, 'Pilgrimage completion resumes when gameplay resumes')
  await waitDb(`select (count(*)>0)::int from frozen_violation_seconds where curse_id='${pausedFrozenId}';`, 1)
  expect(true, 'Frozen movement accounting resumes after gameplay resumes')

  east.assertNoUnexpectedErrors()
} finally {
  db(`delete from active_curses where game_id='${g.gid}';`)
  await browser.close()
}

console.log('curse protocol scenario passed')
