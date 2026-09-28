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

import { existsSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const __dir = dirname(fileURLToPath(import.meta.url))
export const BASE = process.env.SIM_BASE || 'http://localhost:3001'
export const SHOTS = resolve(__dir, 'shots')

const LANDMARKS = JSON.parse(readFileSync(resolve(__dir, '../../data/landmarks.json'), 'utf8'))

const envFile = readFileSync(resolve(__dir, '../../.env.local'), 'utf8')
function localEnv(name) {
  const line = envFile.split(/\r?\n/).find((row) => row.startsWith(`${name}=`))
  if (!line) throw new Error(`missing ${name} in .env.local`)
  return line.slice(name.length + 1).replace(/^['"]|['"]$/g, '')
}

const simSupabase = createClient(
  localEnv('NEXT_PUBLIC_SUPABASE_URL'),
  localEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
)
const simAdmin = createClient(
  localEnv('NEXT_PUBLIC_SUPABASE_URL'),
  localEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } },
)
export const adminRpc = (name, args) => simAdmin.rpc(name, args)

// A real, valid 1×1 PNG object used for setup-time I7 surroundings uploads.
// Browser scenarios that exercise the file picker replace this with a full
// screenshot, while API-assisted setup uses this tiny deterministic fixture.
const PROOF_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

export async function uploadSurroundingsPhoto(gameId, teamId, tag = String(Date.now())) {
  const path = `${gameId}/${teamId}/sim-${tag}-${Math.random().toString(36).slice(2)}.png`
  const { error } = await simSupabase.storage
    .from('surroundings-photos')
    .upload(path, PROOF_PNG, { contentType: 'image/png', upsert: false })
  if (error) throw error
  return path
}
async function uploadPublicProof(bucket, gameId, playerId, tag = String(Date.now())) {
  const path = `${gameId}/${playerId}-${tag}-${Math.random().toString(36).slice(2)}.png`
  const { error } = await simSupabase.storage
    .from(bucket)
    .upload(path, PROOF_PNG, { contentType: 'image/png', upsert: false })
  if (error) throw error
  return simSupabase.storage.from(bucket).getPublicUrl(path).data.publicUrl
}
export const uploadChallengeProof = (gameId, playerId, tag) =>
  uploadPublicProof('challenge-photos', gameId, playerId, tag)
export const uploadFlagAttemptProof = (gameId, playerId, tag) =>
  uploadPublicProof('flag-attempts', gameId, playerId, tag)
export function coord(ref) {
  const l = LANDMARKS.find((x) => x.id === ref)
  if (!l) throw new Error(`no landmark ${ref}`)
  return { lat: l.lat, lng: l.lng }
}

// Fixed flag assignments used by setupLiveGame (1 real / 2 decoy / 2 empty).
export const WEST_ASSIGN = [
  { landmark_ref: 'landmark.miradouro-vila-velha', role: 'real' },
  { landmark_ref: 'landmark.miradouro-meia-laranja', role: 'decoy' },
  { landmark_ref: 'landmark.estacao-ferroviaria', role: 'decoy' },
  { landmark_ref: 'landmark.mercado-municipal', role: 'empty' },
  { landmark_ref: 'landmark.parque-florestal', role: 'empty' },
]
export const EAST_ASSIGN = [
  { landmark_ref: 'landmark.biblioteca-municipal', role: 'real' },
  { landmark_ref: 'landmark.igreja-sao-pedro', role: 'decoy' },
  { landmark_ref: 'landmark.jardim-da-carreira', role: 'decoy' },
  { landmark_ref: 'landmark.capela-sao-lazaro', role: 'empty' },
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

  const w2Device = `sim-w2-${tag}`
  const w2Join = await apiPost(`/api/games/${gid}/join`, {
    display_name: 'West 2',
    device_id: w2Device,
    preferred_side: 'west',
  })
  const w2Player = w2Join.player?.id ?? w2Join.me?.id ?? w2Join.id
  const join = await apiPost(`/api/games/${gid}/join`, {
    display_name: 'East',
    device_id: eDevice,
    preferred_side: 'east',
  })
  const ePlayer = join.player?.id ?? join.me?.id ?? join.id
  const e2Device = `sim-e2-${tag}`
  const e2Join = await apiPost(`/api/games/${gid}/join`, {
    display_name: 'East 2',
    device_id: e2Device,
    preferred_side: 'east',
  })
  const e2Player = e2Join.player?.id ?? e2Join.me?.id ?? e2Join.id

  for (const p of [
    { player: wPlayer, device: wDevice },
    { player: w2Player, device: w2Device },
    { player: ePlayer, device: eDevice },
    { player: e2Player, device: e2Device },
  ]) {
    await apiPost(`/api/games/${gid}/ready`, {
      player_id: p.player,
      device_id: p.device,
      ready: true,
    })
  }
  await apiPost(`/api/games/${gid}/start`, { device_id: wDevice })
  const westPhoto = await uploadSurroundingsPhoto(gid, wTeam, `${tag}-west`)
  await apiPost(`/api/games/${gid}/flag-setup`, {
    device_id: wDevice,
    assignments: WEST_ASSIGN,
    surroundings_photo_path: westPhoto,
  })
  const eastPhoto = await uploadSurroundingsPhoto(gid, eTeam, `${tag}-east`)
  await apiPost(`/api/games/${gid}/flag-setup`, {
    device_id: eDevice,
    assignments: EAST_ASSIGN,
    surroundings_photo_path: eastPhoto,
  })
  return {
    gid,
    code,
    wPlayer,
    ePlayer,
    wTeam,
    eTeam,
    wDevice,
    eDevice,
    w2Player,
    e2Player,
    w2Device,
    e2Device,
  }
}

// Docker environment for the psql shell-out.
//
// Some sandboxes deny access to ~/.docker/config.json, which makes a bare
// `docker` invocation fail with "Cannot connect to the Docker daemon" even
// though the daemon socket is reachable. Point DOCKER_CONFIG at a scratch dir
// and name the socket explicitly — but only as a FALLBACK: an environment that
// already exports either variable (or needs neither, e.g. stock Docker Desktop
// on CI) keeps its own values.
function dockerEnv() {
  const env = { ...process.env }
  if (!env.DOCKER_CONFIG) {
    env.DOCKER_CONFIG = `${env.TMPDIR || '/tmp'}/dockercfg`
  }
  if (!env.DOCKER_HOST) {
    // Rancher Desktop's socket. Only used when nothing else is configured; if
    // it is absent, docker falls back to its own default socket resolution.
    const rancherSocket = `${env.HOME}/.rd/docker.sock`
    if (existsSync(rancherSocket)) env.DOCKER_HOST = `unix://${rancherSocket}`
  }
  return env
}

// Direct DB access (local container) for clock control + curse injection +
// assertions the API doesn't expose.
export function db(sql) {
  const out = execSync(
    `docker exec supabase_db_jet-lag-the-game-vr psql -U postgres -d postgres -tAc ${JSON.stringify(sql)}`,
    { encoding: 'utf8', env: dockerEnv() },
  )
  return out.split('\n').filter((l) => l && !/^(INSERT|UPDATE|DELETE|SELECT) \d/.test(l))
}
/**
 * Run a multi-statement script (transactions, psql meta-commands) through
 * stdin. `db()` uses -c, which cannot carry a BEGIN/COMMIT block.
 */
export function dbScript(sql) {
  return execSync(
    `docker exec -i supabase_db_jet-lag-the-game-vr psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f -`,
    { encoding: 'utf8', env: dockerEnv(), input: sql },
  )
}
// Backdate started_at so the 30-min flag-attempt protection window is over and
// time-bonus intervals have elapsed.
//
// Prefer advanceClock() from ./clock.mjs for anything beyond the game spine:
// this helper moves games.started_at ONLY, so curse timers, event-derived
// lockouts/cooldowns and camping state stay where they were.
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
  const westPhoto = await uploadSurroundingsPhoto(gid, wTeam, `${tag}-west`)
  await apiPost(`/api/games/${gid}/flag-setup`, {
    device_id: west[0].device,
    assignments: WEST_ASSIGN,
    surroundings_photo_path: westPhoto,
  })
  const eastPhoto = await uploadSurroundingsPhoto(gid, eTeam, `${tag}-east`)
  await apiPost(`/api/games/${gid}/flag-setup`, {
    device_id: east[0].device,
    assignments: EAST_ASSIGN,
    surroundings_photo_path: eastPhoto,
  })
  return { gid, code, wTeam, eTeam, west, east }
}

export async function launchBrowser() {
  return chromium.launch({ channel: 'chrome', headless: true })
}

// A browser client that "is" a given player (via localStorage device_id) with
// a controllable GPS position.
export async function makeClient(
  browser,
  { deviceId, lat, lng, locale = 'en', notifications = false, accuracy = 8 },
) {
  const context = await browser.newContext({
    permissions: notifications ? ['geolocation', 'notifications'] : ['geolocation'],
    geolocation: { latitude: lat, longitude: lng, accuracy },
    viewport: { width: 430, height: 880 },
    deviceScaleFactor: 2,
  })
  await context.addInitScript(
    ([id, loc]) => {
      try {
        localStorage.setItem('device_id', id)
        if (!localStorage.getItem('jl_locale')) localStorage.setItem('jl_locale', loc)
      } catch {}
    },
    [deviceId, locale],
  )
  const page = await context.newPage()
  const diagnostics = []
  page.on('pageerror', (e) => {
    diagnostics.push(`pageerror: ${e.message}`)
    console.log(`  [pageerror ${deviceId}] ${e.message}`)
  })
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      const location = message.location().url
      const suffix = location ? ` @ ${location}` : ''
      diagnostics.push(`console ${message.type()}: ${message.text()}${suffix}`)
      console.log(`  [console ${deviceId}] ${message.type()}: ${message.text()}${suffix}`)
    }
  })

  const client = {
    context,
    page,
    deviceId,
    diagnostics,
    async goto(path) {
      await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
    },
    // Teleport. Accuracy is now settable so scenarios can model an urban
    // canyon (25 m) instead of the old hardcoded perfect 8 m; existing callers
    // that pass two arguments keep the previous behaviour.
    async setPos(la, ln, acc = 8) {
      await context.setGeolocation({ latitude: la, longitude: ln, accuracy: acc })
    },
    async enableGps() {
      let btn = page.getByRole('button', { name: /Enable GPS|GPS: ON|Ativar GPS/i })
      let settings = null
      if (!(await btn.first().isVisible().catch(() => false))) {
        await page.getByRole('button', { name: /Open settings|Abrir definições/i }).click()
        settings = page.getByRole('dialog', { name: /Settings|Definições/i })
        await settings.waitFor({ state: 'visible', timeout: 15000 })
        btn = settings.getByRole('switch', { name: /Enable GPS|Disable GPS|Ativar GPS|Desativar GPS/i })
      }
      await btn.first().waitFor({ state: 'visible', timeout: 15000 })
      const label = (await btn.first().getAttribute('aria-label')) ?? (await btn.first().innerText()).trim()
      if (/Enable GPS|Ativar GPS/i.test(label)) {
        // Dispatch directly: enabling GPS can immediately trigger a geofence
        // transition and mount a result overlay over the button before
        // Playwright's hit-tested click finishes waiting for actionability.
        await btn.first().evaluate((element) => element.click())
      }
      if (settings) {
        await settings.getByRole('button', { name: /Close|Fechar/i }).click()
      }
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
      // Playwright's default caret hiding mutates input styles. With React 19's
      // faster hydration diagnostics, an early screenshot can otherwise race
      // hydration and produce a false `caret-color: transparent` mismatch.
      await page.screenshot({
        path: resolve(SHOTS, file),
        caret: 'initial',
      })
      return resolve(SHOTS, file)
    },
    assertNoUnexpectedErrors(allowed = []) {
      const unexpected = diagnostics.filter(
        (entry) => !allowed.some((pattern) => pattern.test(entry)),
      )
      if (unexpected.length > 0) {
        throw new Error(`${deviceId} browser diagnostics:\n${unexpected.join('\n')}`)
      }
    },
  }
  return client
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
