// Spectator + PWA shell end-to-end scenario.
//
// Verifies the read-only observer across browser -> API -> database -> realtime
// and checks that the install metadata/service worker assets are consumable by
// Chrome. The game itself is created through the production API.

import { mkdirSync } from 'node:fs'
import {
  BASE,
  SHOTS,
  apiGet,
  apiPost,
  backdateStart,
  launchBrowser,
  makeGameN,
} from './harness.mjs'

mkdirSync(SHOTS, { recursive: true })

function assert(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`  ✅ ${message}`)
}

console.log('\n===== OBSERVER + PWA =====')
const game = await makeGameN(2, 2, `observer-${Date.now()}`)
backdateStart(game.gid, 31)

const browser = await launchBrowser()
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  permissions: ['notifications'],
})
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))

await page.goto(`${BASE}/observer/${game.code}`, { waitUntil: 'domcontentloaded' })
await page.getByText('Scoreboard').waitFor({ state: 'visible', timeout: 20_000 })
await page.waitForSelector('.leaflet-container', { timeout: 20_000 })

assert(await page.getByText('Team West').count() === 1, 'observer renders Team West')
assert(await page.getByText('Team East').count() === 1, 'observer renders Team East')
assert(await page.getByText('Live feed').count() === 1, 'observer renders the live event feed')

const snapshot = await apiGet(`/api/games/${game.gid}/observer-state`)
assert(snapshot.players.length === 4, 'observer API returns all four players')
assert(snapshot.landmarks.length === 10, 'observer API returns ten selected candidate landmarks')
assert(
  snapshot.landmarks.every((landmark) => !('kind' in landmark) && !('hardened' in landmark)),
  'observer landmarks redact flag kind and hardening',
)
assert(!('cards' in snapshot) && !('active_curses' in snapshot), 'observer omits private cards and curses')

const westCoinsBefore = snapshot.teams.find((team) => team.id === game.wTeam).coins
await apiPost(`/api/games/${game.gid}/time-tick`, { device_id: game.west[0].device })
await page.waitForFunction(
  ({ before }) => {
    const cards = [...document.querySelectorAll('div.rounded-xl')]
    const west = cards.find((element) => element.textContent?.includes('Team West'))
    if (!west) return false
    const match = west.textContent?.match(/Coins\s*(\d+)/)
    return match ? Number(match[1]) > before : false
  },
  { before: westCoinsBefore },
  { timeout: 10_000 },
)
assert(true, 'observer refreshes team coins after a realtime event')

const manifestResponse = await page.request.get(`${BASE}/manifest.webmanifest`)
assert(manifestResponse.ok(), 'web app manifest is served')
const manifest = await manifestResponse.json()
assert(manifest.display === 'standalone' && manifest.start_url === '/', 'manifest has installable shell metadata')
assert(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'manifest declares an app icon')

const iconResponse = await page.request.get(`${BASE}${manifest.icons[0].src}`)
assert(iconResponse.ok(), 'manifest icon is served')
const workerResponse = await page.request.get(`${BASE}/sw.js`)
assert(workerResponse.ok(), 'Web Push service worker is served')

const workerState = await page.evaluate(async () => {
  const registration = await navigator.serviceWorker.register('/sw.js')
  const worker = registration.installing ?? registration.waiting ?? registration.active
  if (!worker) return 'missing'
  if (worker.state === 'activated') return worker.state
  return await new Promise((resolve) => {
    const timeout = window.setTimeout(() => resolve(worker.state), 8_000)
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') {
        window.clearTimeout(timeout)
        resolve(worker.state)
      }
    })
  })
})
assert(workerState === 'activated', 'service worker installs and activates in Chrome')

await page.screenshot({ path: `${SHOTS}/observer-pwa.png`, fullPage: true })
assert(pageErrors.length === 0, 'observer completes without browser runtime errors')

const missingPage = await context.newPage()
await missingPage.goto(`${BASE}/observer/AAAA`, { waitUntil: 'domcontentloaded' })
await missingPage.getByText('No such game').waitFor({ state: 'visible', timeout: 10_000 })
assert(true, 'observer gives a usable not-found state for an invalid game code')
await missingPage.close()

await context.close()
await browser.close()
console.log('observer + PWA done')
