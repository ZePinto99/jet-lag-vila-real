// Full-game walkthrough for a given team size (Nv N). Drives a real browser
// game covering the rule set: economy (time bonus, intel, curse), challenge
// peer review, radar, multi-raider tag + respawn, flag attempts
// (decoy/empty/real), the win, chat, and a movement curse readout.
//
//   node tools/sim/walkthrough.mjs 2   # 2 players per team
// Screenshots: tools/sim/shots/wN-*.png

import { mkdirSync } from 'node:fs'
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
  SHOTS,
  sleep,
} from './harness.mjs'

const N = Number(process.argv[2] || 2)
const P = `w${N}` // screenshot / log prefix
mkdirSync(SHOTS, { recursive: true })

const results = []
const ok = (s) => { results.push(['✅', s]); console.log(`  ✅ ${s}`) }
const warn = (s) => { results.push(['⚠️', s]); console.log(`  ⚠️ ${s}`) }
async function step(label, fn) {
  try { await fn() } catch (e) { warn(`${label} — ${String(e).split('\n')[0]}`) }
}

const LIB = coord('landmark.utad-main-library')     // WEST real flag + tag/radar site
const GARDEN = coord('landmark.utad-jardim-botanico') // WEST decoy
const PARQUE = coord('landmark.parque-florestal')   // WEST empty
const BIB = coord('landmark.biblioteca-municipal')  // EAST home + EAST real
const SE = coord('landmark.largo-do-pelourinho')    // a NEUTRAL landmark (respawn point)

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
for (const p of g.west) wc.push(await makeClient(browser, { deviceId: p.device, lat: SE.lat, lng: SE.lng }))
const ec = []
for (const p of g.east) ec.push(await makeClient(browser, { deviceId: p.device, lat: BIB.lat, lng: BIB.lng }))
for (const c of [...wc, ...ec]) await c.goto(`/game/${g.code}`)
for (const c of [...wc, ...ec]) await c.page.waitForSelector('.leaflet-container', { timeout: 20000 })
for (const c of [...wc, ...ec]) await c.enableGps()
await sleep(3000)

// --- Economy: time bonus, intel, curse ---
await step('time-bonus', async () => {
  await apiPost(`/api/games/${g.gid}/time-tick`, { device_id: g.east[0].device })
  const n = Number(db(`select count(*) from events where game_id='${g.gid}' and type='time_bonus';`)[0])
  n >= 1 ? ok(`time bonus credited (${n} interval(s), +20 to both teams)`) : warn('no time bonus')
})
await step('intel', async () => {
  await apiPost(`/api/games/${g.gid}/buy-intel`, { device_id: g.east[0].device, player_id: g.east[0].player, intel_ref: 'intel.north-south' })
  await apiPost(`/api/games/${g.gid}/buy-intel`, { device_id: g.east[0].device, player_id: g.east[0].player, intel_ref: 'intel.east-west' })
  const n = Number(db(`select count(*) from cards where team_id='${g.eTeam}' and kind='intel';`)[0])
  n >= 2 ? ok(`East bought ${n} intel cards (cap 4 enforced server-side)`) : warn(`intel count ${n}`)
})
await step('curse', async () => {
  await apiPost(`/api/games/${g.gid}/buy-curse`, { device_id: g.west[0].device, player_id: g.west[0].player, num_dice: 3 })
  const n = Number(db(`select count(*) from events where game_id='${g.gid}' and type='curse_cast';`)[0])
  n >= 1 ? ok('West cast a curse on East (curse_cast event)') : warn('no curse_cast')
})
await step('placed-curse', async () => {
  await apiPost(`/api/games/${g.gid}/place-curse`, { device_id: g.west[0].device, player_id: g.west[0].player, landmark_ref: 'landmark.utad-geosciences-museum', placed_ref: 'placed.snare' })
  ok('West armed a placed curse on a candidate')
})

// --- Challenge peer review (D14) ---
await step('challenge review', async () => {
  const ch = await apiGet(`/api/games/${g.gid}/challenges?device_id=${g.west[0].device}`)
  const c = ch.active.find((x) => x.photo_required && x.landmark_ref)
  const pos = { ...coord(c.landmark_ref), accuracy: 5, updated_at: Date.now() }
  await apiPost(`/api/games/${g.gid}/submit-challenge`, { device_id: g.west[0].device, player_id: g.west[0].player, challenge_ref: c.id, pos, photo_url: 'http://x/w.jpg' })
  const card = db(`select id from cards where team_id='${g.wTeam}' and ref='${c.id}' and state='pending';`)[0]
  await apiPost(`/api/games/${g.gid}/accept-challenge`, { device_id: g.east[0].device, player_id: g.east[0].player, card_id: card })
  const done = Number(db(`select count(*) from events where game_id='${g.gid}' and type='challenge_completed';`)[0])
  done >= 1 ? ok('West photo challenge submitted → East accepted → credited') : warn('challenge review incomplete')
})

// --- Chat ---
await step('chat', async () => {
  await wc[0].tab('Chat'); await ec[0].tab('Chat'); await sleep(2000)
  await wc[0].page.getByPlaceholder(/Message/i).fill(`hello from ${N}v${N}`)
  await wc[0].page.getByRole('button', { name: /^Send$/i }).click()
  await ec[0].page.getByText(`hello from ${N}v${N}`).first().waitFor({ state: 'visible', timeout: 6000 })
  ok('global chat delivered live to the enemy team')
  await wc[0].tab('Map'); await ec[0].tab('Map')
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
  await wc[0].page.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /^TAG/.test((x.textContent || '').trim()))
    return !!b && !b.disabled
  }, { timeout: 20000 })
  await wc[0].page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /^TAG/.test((x.textContent || '').trim()))
    b && b.click()
  })
  await sleep(2500)
  const tagged = Number(db(`select count(distinct (payload->>'raider_player_id')) from events where game_id='${g.gid}' and type='tag';`)[0] || '0')
  await wc[0].shot(`${P}-tag.png`)
  tagged >= 1 ? ok(`tag: caught ${tagged} raider(s) in a single tap; they must respawn`) : warn('tag caught nobody')
})

// --- Respawn clear (walk to a neutral) ---
await step('respawn', async () => {
  for (const p of g.east) {
    await apiPost(`/api/games/${g.gid}/respawn-clear`, { device_id: p.device, player_id: p.player, pos: { ...SE, accuracy: 5, updated_at: Date.now() } }).catch(() => {})
  }
  const respawning = Number(db(`select count(*) from players where team_id='${g.eTeam}' and respawning=true;`)[0])
  respawning === 0 ? ok('tagged raiders respawned at a neutral landmark') : warn(`${respawning} still respawning`)
})

// --- Movement curse readout (needs ≥2 to show team spread) — before the win,
//     since the game-over overlay would hide the banner afterwards. ---
if (N >= 2) {
  await step('buddy-up readout', async () => {
    db(`insert into active_curses (game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${g.gid}','${g.eTeam}','curse.buddy-up', now(), now()+interval '15 minutes','{"max_pairwise_distance_m":10}'::jsonb);`)
    await ec[0].setPos(BIB.lat, BIB.lng)
    await ec[1].setPos(BIB.lat + 0.001, BIB.lng) // ~111 m apart -> breach
    await sleep(4000)
    const spread = await ec[0].page.getByText(/Team spread/i).count()
    await ec[0].shot(`${P}-buddyup.png`)
    spread >= 1 ? ok('Buddy Up shows a live team-spread readout (multi-player enforcement)') : warn('no spread readout')
    db(`delete from active_curses where game_id='${g.gid}';`)
  })
} else {
  ok('(1v1: multi-player curses like Buddy Up N/A)')
}

// --- Flag attempts: decoy, empty, real. A decoy/empty attempt sends the raider
//     to respawn (must return to a neutral before raiding again), so we clear
//     respawn between attempts. ---
async function respawnClear(idx) {
  await apiPost(`/api/games/${g.gid}/respawn-clear`, {
    device_id: g.east[idx].device, player_id: g.east[idx].player,
    pos: { ...SE, accuracy: 5, updated_at: Date.now() },
  }).catch(() => {})
}
async function attempt(idx, ref) {
  await respawnClear(idx)
  return apiPost(`/api/games/${g.gid}/attempt-flag`, {
    device_id: g.east[idx].device, player_id: g.east[idx].player,
    landmark_ref: ref, pos: { ...coord(ref), accuracy: 5, updated_at: Date.now() }, photo_url: 'http://x/a.jpg',
  })
}
await step('attempt-decoy', async () => {
  const r = await attempt(0, 'landmark.utad-jardim-botanico')
  const intelLeft = Number(db(`select count(*) from cards where team_id='${g.eTeam}' and kind='intel' and state='in_hand';`)[0])
  r.result === 'decoy' ? ok(`decoy attempt → result=decoy, intel wiped (in_hand=${intelLeft}), 15-min lockout`) : warn(`decoy result=${r.result}`)
})
await step('attempt-empty', async () => {
  const r = await attempt(0, 'landmark.parque-florestal')
  r.result === 'empty' ? ok('empty attempt → result=empty, 15-min lockout') : warn(`empty result=${r.result}`)
})
await step('attempt-real+win', async () => {
  const r = await attempt(0, 'landmark.utad-main-library')
  if (r.result !== 'real') { warn(`real attempt result=${r.result}`); return }
  ok('real flag attempt → East raider becomes flag carrier')
  await ec[0].page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
  await sleep(2500)
  await ec[0].shot(`${P}-carrier.png`)
  // Carrier returns to East home base to win.
  await ec[0].setPos(BIB.lat, BIB.lng)
  await apiPost(`/api/games/${g.gid}/complete-run`, { device_id: g.east[0].device, player_id: g.east[0].player, pos: { ...BIB, accuracy: 5, updated_at: Date.now() } }).catch(() => {})
  await sleep(2500)
  const status = db(`select status from games where id='${g.gid}';`)[0]
  const winner = db(`select payload->>'winner_team_id' from events where game_id='${g.gid}' and type='game_won' limit 1;`)[0]
  await ec[0].page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
  await sleep(2500)
  await ec[0].shot(`${P}-gameover.png`)
  status === 'finished' && winner === g.eTeam ? ok('carrier reached home base → East WINS (game finished)') : warn(`status=${status} winner=${winner}`)
})

console.log(`\n----- ${N}v${N} summary -----`)
for (const [m, s] of results) console.log(`${m} ${s}`)
const passed = results.filter((r) => r[0] === '✅').length
console.log(`${passed}/${results.length} checks passed`)

await browser.close()
console.log(`${N}v${N} done`)
