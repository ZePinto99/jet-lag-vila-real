// Two-client browser simulation harness for the Jet Lag: Vila Real PWA.
//
// Lets the agent drive N real browser clients against the LOCAL dev server
// (http://localhost:3001) with fully controllable GPS per client, so the
// client-side features (radar, notifications, curses UI, chat, confirm-spend,
// setup map) can be exercised and screenshotted.
//
// Uses the system Chrome via Playwright's `channel: 'chrome'` (no browser
// download needed). Game state is set up through the (already-verified) API so
// we jump straight to the phase under test; the browser then "becomes" a
// player by seeding its localStorage device_id.
//
// Run a scenario:  node tools/sim/scenario-<name>.mjs

import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright'

const __dir = dirname(fileURLToPath(import.meta.url))
export const BASE = process.env.SIM_BASE || 'http://localhost:3001'
export const SHOTS = resolve(__dir, 'shots')

const LANDMARKS = JSON.parse(
  readFileSync(resolve(__dir, '../../data/landmarks.json'), 'utf8'),
)
export function coord(ref) {
  const l = LANDMARKS.find((x) => x.id === ref)
  if (!l) throw new Error(`no landmark ${ref}`)
  return { lat: l.lat, lng: l.lng }
}

// Fixed flag assignments used by setupLiveGame (1 real / 2 decoy / 2 empty).
export const WEST_ASSIGN = [
  { landmark_ref: 'landmark.utad-main-library', role: 'real' },
  { landmark_ref: 'landmark.utad-jardim-botanico', role: 'decoy' },
  { landmark_ref: 'landmark.utad-geosciences-museum', role: 'decoy' },
  { landmark_ref: 'landmark.parque-florestal', role: 'empty' },
  { landmark_ref: 'landmark.igreja-da-conceicao', role: 'empty' },
]
export const EAST_ASSIGN = [
  { landmark_ref: 'landmark.biblioteca-municipal', role: 'real' },
  { landmark_ref: 'landmark.igreja-sao-pedro', role: 'decoy' },
  { landmark_ref: 'landmark.jardim-da-carreira', role: 'decoy' },
  { landmark_ref: 'landmark.largo-do-pioledo', role: 'empty' },
  { landmark_ref: 'landmark.escola-sao-pedro', role: 'empty' },
]

async function api(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await r.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }
  if (r.status >= 400) {
    throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 200)}`)
  }
  return json
}
export const apiPost = (p, b) => api('POST', p, b)
export const apiGet = (p) => api('GET', p)

// Drive the game from create -> live via the API. Returns identifiers +
// per-side device ids the browser clients should adopt.
export async function setupLiveGame(tag = String(Date.now())) {
  const wDevice = `sim-w-${tag}`
  const eDevice = `sim-e-${tag}`
  const create = await apiPost('/api/games', {
    display_name: 'West',
    device_id: wDevice,
    preferred_side: 'west',
  })
  const gid = create.game.id
  const code = create.game.code
  const wPlayer = create.me.id
  const wTeam = create.teams.find((t) => t.side === 'west').id
  const eTeam = create.teams.find((t) => t.side === 'east').id

  const join = await apiPost(`/api/games/${gid}/join`, {
    display_name: 'East',
    device_id: eDevice,
    preferred_side: 'east',
  })
  const ePlayer = join.player?.id ?? join.me?.id ?? join.id

  await apiPost(`/api/games/${gid}/ready`, {
    player_id: wPlayer,
    device_id: wDevice,
    ready: true,
  })
  await apiPost(`/api/games/${gid}/ready`, {
    player_id: ePlayer,
    device_id: eDevice,
    ready: true,
  })
  await apiPost(`/api/games/${gid}/start`, { device_id: wDevice })
  await apiPost(`/api/games/${gid}/flag-setup`, {
    device_id: wDevice,
    assignments: WEST_ASSIGN,
  })
  await apiPost(`/api/games/${gid}/flag-setup`, {
    device_id: eDevice,
    assignments: EAST_ASSIGN,
  })
  return { gid, code, wPlayer, ePlayer, wTeam, eTeam, wDevice, eDevice }
}

// Direct DB access (local container) for clock control + curse injection +
// assertions the API doesn't expose.
export function db(sql) {
  const out = execSync(
    `docker exec supabase_db_jet-lag-the-game-vr psql -U postgres -d postgres -tAc ${JSON.stringify(sql)}`,
    { encoding: 'utf8' },
  )
  return out
    .split('\n')
    .filter((l) => l && !/^(INSERT|UPDATE|DELETE|SELECT) \d/.test(l))
}
// Backdate started_at so the 30-min flag-attempt protection window is over and
// time-bonus intervals have elapsed.
export function backdateStart(gid, minutes) {
  db(`update games set started_at = now() - interval '${minutes} minutes' where id='${gid}';`)
}
export function teamCoins(code, side) {
  return apiGet(`/api/games/by-code/${code}`).then(
    (r) => r.teams.find((t) => t.side === side).coins,
  )
}

// Full game setup to LIVE with N players per team (preferred_side is always
// honored, so team sizes are exact). Returns per-side player/device arrays.
export async function makeGameN(westN, eastN, tag = String(Date.now())) {
  const create = await apiPost('/api/games', {
    display_name: 'W1',
    device_id: `w-${tag}-1`,
    preferred_side: 'west',
  })
  const gid = create.game.id
  const code = create.game.code
  const wTeam = create.teams.find((t) => t.side === 'west').id
  const eTeam = create.teams.find((t) => t.side === 'east').id
  const west = [{ device: `w-${tag}-1`, player: create.me.id, name: 'W1' }]
  for (let i = 2; i <= westN; i++) {
    const device = `w-${tag}-${i}`
    const j = await apiPost(`/api/games/${gid}/join`, {
      display_name: `W${i}`,
      device_id: device,
      preferred_side: 'west',
    })
    west.push({ device, player: j.player?.id ?? j.me?.id ?? j.id, name: `W${i}` })
  }
  const east = []
  for (let i = 1; i <= eastN; i++) {
    const device = `e-${tag}-${i}`
    const j = await apiPost(`/api/games/${gid}/join`, {
      display_name: `E${i}`,
      device_id: device,
      preferred_side: 'east',
    })
    east.push({ device, player: j.player?.id ?? j.me?.id ?? j.id, name: `E${i}` })
  }
  for (const p of [...west, ...east]) {
    await apiPost(`/api/games/${gid}/ready`, {
      player_id: p.player,
      device_id: p.device,
      ready: true,
    })
  }
  await apiPost(`/api/games/${gid}/start`, { device_id: west[0].device })
  await apiPost(`/api/games/${gid}/flag-setup`, {
    device_id: west[0].device,
    assignments: WEST_ASSIGN,
  })
  await apiPost(`/api/games/${gid}/flag-setup`, {
    device_id: east[0].device,
    assignments: EAST_ASSIGN,
  })
  return { gid, code, wTeam, eTeam, west, east }
}

export async function launchBrowser() {
  return chromium.launch({ channel: 'chrome', headless: true })
}

// A browser client that "is" a given player (via localStorage device_id) with
// a controllable GPS position.
export async function makeClient(browser, { deviceId, lat, lng, locale = 'en' }) {
  const context = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: lat, longitude: lng, accuracy: 8 },
    viewport: { width: 430, height: 880 },
    deviceScaleFactor: 2,
  })
  await context.addInitScript(
    ([id, loc]) => {
      try {
        localStorage.setItem('device_id', id)
        localStorage.setItem('jl_locale', loc)
      } catch {}
    },
    [deviceId, locale],
  )
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log(`  [pageerror ${deviceId}] ${e.message}`))

  const client = {
    context,
    page,
    deviceId,
    async goto(path) {
      await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
    },
    async setPos(la, ln) {
      await context.setGeolocation({ latitude: la, longitude: ln, accuracy: 8 })
    },
    async enableGps() {
      const btn = page.getByRole('button', { name: /Enable GPS|GPS: ON|Ativar GPS/i })
      await btn.first().waitFor({ state: 'visible', timeout: 15000 })
      const label = (await btn.first().innerText()).trim()
      if (/Enable GPS|Ativar GPS/i.test(label)) await btn.first().click()
    },
    async tab(name) {
      // Dispatch the click on the element directly — the bottom-nav "Map" cell
      // is partially covered by the compass control, which intercepts a normal
      // hit-tested click.
      await page
        .getByRole('button', { name: new RegExp(`^${name}`, 'i') })
        .first()
        .evaluate((el) => el.click())
    },
    async shot(file) {
      await page.screenshot({ path: resolve(SHOTS, file) })
      return resolve(SHOTS, file)
    },
  }
  return client
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
