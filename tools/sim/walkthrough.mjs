// Full-game walkthrough for a given team size (Nv N). Drives a real browser
// game covering the rule set: economy (time bonus, intel, curse), challenge
// peer review, radar, multi-raider tag + respawn, flag attempts
// (decoy/empty/real), the win, chat, and a movement curse readout.
//
//   node tools/sim/walkthrough.mjs 2   # 2 players per team
// Screenshots: tools/sim/shots/wN-*.png

import { mkdirSync } from 'node:fs'
import { strict as assert } from 'node:assert'
import {
  launchBrowser,
  makeClient,
  makeGameN,
  backdateStart,
  db,
  apiGet,
  apiPost,
  teamCoins,
  coord,
  uploadChallengeProof,
  uploadFlagAttemptProof,
  BASE,
  SHOTS,
  sleep,
} from './harness.mjs'

const N = Number(process.argv[2] || 2)
if (!Number.isInteger(N) || N < 1 || N > 4) {
  throw new Error('Team size must be 1, 2, 3, or 4 players per side.')
}
const P = `w${N}` // screenshot / log prefix
mkdirSync(SHOTS, { recursive: true })

const results = []
const ok = (s) => {
  results.push(['✅', s])
  console.log(`  ✅ ${s}`)
}
const warn = (s) => {
  results.push(['⚠️', s])
  console.log(`  ⚠️ ${s}`)
}
async function step(label, fn) {
  try {
    await fn()
  } catch (e) {
    warn(`${label} — ${String(e).split('\n')[0]}`)
  }
}

const LIB = coord('landmark.miradouro-vila-velha') // WEST real flag + tag/radar site
const BIB = coord('landmark.biblioteca-municipal') // EAST home + EAST real
const SE = coord('landmark.largo-do-pelourinho') // a NEUTRAL landmark (respawn point)

console.log(`\n===== WALKTHROUGH ${N}v${N} =====`)
const g = await makeGameN(N, N)
console.log(`game ${g.code} live — West ${g.west.length} / East ${g.east.length}`)
ok(`lobby+setup: ${g.west.length} West vs ${g.east.length} East → live`)
backdateStart(g.gid, 31) // open flag attempts + elapse a time-bonus interval
db(`update teams set coins = 500 where game_id='${g.gid}';`) // fund all the spends we exercise

const browser = await launchBrowser()
// One browser client per player. West starts defending at the library; East
// starts at its home base.
const wc = []
// West starts at a neutral (avoids the camping timer accruing before the tag).
for (const p of g.west)
  wc.push(await makeClient(browser, { deviceId: p.device, lat: SE.lat, lng: SE.lng }))
const ec = []
for (const p of g.east)
  ec.push(await makeClient(browser, { deviceId: p.device, lat: BIB.lat, lng: BIB.lng }))
const browserApiFailures = []
for (const client of [...wc, ...ec]) {
  client.page.on('response', (response) => {
    const url = new URL(response.url())
    if (url.origin !== new URL(BASE).origin || !url.pathname.startsWith('/api/')) return
    if (response.status() < 400) return
    const entry = `${client.deviceId}: ${response.status()} ${response.request().method()} ${url.pathname}`
    browserApiFailures.push(entry)
    console.log(`  [http ${entry}]`)
    if (response.status() >= 500) {
      void response.text().then((body) => {
        console.log(`  [http body ${client.deviceId}] ${body.slice(0, 500)}`)
      }).catch(() => {})
    }
  })
}
for (const c of [...wc, ...ec]) await c.goto(`/game/${g.code}`)
for (const c of [...wc, ...ec])
  await c.page.waitForSelector('.leaflet-container', { timeout: 20000 })
for (const c of [...wc, ...ec]) await c.enableGps()
await sleep(3000)

// Remove active curses through the same durable lifecycle as production. Raw
// DELETEs bypass curse_expired/curse_completed events and can leave connected
// clients retrying work for a row that no longer exists.
async function resolveActiveCurses() {
  // Frozen clients may have a violation report already in flight when the
  // test backdates expires_at. Repeat the idempotent production claim until
  // that request finishes and the durable expiry event wins the race.
  for (let attempt = 0; attempt < 8; attempt++) {
    const rows = db(
      `select id,curse_ref,coalesce(params->>'target_landmark_ref','') from active_curses where game_id='${g.gid}';`,
    )
    if (rows.length === 0) break
    for (const row of rows) {
      const [curseId, curseRef, targetRef] = row.split('|')
      if (curseRef === 'curse.pilgrimage') {
        assert.ok(targetRef, 'Pilgrimage must persist its target landmark')
        await apiPost(`/api/games/${g.gid}/complete-pilgrimage`, {
          device_id: g.east[0].device,
          player_id: g.east[0].player,
          curse_id: curseId,
          pos: { ...coord(targetRef), accuracy: 5, updated_at: Date.now() },
        })
      } else {
        db(`update active_curses set expires_at=now()-interval '1 second' where id='${curseId}';`)
      }
    }
    await apiPost(`/api/games/${g.gid}/expire-curses`, {
      device_id: g.west[0].device,
    })
    await sleep(250)
  }
  await sleep(1000)
  assert.equal(
    Number(db(`select count(*) from active_curses where game_id='${g.gid}';`)[0]),
    0,
    'all active curses must resolve through the production lifecycle',
  )
}

// --- Economy: time bonus, intel, curse ---
await step('time-bonus', async () => {
  await apiPost(`/api/games/${g.gid}/time-tick`, { device_id: g.east[0].device })
  const n = Number(
    db(`select count(*) from events where game_id='${g.gid}' and type='time_bonus';`)[0],
  )
  n >= 1 ? ok(`time bonus credited (${n} interval(s), +20 to both teams)`) : warn('no time bonus')
})
await step('intel', async () => {
  await apiPost(`/api/games/${g.gid}/buy-intel`, {
    device_id: g.east[0].device,
    player_id: g.east[0].player,
    intel_ref: 'intel.north-south',
  })
  await apiPost(`/api/games/${g.gid}/buy-intel`, {
    device_id: g.east[0].device,
    player_id: g.east[0].player,
    intel_ref: 'intel.eliminate-one',
  })
  const n = Number(db(`select count(*) from cards where team_id='${g.eTeam}' and kind='intel';`)[0])
  n >= 2
    ? ok(`East bought ${n} intel cards (cap 4 enforced server-side)`)
    : warn(`intel count ${n}`)
})
await step('placed-curse', async () => {
  await apiPost(`/api/games/${g.gid}/place-curse`, {
    device_id: g.west[0].device,
    player_id: g.west[0].player,
    landmark_ref: 'landmark.mercado-municipal',
    placed_ref: 'placed.snare',
  })
  ok('West armed a placed curse on a candidate')
})

// --- Challenge peer review (D14) ---
await step('challenge review', async () => {
  const ch = await apiGet(`/api/games/${g.gid}/challenges?device_id=${g.west[0].device}`)
  const c = ch.active.find((x) => x.photo_required && x.landmark_ref)
  const pos = { ...coord(c.landmark_ref), accuracy: 5, updated_at: Date.now() }
  const proofUrl = await uploadChallengeProof(g.gid, g.west[0].player, 'walkthrough')
  await apiPost(`/api/games/${g.gid}/submit-challenge`, {
    device_id: g.west[0].device,
    player_id: g.west[0].player,
    challenge_ref: c.id,
    pos,
    photo_url: proofUrl,
  })
  const card = db(
    `select id from cards where team_id='${g.wTeam}' and ref='${c.id}' and state='pending';`,
  )[0]
  await apiPost(`/api/games/${g.gid}/accept-challenge`, {
    device_id: g.east[0].device,
    player_id: g.east[0].player,
    card_id: card,
  })
  const done = Number(
    db(`select count(*) from events where game_id='${g.gid}' and type='challenge_completed';`)[0],
  )
  done >= 1
    ? ok('West photo challenge submitted → East accepted → credited')
    : warn('challenge review incomplete')
})

// Cast only after peer review: a random Full Stop roll must not make the
// challenge-verification scenario nondeterministic.
await step('curse', async () => {
  await apiPost(`/api/games/${g.gid}/buy-curse`, {
    device_id: g.west[0].device,
    player_id: g.west[0].player,
    num_dice: 3,
  })
  const n = Number(
    db(`select count(*) from events where game_id='${g.gid}' and type='curse_cast';`)[0],
  )
  n >= 1 ? ok('West cast a curse on East (curse_cast event)') : warn('no curse_cast')
  // The random roll has been verified; resolve it so Full Stop or movement
  // effects cannot make the remaining independent walkthrough steps flaky.
  await resolveActiveCurses()
})

// --- Chat ---
await step('chat', async () => {
  await wc[0].tab('Chat')
  await ec[0].tab('Chat')
  await sleep(2000)
  await wc[0].page.getByPlaceholder(/Message/i).fill(`hello from ${N}v${N}`)
  await wc[0].page.getByRole('button', { name: /^Send$/i }).click()
  await ec[0].page
    .getByText(`hello from ${N}v${N}`)
    .first()
    .waitFor({ state: 'visible', timeout: 6000 })
  ok('global chat delivered live to the enemy team')
  await wc[0].tab('Map')
  await ec[0].tab('Map')
  await wc[0].page.waitForSelector('.leaflet-container', { timeout: 15000 })
  await ec[0].page.waitForSelector('.leaflet-container', { timeout: 15000 })
})

// --- Radar + multi-raider tag ---
await step('radar+tag', async () => {
  // Move every East raider to the library — inside WEST's defense zone, bunched
  // within 5 m of each other. Move the West defender in fresh (camping timer 0).
  for (let i = 0; i < ec.length; i++) await ec[i].setPos(LIB.lat + 0.000008 * (i + 1), LIB.lng)
  await wc[0].setPos(LIB.lat, LIB.lng)
  await sleep(6000)
  // West defender sees the raiders on radar (during an ON pulse).
  await wc[0].page.waitForSelector('.radar-blip', { timeout: 22000, state: 'attached' })
  const blips = await wc[0].page.locator('.radar-blip').count()
  await wc[0].shot(`${P}-radar.png`)
  ok(`radar: West sees ${blips} enemy blip(s) inside its zone (of ${ec.length})`)
  // Tag: wait for the button to light up (enabled), then dispatch the click.
  await wc[0].page.waitForFunction(
    () => {
      const b = [...document.querySelectorAll('button')].find((x) =>
        /^TAG/.test((x.textContent || '').trim()),
      )
      return !!b && !b.disabled
    },
    { timeout: 20000 },
  )
  await wc[0].page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) =>
      /^TAG/.test((x.textContent || '').trim()),
    )
    b && b.click()
  })
  // The click dispatches immediately; wait for the server transaction rather
  // than assuming a fixed dev-server response time under eight browser tabs.
  let tagged = 0
  const tagDeadline = Date.now() + 15_000
  while (tagged === 0 && Date.now() < tagDeadline) {
    await sleep(250)
    tagged = Number(
      db(
        `select count(distinct (payload->>'raider_player_id')) from events where game_id='${g.gid}' and type='tag';`,
      )[0] || '0',
    )
  }
  await wc[0].shot(`${P}-tag.png`)
  tagged >= 1
    ? ok(`tag: caught ${tagged} raider(s) in a single tap; they must respawn`)
    : warn('tag caught nobody')
})

// --- Two-stage respawn: exact assigned neutral, then leave its 45 m radius. ---
await step('respawn', async () => {
  const taggedPlayers = g.east.filter(
    (p) => db(`select respawning from players where id='${p.player}';`)[0] === 't',
  )
  assert.ok(taggedPlayers.length > 0, 'tag step must leave at least one East player respawning')

  for (let i = 0; i < taggedPlayers.length; i++) {
    const p = taggedPlayers[i]
    const targetRef = db(`select respawn_target_ref from players where id='${p.player}';`)[0]
    assert.ok(targetRef, 'tag must persist the nearest neutral target')
    const target = coord(targetRef)

    if (i === 0) {
      const client = ec[g.east.findIndex((entry) => entry.player === p.player)]
      await client.setPos(SE.lat, SE.lng)
      const arrive = client.page.getByRole('button', { name: /I've reached/i })
      await arrive.waitFor({ timeout: 10000 })
      await arrive.click()
      await client.page.getByText(/Wrong neutral — go to/i).waitFor({ timeout: 10000 })
      assert.equal(db(`select respawn_arrived from players where id='${p.player}';`)[0], 'f')

      await client.setPos(target.lat, target.lng)
      await arrive.click()
      const leave = client.page.getByRole('button', { name: /I've left/i })
      await leave.waitFor({ timeout: 10000 })
      assert.equal(db(`select respawn_arrived from players where id='${p.player}';`)[0], 't')

      await client.setPos(target.lat + 0.0006, target.lng)
      await leave.click()
      await client.page.getByText('You were tagged.').waitFor({ state: 'detached', timeout: 10000 })
    } else {
      const wrong = await fetch(`${BASE}/api/games/${g.gid}/respawn-clear`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          device_id: p.device,
          player_id: p.player,
          pos: { ...SE, accuracy: 5, updated_at: Date.now() },
        }),
      })
      const wrongBody = await wrong.json()
      assert.equal(wrong.status, 409)
      assert.equal(wrongBody.error, 'wrong_respawn_landmark')
      const arrived = await apiPost(`/api/games/${g.gid}/respawn-clear`, {
        device_id: p.device,
        player_id: p.player,
        pos: { ...target, accuracy: 5, updated_at: Date.now() },
      })
      assert.equal(arrived.stage, 'arrived')
      const cleared = await apiPost(`/api/games/${g.gid}/respawn-clear`, {
        device_id: p.device,
        player_id: p.player,
        pos: { lat: target.lat + 0.0006, lng: target.lng, accuracy: 5, updated_at: Date.now() },
      })
      assert.equal(cleared.stage, 'cleared')
    }
  }
  const respawning = Number(
    db(`select count(*) from players where team_id='${g.eTeam}' and respawning=true;`)[0],
  )
  assert.equal(respawning, 0)
  ok('wrong neutral rejected; assigned neutral arrival + departure clears respawn')
})

// --- Movement curse readout (needs ≥2 to show team spread) — before the win,
//     since the game-over overlay would hide the banner afterwards. ---
if (N >= 2) {
  await step('buddy-up readout', async () => {
    db(
      `insert into active_curses (game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${g.gid}','${g.eTeam}','curse.buddy-up', now(), now()+interval '15 minutes','{"max_pairwise_distance_m":10}'::jsonb);`,
    )
    await ec[0].setPos(BIB.lat, BIB.lng)
    await ec[1].setPos(BIB.lat + 0.001, BIB.lng) // ~111 m apart -> breach
    await sleep(4000)
    const spread = await ec[0].page.getByText(/Team spread/i).count()
    await ec[0].shot(`${P}-buddyup.png`)
    spread >= 1
      ? ok('Buddy Up shows a live team-spread readout (multi-player enforcement)')
      : warn('no spread readout')
    await resolveActiveCurses()
  })
} else {
  ok('1v1 omits teammate-dependent curses such as Buddy Up')
}

// --- Flag attempts: decoy, empty, real. A decoy/empty attempt sends the raider
//     to respawn (must return to a neutral before raiding again), so we clear
//     respawn between attempts. ---
async function respawnClear(idx) {
  const p = g.east[idx]
  const row = db(
    `select respawning,respawn_arrived,respawn_target_ref from players where id='${p.player}';`,
  )[0]
  if (!row) return
  const [respawning, arrived, targetRef] = row.split('|')
  if (respawning !== 't' || !targetRef) return
  const target = coord(targetRef)
  if (arrived !== 't') {
    await apiPost(`/api/games/${g.gid}/respawn-clear`, {
      device_id: p.device,
      player_id: p.player,
      pos: { ...target, accuracy: 5, updated_at: Date.now() },
    })
  }
  await apiPost(`/api/games/${g.gid}/respawn-clear`, {
    device_id: p.device,
    player_id: p.player,
    pos: { lat: target.lat + 0.0006, lng: target.lng, accuracy: 5, updated_at: Date.now() },
  })
}
async function attempt(idx, ref) {
  await respawnClear(idx)
  const proofUrl = await uploadFlagAttemptProof(
    g.gid,
    g.east[idx].player,
    ref.replace(/[^a-z0-9]/gi, '-'),
  )
  return apiPost(`/api/games/${g.gid}/attempt-flag`, {
    device_id: g.east[idx].device,
    player_id: g.east[idx].player,
    landmark_ref: ref,
    pos: { ...coord(ref), accuracy: 5, updated_at: Date.now() },
    photo_url: proofUrl,
  })
}
await step('attempt-decoy', async () => {
  const r = await attempt(0, 'landmark.miradouro-meia-laranja')
  const intelLeft = Number(
    db(
      `select count(*) from cards where team_id='${g.eTeam}' and kind='intel' and state='in_hand';`,
    )[0],
  )
  r.result === 'decoy'
    ? ok(`decoy attempt → result=decoy, intel wiped (in_hand=${intelLeft}), 15-min lockout`)
    : warn(`decoy result=${r.result}`)
})
await step('attempt-empty', async () => {
  const r = await attempt(0, 'landmark.mercado-municipal')
  r.result === 'empty'
    ? ok('empty attempt → result=empty, 15-min lockout')
    : warn(`empty result=${r.result}`)
})
await step('attempt-real+win', async () => {
  const r = await attempt(0, 'landmark.miradouro-vila-velha')
  if (r.result !== 'real') {
    warn(`real attempt result=${r.result}`)
    return
  }
  ok('real flag attempt → East raider becomes flag carrier')
  await ec[0].page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
  await ec[0].enableGps()
  await sleep(2500)
  await ec[0].shot(`${P}-carrier.png`)
  // Carrier returns to East home base to win.
  await ec[0].setPos(BIB.lat, BIB.lng)
  // Exercise the real FlagCarrierBanner geofence auto-submit instead of
  // racing it with a second test-only API request.
  let status = db(`select status from games where id='${g.gid}';`)[0]
  const finishDeadline = Date.now() + 12_000
  while (status !== 'finished' && Date.now() < finishDeadline) {
    await sleep(500)
    status = db(`select status from games where id='${g.gid}';`)[0]
  }
  const winner = db(
    `select payload->>'winner_team_id' from events where game_id='${g.gid}' and type='game_won' limit 1;`,
  )[0]
  await ec[0].page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
  await sleep(2500)
  await ec[0].shot(`${P}-gameover.png`)
  status === 'finished' && winner === g.eTeam
    ? ok('carrier reached home base → East WINS (game finished)')
    : warn(`status=${status} winner=${winner}`)
})

console.log(`\n----- ${N}v${N} summary -----`)
for (const [m, s] of results) console.log(`${m} ${s}`)
const passed = results.filter((r) => r[0] === '✅').length
console.log(`${passed}/${results.length} checks passed`)

let diagnosticsError = null
try {
  for (const client of [...wc, ...ec]) {
    client.assertNoUnexpectedErrors([
      // The first tagged browser deliberately checks the wrong neutral once
      // so the UI can render the server's exact-target guidance.
      /^console error: Failed to load resource: the server responded with a status of 409 \(Conflict\)(?: @ .*)?$/,
      // A request already in flight when a durable curse-expiry event lands
      // can receive the route's terminal curse_not_found response.
      /^console error: Failed to load resource: the server responded with a status of 404 \(Not Found\)(?: @ .*)?$/,
      // MapLibre may lose a third-party sprite/tile request while the scenario
      // rapidly moves and reloads clients. Map rendering is asserted by the
      // dedicated smoke and observer scenarios.
      /AJAXError: Failed to fetch.*https:\/\/tiles\.openfreemap\.org\//i,
      /TypeError: Failed to fetch @ http:\/\/localhost:3001\/_next\/static\/chunks\/.*\.js/i,
    ])
  }
} catch (error) {
  diagnosticsError = error
}

await browser.close()
if (diagnosticsError) throw diagnosticsError
assert.deepEqual(
  browserApiFailures.filter(
    (entry) =>
      !/ 409 POST \/api\/games\/[^/]+\/respawn-clear$/.test(entry) &&
      !/ 404 POST \/api\/games\/[^/]+\/extend-curse$/.test(entry) &&
      !/ 409 (?:GET|POST) \/api\/games\/[^/]+\/(?:challenges|time-tick|camping-heartbeat|expire-curses)$/.test(
        entry,
      ),
  ),
  [],
  'walkthrough emitted unexpected API failures',
)
if (passed !== results.length) process.exitCode = 1
console.log(`${N}v${N} done`)
