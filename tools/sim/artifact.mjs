// Structured run artifacts.
//
// Scenarios previously emitted stdout plus gitignored PNGs, which meant a
// failure could not be replayed or diffed. Every run now writes one JSON file
// containing: the seed, the resolved config, the full event log, the coin
// ledger, positions over time, and every check with its outcome.
//
// Artifacts land in tools/sim/artifacts/<scenario>-<seed>.json.

import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { db } from './harness.mjs'

const __dir = dirname(fileURLToPath(import.meta.url))
export const ARTIFACTS = resolve(__dir, 'artifacts')

export function makeRecorder({ scenario, seed, config = {} }) {
  mkdirSync(ARTIFACTS, { recursive: true })
  const started = new Date().toISOString()
  const checks = []
  const positions = []
  const clockJumps = []
  const notes = []
  let gameId = null
  let gameCode = null

  const rec = {
    get checks() {
      return checks
    },
    bindGame(gid, code) {
      gameId = gid
      gameCode = code
    },
    /** Record a pass/fail check. Returns the boolean so callers can branch. */
    check(label, passed, detail = null) {
      checks.push({ label, passed: !!passed, detail })
      console.log(`  ${passed ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`)
      return !!passed
    },
    note(text) {
      notes.push(text)
      console.log(`  ·  ${text}`)
    },
    position(deviceId, fix) {
      positions.push({ deviceId, ...fix })
    },
    clockJump(info) {
      clockJumps.push({ at: new Date().toISOString(), ...info })
    },
    /** Pull the authoritative event log + coin ledger straight from the DB. */
    snapshot() {
      if (!gameId) return { events: [], coins: [] }
      const events = db(
        `select type || '~' || coalesce(payload::text,'{}') from events where game_id='${gameId}' order by created_at, id;`,
      ).map((row) => {
        const i = row.indexOf('~')
        let payload = {}
        try {
          payload = JSON.parse(row.slice(i + 1))
        } catch {}
        return { type: row.slice(0, i), payload }
      })
      const coins = db(
        `select side || '|' || coins from teams where game_id='${gameId}' order by side;`,
      ).map((r) => {
        const [side, c] = r.split('|')
        return { side, coins: Number(c) }
      })
      return { events, coins }
    },
    /** Write the artifact. Returns its path and the failure count. */
    finish(extra = {}) {
      const { events, coins } = rec.snapshot()
      const failed = checks.filter((c) => !c.passed)
      const artifact = {
        scenario,
        seed,
        started,
        finished: new Date().toISOString(),
        gameId,
        gameCode,
        config,
        summary: {
          checks: checks.length,
          passed: checks.length - failed.length,
          failed: failed.length,
        },
        checks,
        notes,
        clockJumps,
        coinLedger: coins,
        events,
        positions,
        ...extra,
      }
      const file = resolve(ARTIFACTS, `${scenario}-${seed}.json`)
      writeFileSync(file, JSON.stringify(artifact, null, 2))
      console.log(
        `\n${checks.length - failed.length}/${checks.length} checks passed — artifact: ${file}`,
      )
      if (failed.length > 0) {
        console.log('FAILED CHECKS:')
        for (const f of failed) console.log(`  ❌ ${f.label}${f.detail ? ` — ${f.detail}` : ''}`)
      }
      return { file, failed: failed.length }
    },
  }
  return rec
}

/**
 * Strict step wrapper.
 *
 * walkthrough.mjs's step() downgrades a thrown assertion to a warning and keeps
 * going (walkthrough.mjs:44-50). That is the right call for a release smoke run
 * — you want the whole matrix's worth of signal from one pass — but it is wrong
 * for an evaluation, where a swallowed throw reads as "mechanic works".
 *
 * So: the error is recorded as a FAILED CHECK (never a warning) and the run
 * continues to gather the rest of the evidence, but finish() reports a non-zero
 * failure count and the caller exits non-zero. Nothing is downgraded; later
 * independent steps still get exercised.
 */
export async function strictStep(rec, label, fn) {
  try {
    await fn()
    return true
  } catch (e) {
    const first = String(e && e.message ? e.message : e).split('\n')[0]
    rec.check(label, false, first)
    return false
  }
}
