#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BASE = process.env.SIM_BASE || 'http://localhost:3001'

// Keep this list explicit so a release run is reviewable and a newly added
// scenario cannot silently disappear behind a glob or platform-specific sort.
const runs = [
  ['scenario-api-rules.mjs'],
  ['scenario-lobby-ui.mjs'],
  ['scenario-setup.mjs'],
  ['scenario-smoke.mjs'],
  ['scenario-confirm-spend.mjs'],
  ['scenario-chat.mjs'],
  ['scenario-notifications.mjs'],
  ['scenario-radar.mjs'],
  ['scenario-push.mjs'],
  ['scenario-curses.mjs'],
  ['scenario-curse-proofs.mjs'],
  ['scenario-camping.mjs'],
  ['scenario-movement-curses.mjs'],
  ['scenario-curse-protocols.mjs'],
  ['scenario-hidden-reconcile.mjs'],
  ['scenario-realtime-resilience.mjs'],
  ['scenario-reconnect.mjs'],
  ['scenario-tag-raider.mjs'],
  ['scenario-i7-intel.mjs'],
  ['scenario-challenge-review-ui.mjs'],
  ['scenario-deep-snapshots.mjs'],
  ['scenario-weather-pause.mjs'],
  ['scenario-terminal-variants.mjs'],
  ['scenario-observer-pwa.mjs'],
  ['walkthrough.mjs', '1'],
  ['walkthrough.mjs', '2'],
  ['walkthrough.mjs', '3'],
  ['walkthrough.mjs', '4'],
]

function run(args) {
  return new Promise((resolve, reject) => {
    const label = args.join(' ')
    process.stdout.write(`\n========== ${label} ==========\n`)
    const child = spawn(process.execPath, args, {
      cwd: HERE,
      env: process.env,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${label} failed (${signal ?? `exit ${code}`})`))
    })
  })
}

async function waitForRuntimeReady() {
  const deadline = Date.now() + 60_000
  let last = 'not attempted'
  while (Date.now() < deadline) {
    try {
      const [page, database] = await Promise.all([
        fetch(`${BASE}/`),
        // A missing code should be a normal 404 only after Next and the
        // PostgREST schema cache are both ready following `supabase db reset`.
        fetch(`${BASE}/api/games/by-code/ZZZZ`),
      ])
      if (page.ok && database.status < 500) {
        process.stdout.write(`Runtime ready (${BASE}).\n`)
        return
      }
      last = `page=${page.status}, database=${database.status}`
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(`runtime did not become ready within 60s: ${last}`)
}

await waitForRuntimeReady()

const requestedStart = process.env.SIM_START_AT
const startIndex = requestedStart
  ? runs.findIndex(([script]) => script === requestedStart)
  : 0
if (requestedStart && startIndex === -1) {
  throw new Error(`unknown SIM_START_AT scenario: ${requestedStart}`)
}
const selectedRuns = runs.slice(startIndex)

for (const args of selectedRuns) {
  await run(args)
}

process.stdout.write(`\nAll ${selectedRuns.length} selected end-to-end runs passed.\n`)
