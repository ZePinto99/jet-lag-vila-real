// Curse coverage sweep: every entry in data/curses.json exercised through the
// mechanism it actually claims, not the mechanism its enforcement tag implies.
//
//   node tools/sim/scenario-curse-coverage.mjs [seed]
//
// Pure-API (no browser) so every assertion lands on SERVER authority.
//
// HOW A SPECIFIC CURSE IS FORCED
// ---------------------------------------------------------------------------
// buy-curse rolls d6 server-side with Math.random (buy-curse/route.ts:52), so
// the tier cannot be injected. But the SELECTION inside a tier is a pure
// filter (buy-curse/route.ts:271-280): tier ∧ enabled ∧ team-size ∧ not-active
// ∧ coin-drain-needs-coins ∧ intel-loss-needs-intel. So to real-cast curse X we
// make every OTHER member of X's tier ineligible (force it active, or zero the
// enemy resource it needs) and then reroll until the dice land in X's tier.
// Selection is then deterministic AND the whole production path runs —
// buildCurseCastParams, buy_curse_atomic, the ledger effects, the events.
// A raw `insert into active_curses` would skip all of that, so it is used only
// where the catalog value itself is the subject (pilgrimage's target landmark).
//
// Groups, by actual mechanism rather than by tag:
//   1. [B] photo-verified   single-file / photo-tax / outfit-swap / pose-patrol
//                           → /submit-curse-proof inside vs outside the window
//   2.     action lock      full-stop / pilgrimage  → 409 actions_locked
//   3. [L] ledger           coin-drain (-50) / intel-loss (1 card expired)
//   4.     honour-only      check-in / mute  → is there ANY server effect?
//   5. [A] readout          slow-walk / detour / buddy-up / frozen /
//                           solo-quarantine → row + params only
//   6.     frozen extend    /extend-curse max reachable duration
//   7.     eligibility      0 coins / 0 intel / min_team_size in 1v1,
//                           and the no_available_curse oracle (P6: tier echo removed,
//                           failed rolls now logged as curse_roll_failed)
//   8.     no-stack + expiry lifecycle

import { makeGameN, coord, apiGet, db, dbScript, sleep, BASE } from './harness.mjs'
import { advanceClock, advanceClockMinutes, clockSnapshot } from './clock.mjs'
import { makeRecorder, strictStep } from './artifact.mjs'
import { offsetMeters } from './movement.mjs'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dir = dirname(fileURLToPath(import.meta.url))
const CURSES = JSON.parse(readFileSync(resolve(__dir, '../../data/curses.json'), 'utf8'))
const CURSE_BY_ID = new Map(CURSES.map((c) => [c.id, c]))

const seed = Number(process.argv[2] || 20260924)
const rec = makeRecorder({ scenario: 'curse-coverage', seed })

// Dice-tier thresholds (buy-curse/route.ts:60-64): 1-3 minor, 4-8 medium, 9+
// major. The scenario never needs to recompute them — it reads the tier the
// route reports — but they explain the num_dice choices in castExactly.
//
// PHOTO_VERIFIED_CURSE_REFS, proofWindows.ts:3
const PHOTO_REFS = new Set([
  'curse.single-file',
  'curse.photo-tax',
  'curse.outfit-swap',
  'curse.pose-patrol',
])
const LEDGER_ONE_SHOT = new Set(['curse.coin-drain', 'curse.intel-loss'])

// A real 1x1 PNG — submit-curse-proof sniffs magic bytes (route.ts:38-46).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}
const freshPos = (p, accuracy = 6) => ({
  lat: p.lat,
  lng: p.lng,
  accuracy,
  updated_at: Date.now(),
})

async function postProof(gid, player, curseId, promptIndex) {
  const form = new FormData()
  form.set('device_id', player.device)
  form.set('player_id', player.player)
  form.set('curse_id', curseId)
  form.set('prompt_index', String(promptIndex))
  form.set('photo', new File([PNG], 'proof.png', { type: 'image/png' }))
  const res = await fetch(`${BASE}/api/games/${gid}/submit-curse-proof`, {
    method: 'POST',
    body: form,
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

const coinsOf = (teamId) => Number(db(`select coins from teams where id='${teamId}';`)[0])
const activeRefs = (gid, teamId) =>
  db(
    `select curse_ref from active_curses where game_id='${gid}' and target_team_id='${teamId}' order by curse_ref;`,
  )
/** One active_curses row as epoch-ms numbers + parsed params. */
function curseRow(curseId) {
  const raw = db(
    `select curse_ref||'~'||(extract(epoch from started_at)*1000)::bigint||'~'||coalesce((extract(epoch from expires_at)*1000)::bigint::text,'null')||'~'||params::text from active_curses where id='${curseId}';`,
  )[0]
  if (!raw) return null
  const [curse_ref, started, expires, params] = raw.split('~')
  return {
    id: curseId,
    curse_ref,
    started_at: new Date(Number(started)).toISOString(),
    startedMs: Number(started),
    expires_at: expires === 'null' ? null : new Date(Number(expires)).toISOString(),
    expiresMs: expires === 'null' ? null : Number(expires),
    params: JSON.parse(params),
  }
}
const curseIdOf = (gid, teamId, ref) =>
  db(
    `select id from active_curses where game_id='${gid}' and target_team_id='${teamId}' and curse_ref='${ref}';`,
  )[0] ?? null
const intelInHand = (gid, teamId) =>
  Number(
    db(
      `select count(*) from cards where game_id='${gid}' and team_id='${teamId}' and kind='intel' and state='in_hand';`,
    )[0],
  )

/**
 * Faithful port of lib/curses/proofWindows.ts getCurseProofWindow. Having the
 * arithmetic here (rather than only asserting the server's verdict) is what
 * makes "does the window survive a clock rebase" a measurement instead of a
 * tautology: we predict, then check the server agrees.
 */
function proofWindow(curse, nowMs) {
  if (!PHOTO_REFS.has(curse.curse_ref)) return null
  const startedMs = curse.startedMs
  const expiresMs = curse.expiresMs
  if (!Number.isFinite(startedMs) || nowMs < startedMs) return null
  if (expiresMs != null && nowMs >= expiresMs) return null
  const num = (k, d) => (typeof curse.params?.[k] === 'number' ? curse.params[k] : d)
  const elapsedS = Math.floor((nowMs - startedMs) / 1000)

  if (curse.curse_ref === 'curse.photo-tax' || curse.curse_ref === 'curse.pose-patrol') {
    const intervalS = Math.max(1, num('interval_seconds', 90))
    const windowS = Math.max(1, Math.min(intervalS, num('submission_window_seconds', 30)))
    const into = elapsedS % intervalS
    if (into >= windowS) return null
    return { promptIndex: Math.floor(elapsedS / intervalS), secondsLeft: windowS - into }
  }
  if (curse.curse_ref === 'curse.single-file') {
    const prompts = Math.max(1, Math.floor(num('prompts_per_curse', 2)))
    const durationS = Math.max(
      prompts,
      expiresMs == null ? 5 * 60 : Math.floor((expiresMs - startedMs) / 1000),
    )
    const segmentS = Math.max(1, Math.floor(durationS / prompts))
    const promptIndex = Math.min(prompts - 1, Math.floor(elapsedS / segmentS))
    const into = elapsedS - promptIndex * segmentS
    const windowS = Math.min(30, segmentS)
    if (into >= windowS) return null
    return { promptIndex, secondsLeft: windowS - into }
  }
  // outfit-swap: opening + closing dispute windows
  const windowS = Math.max(1, num('dispute_window_seconds', 60))
  if (elapsedS < windowS) return { promptIndex: 0, secondsLeft: windowS - elapsedS }
  if (expiresMs != null) {
    const remainingS = Math.max(0, Math.ceil((expiresMs - nowMs) / 1000))
    if (remainingS <= windowS) return { promptIndex: 1, secondsLeft: remainingS }
  }
  return null
}

/** Curse's age in whole seconds, straight from Postgres. */
const curseElapsedS = (curseId) =>
  Number(db(`select round(extract(epoch from (now() - started_at))) from active_curses where id='${curseId}';`)[0])

/**
 * Move the game clock so a specific curse reads `targetS` seconds old.
 * Landing mid-window (rather than blind-jumping a fixed delta) keeps the probe
 * robust against the real seconds the HTTP round-trips themselves consume.
 */
function advanceCurseTo(gid, curseId, targetS, reason) {
  const before = curseElapsedS(curseId)
  const delta = targetS - before
  if (delta > 0) {
    advanceClock(gid, delta)
    rec.clockJump({ seconds: delta, reason })
  }
  return curseElapsedS(curseId)
}

const eligibleInTier = (tier, teamSize) =>
  CURSES.filter(
    (c) => c.tier === tier && c.enabled !== false && (c.min_team_size ?? 1) <= teamSize,
  )

/**
 * Make every curse of `tier` except `exceptRef` ineligible for the enemy team,
 * so the route's own filter can only pick `exceptRef`.
 *
 * Active rows are inserted with a long expiry (the route's activeRefs filter
 * keeps only expires_at > now, buy-curse/route.ts:247-255). coin-drain and
 * intel-loss leave no row, so they are blocked by zeroing the enemy resource
 * their eligibility predicate reads.
 */
function blockTierExcept(gid, enemyTeamId, tier, exceptRef, teamSize) {
  const targets = eligibleInTier(tier, teamSize).filter(
    (c) => c.id !== exceptRef && !LEDGER_ONE_SHOT.has(c.id),
  )
  if (targets.length > 0) {
    dbScript(
      targets
        .map(
          (c) =>
            `insert into active_curses (game_id, target_team_id, curse_ref, started_at, expires_at, params) values ('${gid}','${enemyTeamId}','${c.id}', now(), now() + interval '150 minutes', '{"sim_blocker":true}'::jsonb) on conflict (game_id, target_team_id, curse_ref) do nothing;`,
        )
        .join('\n'),
    )
  }
  return targets.map((c) => c.id)
}

/**
 * Remove the synthetic steering rows.
 *
 * This matters for more than tidiness: a major-tier steer installs Full Stop
 * and Pilgrimage as blockers, and those two ARE the action lock
 * (actionLock.ts:11). Leaving them in place would make every later "the cursed
 * team can still act" probe 409 for the wrong reason. Blockers exist only to
 * pin the route's selection during the cast, so they come out immediately after.
 */
function clearBlockers(gid, enemyTeamId) {
  db(
    `delete from active_curses where game_id='${gid}' and target_team_id='${enemyTeamId}' and params->>'sim_blocker' = 'true';`,
  )
}

/**
 * Recover the tier of the most recent refused roll from the server's own
 * `curse_roll_failed` event (finding P6 removed the tier from the HTTP body).
 * The event deliberately stores only the buyer's team and their own dice, so we
 * re-derive the tier from dice_total exactly as buy-curse/route.ts does.
 */
function lastRefusedTier(gid, buyerTeamId) {
  const rows = db(
    `select payload->>'dice_total' from events where game_id='${gid}' and type='curse_roll_failed' and payload->>'team_id'='${buyerTeamId}' order by created_at desc limit 1;`,
  )
  const total = Number(String(rows[0] ?? rows))
  if (!Number.isFinite(total)) return undefined
  if (total <= 3) return 'minor'
  if (total <= 8) return 'medium'
  return 'major'
}

/**
 * Roll buy-curse until the dice land in `tier`, refunding the buyer and
 * discarding any wrong-tier cast so the eligibility state stays pinned.
 * Returns the successful response body, or the terminal 409 for `tier`.
 */
async function rollForTier(gid, buyer, buyerTeamId, enemyTeamId, tier, numDice, tries = 80) {
  const observed = []
  for (let i = 0; i < tries; i++) {
    db(`update teams set coins = 9000 where id='${buyerTeamId}';`)
    const r = await post(`/api/games/${gid}/buy-curse`, {
      device_id: buyer.device,
      player_id: buyer.player,
      num_dice: numDice,
    })
    if (r.status === 409 && r.body.error === 'no_available_curse') {
      // Finding P6: the 409 no longer echoes the rolled tier back to the buyer,
      // because that told a free prober which bucket of hidden enemy state had
      // been exhausted. The tier is still recoverable HERE only because the sim
      // reads the server's own `curse_roll_failed` event with admin DB access —
      // a player cannot do this from the response.
      const refusedTier = lastRefusedTier(gid, buyerTeamId)
      observed.push(`409:${refusedTier}`)
      if (refusedTier === tier) return { ok: false, r, observed }
      continue
    }
    if (r.status >= 400) return { ok: false, r, observed, hardError: true }
    observed.push(`${r.body.tier}:${r.body.curse_ref}`)
    if (r.body.tier === tier) return { ok: true, r, observed }
    // Wrong tier. Roll it back so the next attempt sees identical state.
    // Wrong-tier casts are never coin-drain/intel-loss when tier==='major',
    // and when tier is minor/medium the majors are blocked, so no ledger
    // effect can have fired here.
    db(
      `delete from active_curses where game_id='${gid}' and target_team_id='${enemyTeamId}' and curse_ref='${r.body.curse_ref}';`,
    )
  }
  return { ok: false, observed, exhausted: true }
}

/**
 * Real-cast exactly `ref` (see the header note on forcing), then remove the
 * steering rows unless the caller still needs the tier pinned.
 */
async function castExactly(gid, buyer, buyerTeamId, enemyTeamId, ref, teamSize, opts = {}) {
  const def = CURSE_BY_ID.get(ref)
  if (!def) throw new Error(`unknown curse ${ref}`)
  const numDice = def.tier === 'major' ? 3 : def.tier === 'minor' ? 1 : 2
  blockTierExcept(gid, enemyTeamId, def.tier, ref, teamSize)

  // A MEDIUM cast rolls 2 dice, which reach 9-12 (27.8% per roll) and therefore
  // land on the MAJOR tier. That matters because rollForTier can only undo a
  // wrong-tier cast by deleting its active_curses row — and coin-drain /
  // intel-loss are one-shot LEDGER effects with no row, so a stray major roll
  // permanently debits 50 enemy coins or expires an enemy intel card. That
  // corrupted the "enemy coins/intel untouched by the cast" assertions in
  // group 4 non-deterministically, depending purely on the dice.
  //
  // So for any non-major cast, also pin the major tier: install row blockers
  // for the four majors that have rows, and starve the two ledger one-shots by
  // zeroing the predicates their eligibility reads. Both are restored below, so
  // the caller still observes the enemy's real pre-cast coins and intel.
  const restore = []
  if (def.tier !== 'major') {
    blockTierExcept(gid, enemyTeamId, 'major', '__none__', teamSize)
    const coins = Number(db(`select coins from teams where id='${enemyTeamId}';`)[0])
    if (coins > 0) {
      db(`update teams set coins = 0 where id='${enemyTeamId}';`)
      restore.push(`update teams set coins = ${coins} where id='${enemyTeamId}';`)
    }
    const heldIds = db(
      `select id from cards where game_id='${gid}' and team_id='${enemyTeamId}' and kind='intel' and state='in_hand';`,
    ).filter(Boolean)
    if (heldIds.length > 0) {
      const list = heldIds.map((id) => `'${String(id)}'`).join(',')
      db(`update cards set state='consumed' where id in (${list});`)
      restore.push(`update cards set state='in_hand' where id in (${list});`)
    }
  } else {
    // coin-drain / intel-loss have no row to block: starve their predicates.
    if (ref !== 'curse.coin-drain' && opts.keepEnemyCoins !== true) {
      db(`update teams set coins = 0 where id='${enemyTeamId}';`)
    }
    if (ref !== 'curse.intel-loss') {
      db(
        `update cards set state='consumed' where game_id='${gid}' and team_id='${enemyTeamId}' and kind='intel' and state='in_hand';`,
      )
    }
  }

  const out = await rollForTier(gid, buyer, buyerTeamId, enemyTeamId, def.tier, numDice)
  for (const statement of restore) db(statement)
  if (opts.keepBlockers !== true) clearBlockers(gid, enemyTeamId)
  return out
}

/** Violation-second buckets recorded for a Frozen curse (0017:18). */
const frozenBucketCount = (curseId) =>
  Number(db(`select count(*) from frozen_violation_seconds where curse_id='${curseId}';`)[0])

// ---------------------------------------------------------------------------
// GROUP 1 — [B] photo-verified proof windows
// ---------------------------------------------------------------------------

const results = { mechanism: {}, params: {}, findings: [] }

await strictStep(rec, 'group 1: [B] photo-verified proof windows', async () => {
  const g = await makeGameN(2, 2, `cursB-${seed}`)
  rec.bindGame(g.gid, g.code)
  rec.note(`game A ${g.code} (2v2) — [B] proof windows`)
  db(`update teams set coins = 9000 where game_id='${g.gid}';`)

  // Ordered so each curse's clock jumps happen after the previous one is done.
  const plan = [
    { ref: 'curse.photo-tax', openA: 6, closed: 70, openB: 128 },
    { ref: 'curse.pose-patrol', openA: 6, closed: 70, openB: 128 },
    { ref: 'curse.single-file', openA: 6, closed: 70, openB: 156 },
    { ref: 'curse.outfit-swap', openA: 6, closed: 300, openB: 1160 },
  ]

  for (const step of plan) {
    const cast = await castExactly(g.gid, g.west[0], g.wTeam, g.eTeam, step.ref, 2)
    if (!cast.ok) {
      rec.check(
        `${step.ref}: real cast via tier-exhaustion`,
        false,
        `observed=${JSON.stringify(cast.observed)} ${JSON.stringify(cast.r?.body ?? {})}`,
      )
      continue
    }
    rec.check(
      `${step.ref}: real cast (tier ${cast.r.body.tier}, dice ${JSON.stringify(cast.r.body.dice_rolls)})`,
      cast.r.body.curse_ref === step.ref,
      `enforcement=${cast.r.body.enforcement} duration=${cast.r.body.duration_minutes}min`,
    )
    const curseId = curseIdOf(g.gid, g.eTeam, step.ref)
    let row = curseRow(curseId)
    results.params[step.ref] = row.params
    results.mechanism[step.ref] = 'active_curses row + timed /submit-curse-proof windows'

    // --- window A: open, promptIndex from the shared arithmetic ------------
    advanceCurseTo(g.gid, curseId, step.openA, `${step.ref} into first proof window`)
    row = curseRow(curseId)
    let predicted = proofWindow(row, Date.now())
    rec.check(
      `${step.ref}: window predicted OPEN at ~${step.openA}s`,
      predicted !== null,
      `elapsed=${curseElapsedS(curseId)}s predicted=${JSON.stringify(predicted)}`,
    )
    if (predicted) {
      const ok = await postProof(g.gid, g.east[0], curseId, predicted.promptIndex)
      rec.check(
        `${step.ref}: /submit-curse-proof ACCEPTED inside window (prompt ${predicted.promptIndex})`,
        ok.status < 400,
        `status=${ok.status} ${JSON.stringify(ok.body).slice(0, 140)}`,
      )
      // A wrong prompt_index inside an open window must still be refused —
      // proves the server checks the index, not merely "a window is open".
      const wrong = await postProof(g.gid, g.east[0], curseId, predicted.promptIndex + 5)
      rec.check(
        `${step.ref}: mismatched prompt_index → 409 proof_window_closed`,
        wrong.status === 409 && wrong.body.error === 'proof_window_closed',
        `status=${wrong.status} error=${wrong.body.error}`,
      )
    }

    // --- between windows: closed ------------------------------------------
    advanceCurseTo(g.gid, curseId, step.closed, `${step.ref} between proof windows`)
    row = curseRow(curseId)
    const gap = proofWindow(row, Date.now())
    rec.check(
      `${step.ref}: window predicted CLOSED at ~${step.closed}s`,
      gap === null,
      `elapsed=${curseElapsedS(curseId)}s predicted=${JSON.stringify(gap)}`,
    )
    const shut = await postProof(g.gid, g.east[0], curseId, 0)
    rec.check(
      `${step.ref}: /submit-curse-proof REJECTED outside window → 409 proof_window_closed`,
      shut.status === 409 && shut.body.error === 'proof_window_closed',
      `status=${shut.status} error=${shut.body.error}`,
    )

    // --- window B: reopened AFTER a clock rebase --------------------------
    // This is the real question: proof windows are pure arithmetic over
    // active_curses.started_at, and advanceClock has now moved that column
    // several times. If the arithmetic survived, the next slot opens exactly
    // where the formula says.
    advanceCurseTo(g.gid, curseId, step.openB, `${step.ref} into second proof window`)
    row = curseRow(curseId)
    predicted = proofWindow(row, Date.now())
    rec.check(
      `${step.ref}: second window predicted OPEN at ~${step.openB}s (after 3 clock rebases)`,
      predicted !== null,
      `elapsed=${curseElapsedS(curseId)}s predicted=${JSON.stringify(predicted)}`,
    )
    if (predicted) {
      const ok2 = await postProof(g.gid, g.east[0], curseId, predicted.promptIndex)
      rec.check(
        `${step.ref}: proof ACCEPTED in second window (prompt ${predicted.promptIndex})`,
        ok2.status < 400,
        `status=${ok2.status} ${JSON.stringify(ok2.body).slice(0, 140)}`,
      )
      // Idempotency: the same slot cannot be filled twice.
      const dupe = await postProof(g.gid, g.east[0], curseId, predicted.promptIndex)
      rec.check(
        `${step.ref}: duplicate proof for the same slot → 409 proof_already_submitted`,
        dupe.status === 409 && dupe.body.error === 'proof_already_submitted',
        `status=${dupe.status} error=${dupe.body.error}`,
      )
    }

    // Retire this curse so the next plan entry is not blocked by it, and
    // clear the blockers this cast installed.
    db(`delete from active_curses where game_id='${g.gid}' and target_team_id='${g.eTeam}';`)
  }

  const proofCount = Number(
    db(`select count(*) from curse_proofs where game_id='${g.gid}';`)[0],
  )
  rec.check(
    'curse_proofs rows persisted for accepted proofs',
    proofCount >= 8,
    `${proofCount} rows (2 accepted per [B] curse × 4)`,
  )
  rec.note(`game A final clock: ${JSON.stringify(clockSnapshot(g.gid))}`)
})

// ---------------------------------------------------------------------------
// GROUP 2 — action locks (full-stop, pilgrimage)
// ---------------------------------------------------------------------------

await strictStep(rec, 'group 2: action locks', async () => {
  const g = await makeGameN(2, 2, `cursL-${seed}`)
  rec.note(`game B ${g.code} (2v2) — action locks`)
  db(`update teams set coins = 9000 where game_id='${g.gid}';`)

  // --- Full Stop: real cast, then every mutation from the cursed team -----
  const cast = await castExactly(g.gid, g.west[0], g.wTeam, g.eTeam, 'curse.full-stop', 2)
  rec.check(
    'curse.full-stop: real cast via tier-exhaustion',
    cast.ok && cast.r.body.curse_ref === 'curse.full-stop',
    `observed=${JSON.stringify(cast.observed)}`,
  )
  if (cast.ok) {
    results.params['curse.full-stop'] = curseRow(curseIdOf(g.gid, g.eTeam, 'curse.full-stop')).params
    results.mechanism['curse.full-stop'] =
      'server action lock (actionLock.ts:11 + 0030:74) — every mutating route 409s'
    rec.check(
      'curse.full-stop: response carries ledger_effect {kind:full_stop}',
      cast.r.body.ledger_effect?.kind === 'full_stop',
      JSON.stringify(cast.r.body.ledger_effect),
    )
  }
  // The cursed (east) team needs coins to prove the 409 is the lock, not money.
  db(`update teams set coins = 900 where id='${g.eTeam}';`)

  const buyIntel = await post(`/api/games/${g.gid}/buy-intel`, {
    device_id: g.east[0].device,
    player_id: g.east[0].player,
    intel_ref: 'intel.north-south',
  })
  rec.check(
    'full-stop: cursed team /buy-intel → 409 actions_locked',
    buyIntel.status === 409 && buyIntel.body.error === 'actions_locked',
    `status=${buyIntel.status} error=${buyIntel.body.error}`,
  )

  const chList = await apiGet(`/api/games/${g.gid}/challenges?device_id=${g.east[0].device}`)
  const ch = (chList.active ?? []).find((c) => c.landmark_ref) ?? (chList.active ?? [])[0]
  const chSubmit = await post(`/api/games/${g.gid}/submit-challenge`, {
    device_id: g.east[0].device,
    player_id: g.east[0].player,
    challenge_ref: ch?.id ?? 'challenge.unknown',
    pos: freshPos(coord(ch?.landmark_ref ?? 'landmark.biblioteca-municipal')),
  })
  rec.check(
    'full-stop: cursed team /submit-challenge → 409 actions_locked',
    chSubmit.status === 409 && chSubmit.body.error === 'actions_locked',
    `status=${chSubmit.status} error=${chSubmit.body.error}`,
  )

  const EAST_HOME = coord('landmark.biblioteca-municipal')
  await post(`/api/games/${g.gid}/camping-heartbeat`, {
    device_id: g.east[0].device,
    player_id: g.east[0].player,
    pos: freshPos(EAST_HOME),
  })
  const tag = await post(`/api/games/${g.gid}/tag`, {
    device_id: g.east[0].device,
    tagger_player_id: g.east[0].player,
    tagger_pos: freshPos(EAST_HOME),
    targets: [{ player_id: g.west[0].player, pos: freshPos(offsetMeters(EAST_HOME, 4, 0)) }],
  })
  rec.check(
    'full-stop: cursed team /tag → 409 actions_locked',
    tag.status === 409 && tag.body.error === 'actions_locked',
    `status=${tag.status} error=${tag.body.error}`,
  )
  const curseBack = await post(`/api/games/${g.gid}/buy-curse`, {
    device_id: g.east[0].device,
    player_id: g.east[0].player,
    num_dice: 1,
  })
  rec.check(
    'full-stop: cursed team cannot counter-curse → 409 actions_locked',
    curseBack.status === 409 && curseBack.body.error === 'actions_locked',
    `status=${curseBack.status} error=${curseBack.body.error}`,
  )
  // The CASTER is unaffected: the lock is scoped to target_team_id.
  const casterStillActs = await post(`/api/games/${g.gid}/buy-intel`, {
    device_id: g.west[0].device,
    player_id: g.west[0].player,
    intel_ref: 'intel.north-south',
  })
  rec.check(
    'full-stop: the CASTING team is not locked (scoped to target_team_id)',
    casterStillActs.status < 400,
    `status=${casterStillActs.status} ${casterStillActs.body.error ?? 'ok'}`,
  )

  // Full Stop is timed: it must self-clear via the production expiry path.
  const fsId = curseIdOf(g.gid, g.eTeam, 'curse.full-stop')
  advanceClockMinutes(g.gid, 11)
  rec.clockJump({ minutes: 11, reason: 'expire full-stop' })
  const expired = await post(`/api/games/${g.gid}/expire-curses`, {
    device_id: g.east[0].device,
  })
  rec.check(
    'full-stop: /expire-curses removes it after 10 min',
    expired.status < 400 && (expired.body.expired_curse_ids ?? []).includes(fsId),
    `expired=${JSON.stringify(expired.body.expired_curse_ids ?? [])}`,
  )
  const afterExpiry = await post(`/api/games/${g.gid}/buy-intel`, {
    device_id: g.east[0].device,
    player_id: g.east[0].player,
    intel_ref: 'intel.eliminate-one',
  })
  rec.check(
    'full-stop: actions work again once expired',
    afterExpiry.status < 400,
    `status=${afterExpiry.status} ${afterExpiry.body.error ?? 'ok'}`,
  )

  // --- Pilgrimage: real cast, lock, then geofenced completion ------------
  db(`delete from active_curses where game_id='${g.gid}' and target_team_id='${g.eTeam}';`)
  const pilg = await castExactly(g.gid, g.west[0], g.wTeam, g.eTeam, 'curse.pilgrimage', 2)
  rec.check(
    'curse.pilgrimage: real cast via tier-exhaustion',
    pilg.ok && pilg.r.body.curse_ref === 'curse.pilgrimage',
    `observed=${JSON.stringify(pilg.observed)}`,
  )
  if (pilg.ok) {
    const pId = curseIdOf(g.gid, g.eTeam, 'curse.pilgrimage')
    const pRow = curseRow(pId)
    results.params['curse.pilgrimage'] = pRow.params
    results.mechanism['curse.pilgrimage'] =
      'server action lock + 30 m geofence at a server-chosen neutral landmark'
    const targetRef = pRow.params.target_landmark_ref
    rec.check(
      'pilgrimage: server stamped a neutral target_landmark_ref into params',
      typeof targetRef === 'string' && targetRef.startsWith('landmark.'),
      `target=${targetRef}`,
    )
    rec.check(
      'pilgrimage: expires_at is NULL (no timer — only arrival clears it)',
      pRow.expires_at === null,
      `expires_at=${pRow.expires_at}`,
    )
    db(`update teams set coins = 900 where id='${g.eTeam}';`)
    const lockedByPilg = await post(`/api/games/${g.gid}/buy-intel`, {
      device_id: g.east[0].device,
      player_id: g.east[0].player,
      intel_ref: 'intel.eliminate-one',
    })
    rec.check(
      'pilgrimage: cursed team /buy-intel → 409 actions_locked',
      lockedByPilg.status === 409 && lockedByPilg.body.error === 'actions_locked',
      `status=${lockedByPilg.status} error=${lockedByPilg.body.error}`,
    )

    const target = coord(targetRef)
    const far = offsetMeters(target, 120, 0)
    const tooFar = await post(`/api/games/${g.gid}/complete-pilgrimage`, {
      device_id: g.east[0].device,
      player_id: g.east[0].player,
      curse_id: pId,
      pos: freshPos(far),
    })
    rec.check(
      'pilgrimage: completion 120 m away → 409 not_at_pilgrimage_target',
      tooFar.status === 409 && tooFar.body.error === 'not_at_pilgrimage_target',
      `status=${tooFar.status} error=${tooFar.body.error} d=${Math.round(tooFar.body.details?.distance_m ?? -1)}m`,
    )
    const arrive = await post(`/api/games/${g.gid}/complete-pilgrimage`, {
      device_id: g.east[0].device,
      player_id: g.east[0].player,
      curse_id: pId,
      pos: freshPos(offsetMeters(target, 12, 0)),
    })
    rec.check(
      'pilgrimage: completion within 30 m → completed',
      arrive.status < 400 && arrive.body.completed === true,
      `status=${arrive.status} ${JSON.stringify(arrive.body)}`,
    )
    rec.check(
      'pilgrimage: row deleted + curse_completed event appended',
      curseIdOf(g.gid, g.eTeam, 'curse.pilgrimage') === null &&
        Number(
          db(
            `select count(*) from events where game_id='${g.gid}' and type='curse_completed' and payload->>'curse_id'='${pId}';`,
          )[0],
        ) === 1,
      `row=${curseIdOf(g.gid, g.eTeam, 'curse.pilgrimage')}`,
    )
    const unlocked = await post(`/api/games/${g.gid}/buy-intel`, {
      device_id: g.east[0].device,
      player_id: g.east[0].player,
      intel_ref: 'intel.eliminate-one',
    })
    // What is under test is ONLY that `actions_locked` is gone. The purchase
    // itself may legitimately still be refused for an unrelated reason — this
    // team has bought intel earlier in the scenario, so a duplicate ref or a
    // full hand is an expected, different 409. Asserting `status < 400` used to
    // pass by accident and would silently break on any deck change.
    rec.check(
      'pilgrimage: arriving clears the action lock',
      unlocked.body.error !== 'actions_locked',
      `status=${unlocked.status} error=${unlocked.body.error ?? 'ok'} (any error except actions_locked proves the lock lifted)`,
    )
    const retry = await post(`/api/games/${g.gid}/complete-pilgrimage`, {
      device_id: g.east[0].device,
      player_id: g.east[0].player,
      curse_id: pId,
      pos: freshPos(offsetMeters(target, 12, 0)),
    })
    rec.check(
      'pilgrimage: retry after completion is idempotent (already_completed)',
      retry.status < 400 && retry.body.already_completed === true,
      `status=${retry.status} ${JSON.stringify(retry.body)}`,
    )
  }
})

// ---------------------------------------------------------------------------
// GROUP 3 — [L] ledger effects (coin-drain, intel-loss)
// ---------------------------------------------------------------------------

await strictStep(rec, 'group 3: [L] ledger effects', async () => {
  const g = await makeGameN(2, 2, `cursLed-${seed}`)
  rec.note(`game C ${g.code} (2v2) — ledger effects`)

  // --- coin-drain: exactly -50 on the enemy ledger -----------------------
  db(`update teams set coins = 9000 where id='${g.wTeam}';`)
  db(`update teams set coins = 400 where id='${g.eTeam}';`)
  const before = coinsOf(g.eTeam)
  const cd = await castExactly(g.gid, g.west[0], g.wTeam, g.eTeam, 'curse.coin-drain', 2, {
    keepEnemyCoins: true,
  })
  rec.check(
    'curse.coin-drain: real cast via tier-exhaustion',
    cd.ok && cd.r.body.curse_ref === 'curse.coin-drain',
    `observed=${JSON.stringify(cd.observed)} ${JSON.stringify(cd.r?.body ?? {})}`,
  )
  if (cd.ok) {
    const after = coinsOf(g.eTeam)
    results.mechanism['curse.coin-drain'] =
      'one-shot ledger: -50 enemy coins + coins_deducted event; NO active_curses row'
    results.params['curse.coin-drain'] = CURSE_BY_ID.get('curse.coin-drain').params
    rec.check(
      'coin-drain: enemy coins drop by exactly 50',
      before - after === 50,
      `${before} → ${after} (delta ${before - after})`,
    )
    rec.check(
      'coin-drain: ledger_effect reports amount 50 + new balance',
      cd.r.body.ledger_effect?.kind === 'coin_drain' &&
        cd.r.body.ledger_effect?.amount === 50 &&
        cd.r.body.ledger_effect?.target_team_coins === after,
      JSON.stringify(cd.r.body.ledger_effect),
    )
    rec.check(
      'coin-drain: leaves NO active_curses row (instant, not timed)',
      curseIdOf(g.gid, g.eTeam, 'curse.coin-drain') === null,
      `refs=${JSON.stringify(activeRefs(g.gid, g.eTeam))}`,
    )
    rec.check(
      'coin-drain: coins_deducted event with reason curse_coin_drain',
      Number(
        db(
          `select count(*) from events where game_id='${g.gid}' and type='coins_deducted' and payload->>'reason'='curse_coin_drain' and payload->>'team_id'='${g.eTeam}';`,
        )[0],
      ) === 1,
      'exactly one drain event',
    )
    // Repeatable: it is one-shot, so nothing blocks a second drain.
    const before2 = coinsOf(g.eTeam)
    const cd2 = await castExactly(g.gid, g.west[0], g.wTeam, g.eTeam, 'curse.coin-drain', 2, {
      keepEnemyCoins: true,
    })
    rec.check(
      'coin-drain: recastable immediately (one-shot, no no-stack row)',
      cd2.ok && coinsOf(g.eTeam) === before2 - 50,
      `${before2} → ${coinsOf(g.eTeam)}`,
    )
    // Drain is clamped to the enemy balance, never negative.
    db(`update teams set coins = 20 where id='${g.eTeam}';`)
    const cd3 = await castExactly(g.gid, g.west[0], g.wTeam, g.eTeam, 'curse.coin-drain', 2, {
      keepEnemyCoins: true,
    })
    rec.check(
      'coin-drain: clamped to the enemy balance (20 coins → 0, never negative)',
      cd3.ok && coinsOf(g.eTeam) === 0 && cd3.r.body.ledger_effect?.amount === 20,
      `coins=${coinsOf(g.eTeam)} ledger=${JSON.stringify(cd3.r?.body?.ledger_effect)}`,
    )
  }

  // --- intel-loss: exactly one in_hand card becomes expired -------------
  db(`update teams set coins = 9000 where id='${g.wTeam}';`)
  db(`update teams set coins = 900 where id='${g.eTeam}';`)
  db(`delete from active_curses where game_id='${g.gid}' and target_team_id='${g.eTeam}';`)
  for (const ref of ['intel.north-south', 'intel.eliminate-one', 'intel.eliminate-two']) {
    await post(`/api/games/${g.gid}/buy-intel`, {
      device_id: g.east[0].device,
      player_id: g.east[0].player,
      intel_ref: ref,
    })
  }
  const heldBefore = intelInHand(g.gid, g.eTeam)
  rec.check('intel-loss setup: enemy holds 3 in_hand intel cards', heldBefore === 3, `held=${heldBefore}`)
  const il = await castExactly(g.gid, g.west[0], g.wTeam, g.eTeam, 'curse.intel-loss', 2)
  rec.check(
    'curse.intel-loss: real cast via tier-exhaustion',
    il.ok && il.r.body.curse_ref === 'curse.intel-loss',
    `observed=${JSON.stringify(il.observed)} ${JSON.stringify(il.r?.body ?? {})}`,
  )
  if (il.ok) {
    const heldAfter = intelInHand(g.gid, g.eTeam)
    const expiredCount = Number(
      db(
        `select count(*) from cards where game_id='${g.gid}' and team_id='${g.eTeam}' and kind='intel' and state='expired';`,
      )[0],
    )
    results.mechanism['curse.intel-loss'] =
      'one-shot ledger: 1 random in_hand intel card → state=expired + intel_lost event; NO row'
    results.params['curse.intel-loss'] = CURSE_BY_ID.get('curse.intel-loss').params
    rec.check(
      'intel-loss: exactly 1 in_hand card becomes expired',
      heldBefore - heldAfter === 1 && expiredCount === 1,
      `in_hand ${heldBefore} → ${heldAfter}, expired=${expiredCount}`,
    )
    rec.check(
      'intel-loss: ledger_effect names the expired card ref',
      il.r.body.ledger_effect?.kind === 'intel_loss' &&
        typeof il.r.body.ledger_effect?.expired_card_ref === 'string',
      JSON.stringify(il.r.body.ledger_effect),
    )
    rec.check(
      'intel-loss: intel_lost event appended',
      Number(
        db(
          `select count(*) from events where game_id='${g.gid}' and type='intel_lost' and payload->>'team_id'='${g.eTeam}';`,
        )[0],
      ) === 1,
      'exactly one intel_lost event',
    )
    rec.check(
      'intel-loss: leaves NO active_curses row',
      curseIdOf(g.gid, g.eTeam, 'curse.intel-loss') === null,
      `refs=${JSON.stringify(activeRefs(g.gid, g.eTeam))}`,
    )
    rec.note(
      `NOTE (P1/P16 fixed in the route, still blocked in the RPC): intel-loss expires one card, and buy-intel/route.ts now counts only in_hand cards against the cap, so the slot is freed and the curse costs exactly the card its catalogue text promises. The authoritative RPC (purchase_intel_atomic_unchecked, 0015:246) still counts ANY state and hardcodes 4, so it OVERRIDES the route until a migration aligns it — a team at 4 held cards that loses one to this curse is still refused intel_cap_reached by the RPC.`,
    )
  }
})

// ---------------------------------------------------------------------------
// GROUP 4 — honour-only: does check-in (or mute) do ANYTHING server-side?
// ---------------------------------------------------------------------------

await strictStep(rec, 'group 4: honour-only curses (check-in, mute)', async () => {
  const g = await makeGameN(2, 2, `cursHon-${seed}`)
  rec.note(`game D ${g.code} (2v2) — honour-only curses`)
  db(`update teams set coins = 9000 where id='${g.wTeam}';`)
  db(`update teams set coins = 900 where id='${g.eTeam}';`)

  for (const ref of ['curse.check-in', 'curse.mute']) {
    db(`delete from active_curses where game_id='${g.gid}' and target_team_id='${g.eTeam}';`)
    const coinsBefore = coinsOf(g.eTeam)
    const intelBefore = intelInHand(g.gid, g.eTeam)
    const cast = await castExactly(g.gid, g.west[0], g.wTeam, g.eTeam, ref, 2)
    rec.check(
      `${ref}: real cast via tier-exhaustion`,
      cast.ok && cast.r.body.curse_ref === ref,
      `observed=${JSON.stringify(cast.observed)}`,
    )
    if (!cast.ok) continue
    const cid = curseIdOf(g.gid, g.eTeam, ref)
    const row = curseRow(cid)
    results.params[ref] = row.params
    results.mechanism[ref] =
      'active_curses row + client-only prompt (useCurseEnforcement); NO server-side effect of any kind'

    rec.check(
      `${ref}: creates an active_curses row with a real expiry`,
      row !== null && row.expires_at !== null,
      `expires_at=${row?.expires_at}`,
    )
    rec.check(
      `${ref}: enemy coins untouched by the cast`,
      coinsOf(g.eTeam) === coinsBefore,
      `${coinsBefore} → ${coinsOf(g.eTeam)}`,
    )
    rec.check(
      `${ref}: enemy intel untouched by the cast`,
      intelInHand(g.gid, g.eTeam) === intelBefore,
      `${intelBefore} → ${intelInHand(g.gid, g.eTeam)}`,
    )
    // Does it lock anything? actionLock.ts:11 only lists full-stop/pilgrimage.
    const act = await post(`/api/games/${g.gid}/buy-intel`, {
      device_id: g.east[0].device,
      player_id: g.east[0].player,
      intel_ref: ref === 'curse.check-in' ? 'intel.north-south' : 'intel.eliminate-one',
    })
    rec.check(
      `${ref}: does NOT lock actions — cursed team can still spend`,
      act.status < 400,
      `status=${act.status} ${act.body.error ?? 'ok'}`,
    )
    // Is there a proof/acknowledgement channel at all?
    const proof = await postProof(g.gid, g.east[0], cid, 0)
    rec.check(
      `${ref}: /submit-curse-proof → 409 proof_not_required (no server ack channel)`,
      proof.status === 409 && proof.body.error === 'proof_not_required',
      `status=${proof.status} error=${proof.body.error}`,
    )
    const ext = await post(`/api/games/${g.gid}/extend-curse`, {
      device_id: g.east[0].device,
      player_id: g.east[0].player,
      curse_id: cid,
      anchor_pos: freshPos(coord('landmark.biblioteca-municipal')),
    })
    rec.check(
      `${ref}: /extend-curse → 409 not_extendable (no penalty channel either)`,
      ext.status === 409 && ext.body.error === 'not_extendable',
      `status=${ext.status} error=${ext.body.error}`,
    )
    // Any durable record of a missed / acknowledged prompt?
    const evTypes = db(
      `select distinct type from events where game_id='${g.gid}' and payload->>'curse_ref'='${ref}' order by type;`,
    )
    rec.check(
      `${ref}: the ONLY durable trace is the curse_cast event (no ack/miss ledger)`,
      evTypes.length === 1 && evTypes[0] === 'curse_cast',
      `event types referencing ${ref}: ${JSON.stringify(evTypes)}`,
    )
    rec.check(
      `${ref}: no curse_proofs row can exist for it`,
      Number(db(`select count(*) from curse_proofs where curse_id='${cid}';`)[0]) === 0,
      'zero proofs',
    )
    if (ref === 'curse.check-in') {
      rec.check(
        'check-in: ledger_effect {kind:check_in} is a LABEL only (0046:184) — no state changes with it',
        cast.r.body.ledger_effect?.kind === 'check_in',
        JSON.stringify(cast.r.body.ledger_effect),
      )
    }
  }
  results.findings.push(
    'check-in has NO ledger effect: buy_curse_atomic_unchecked (0046:184) sets ledger_effect={kind:"check_in"} purely as a response label, inside the generic branch that only inserts the active_curses row. Nothing reads a missed prompt. Enforcement in data/curses.json is now "C", which matches reality.',
  )
})

// ---------------------------------------------------------------------------
// GROUP 5 — [A] readout-only curses: row + params only
// ---------------------------------------------------------------------------

await strictStep(rec, 'group 5: [A] readout-only curses', async () => {
  const g = await makeGameN(2, 2, `cursA-${seed}`)
  rec.note(`game E ${g.code} (2v2) — [A] readout curses`)
  db(`update teams set coins = 9000 where id='${g.wTeam}';`)

  const refs = [
    'curse.slow-walk',
    'curse.detour',
    'curse.buddy-up',
    'curse.frozen',
    'curse.solo-quarantine',
  ]
  for (const ref of refs) {
    const def = CURSE_BY_ID.get(ref)
    const cast = await castExactly(g.gid, g.west[0], g.wTeam, g.eTeam, ref, 2)
    rec.check(
      `${ref}: real cast via tier-exhaustion`,
      cast.ok && cast.r.body.curse_ref === ref,
      `observed=${JSON.stringify(cast.observed)} ${JSON.stringify(cast.r?.body ?? {})}`,
    )
    if (!cast.ok) continue
    const cid = curseIdOf(g.gid, g.eTeam, ref)
    const row = curseRow(cid)
    results.params[ref] = row.params
    results.mechanism[ref] = 'active_curses row + client readout only (no server penalty)'

    // Duration must match the catalog exactly.
    const durS = row.expiresMs == null ? null : Math.round((row.expiresMs - row.startedMs) / 1000)
    rec.check(
      `${ref}: expires_at - started_at == catalog duration (${def.duration_minutes} min)`,
      def.duration_minutes == null
        ? row.expiresMs === null
        : Math.abs(durS - def.duration_minutes * 60) <= 2,
      `stored=${durS}s catalog=${def.duration_minutes == null ? 'null' : def.duration_minutes * 60}s`,
    )
    // Every catalog param must be present unchanged in the stored row.
    const missing = Object.entries(def.params).filter(
      ([k, v]) => JSON.stringify(row.params[k]) !== JSON.stringify(v),
    )
    rec.check(
      `${ref}: catalog params carried into active_curses.params verbatim`,
      missing.length === 0,
      `stored=${JSON.stringify(row.params)} mismatches=${JSON.stringify(missing)}`,
    )
    // No action lock, no proof channel: these are readouts. castExactly has
    // already removed its steering rows, so this curse is the only one on the
    // team and a 409 here could only come from the curse itself.
    rec.check(
      `${ref}: is the only curse on the target team (steering rows removed)`,
      JSON.stringify(activeRefs(g.gid, g.eTeam)) === JSON.stringify([ref]),
      `refs=${JSON.stringify(activeRefs(g.gid, g.eTeam))}`,
    )
    db(`update teams set coins = 900 where id='${g.eTeam}';`)
    // Clear prior purchases so the probe cannot 409 on the 4-card intel cap or
    // on intel_already_purchased instead of on the curse.
    db(`delete from cards where game_id='${g.gid}' and team_id='${g.eTeam}' and kind='intel';`)
    const act = await post(`/api/games/${g.gid}/buy-intel`, {
      device_id: g.east[0].device,
      player_id: g.east[0].player,
      intel_ref: 'intel.north-south',
    })
    rec.check(
      `${ref}: does not lock the cursed team's actions`,
      act.status < 400,
      `status=${act.status} ${act.body.error ?? 'ok'}`,
    )
    if (ref === 'curse.detour') {
      rec.check(
        'detour: server stamped a concrete street (id, name, polyline, corridor) into params',
        typeof row.params.banned_street_id === 'string' &&
          typeof row.params.banned_street_name === 'string' &&
          Array.isArray(row.params.banned_street_polyline) &&
          row.params.banned_street_polyline.length >= 2 &&
          typeof row.params.corridor_m === 'number',
        `street=${row.params.banned_street_name} corridor=${row.params.corridor_m}m pts=${row.params.banned_street_polyline?.length}`,
      )
    }
    db(`delete from active_curses where game_id='${g.gid}' and target_team_id='${g.eTeam}' and curse_ref='${ref}';`)
  }
})

// ---------------------------------------------------------------------------
// GROUP 6 — Frozen: /extend-curse and the maximum reachable duration
// ---------------------------------------------------------------------------

await strictStep(rec, 'group 6: Frozen extension ceiling', async () => {
  const g = await makeGameN(2, 2, `cursFrz-${seed}`)
  rec.note(`game F ${g.code} (2v2) — Frozen /extend-curse`)
  db(`update teams set coins = 9000 where id='${g.wTeam}';`)
  const cast = await castExactly(g.gid, g.west[0], g.wTeam, g.eTeam, 'curse.frozen', 2)
  rec.check(
    'curse.frozen: real cast via tier-exhaustion',
    cast.ok && cast.r.body.curse_ref === 'curse.frozen',
    `observed=${JSON.stringify(cast.observed)}`,
  )
  if (!cast.ok) return
  const cid = curseIdOf(g.gid, g.eTeam, 'curse.frozen')
  const nominalS = CURSE_BY_ID.get('curse.frozen').duration_minutes * 60
  const storedDur = () => {
    const r = curseRow(cid)
    return r == null ? null : Math.round((r.expiresMs - r.startedMs) / 1000)
  }
  rec.check(
    `frozen: nominal duration at cast is ${nominalS}s (8 min)`,
    Math.abs(storedDur() - nominalS) <= 2,
    `stored=${storedDur()}s`,
  )

  // First contact establishes the durable anchor (0017 frozen_player_anchors).
  const anchorPoint = coord('landmark.biblioteca-municipal')
  const noAnchorYet = await post(`/api/games/${g.gid}/extend-curse`, {
    device_id: g.east[0].device,
    player_id: g.east[0].player,
    curse_id: cid,
    violation: { started_at: Date.now() - 5_000, ended_at: Date.now() },
  })
  rec.check(
    'frozen: reporting a violation before any anchor → 409 anchor_required',
    noAnchorYet.status === 409 && noAnchorYet.body.error === 'anchor_required',
    `status=${noAnchorYet.status} error=${noAnchorYet.body.error}`,
  )
  const anchored = await post(`/api/games/${g.gid}/extend-curse`, {
    device_id: g.east[0].device,
    player_id: g.east[0].player,
    curse_id: cid,
    anchor_pos: freshPos(anchorPoint),
  })
  rec.check(
    'frozen: anchor_pos establishes the durable anchor',
    anchored.status < 400 &&
      Math.abs(anchored.body.anchor?.lat - anchorPoint.lat) < 1e-9,
    `status=${anchored.status} anchor=${JSON.stringify(anchored.body.anchor)}`,
  )
  // Anchor is first-write-wins: a later "anchor" from elsewhere cannot move it.
  const moved = await post(`/api/games/${g.gid}/extend-curse`, {
    device_id: g.east[0].device,
    player_id: g.east[0].player,
    curse_id: cid,
    anchor_pos: freshPos(offsetMeters(anchorPoint, 400, 400)),
  })
  rec.check(
    'frozen: anchor is immutable (re-anchoring 565 m away returns the original)',
    moved.status < 400 && Math.abs(moved.body.anchor?.lat - anchorPoint.lat) < 1e-9,
    `returned=${JSON.stringify(moved.body.anchor)}`,
  )

  // --- Phase A: the real 1:1 extension, through the production path --------
  // Each violation second is a unique bucket (0017:19-23) and a report may only
  // cover the last ~120 s of wall time (extend-curse:16,45-48), so consecutive
  // reports must cover DISTINCT wall seconds. We simply let a few real seconds
  // pass between them — no clock move, so nothing can be rebased mid-ladder.
  const ladder = []
  let total = 0
  for (let i = 0; i < 3; i++) {
    const end = Date.now()
    const r = await post(`/api/games/${g.gid}/extend-curse`, {
      device_id: g.east[0].device,
      player_id: g.east[0].player,
      curse_id: cid,
      violation: { started_at: end - 3_000, ended_at: end },
    })
    if (r.status >= 400) {
      rec.note(`frozen ladder stopped at i=${i}: ${r.status} ${JSON.stringify(r.body)}`)
      break
    }
    total = r.body.total_violation_seconds
    ladder.push({ i, added: r.body.added_seconds, total, storedDurationS: storedDur() })
    await sleep(3_200)
  }
  rec.note(
    `frozen ladder: ${ladder
      .map((x) => `#${x.i} +${x.added}s tot=${x.total}s dur=${x.storedDurationS}s`)
      .join(' | ')}`,
  )
  rec.check(
    'frozen: each self-reported violation second extends expiry 1:1 while under the cap',
    ladder.length === 3 &&
      ladder.every((x) => Math.abs(x.storedDurationS - (nominalS + x.total)) <= 2),
    ladder.map((x) => `tot=${x.total}s → dur=${x.storedDurationS}s (expect ${nominalS + x.total})`).join(' ; '),
  )
  rec.check(
    'frozen: violation seconds are deduplicated across overlapping reports',
    total === frozenBucketCount(cid) && total < 12,
    `reported total=${total}s buckets=${frozenBucketCount(cid)} (3 reports x 3 s, overlapping)`,
  )

  // --- Phase B: the ceiling ------------------------------------------------
  // P5 fix (migration 0051): the ceiling is now nominal x 1.5, clamped INSIDE
  // report_frozen_state, so the 240 extra seconds it allows cannot be raised by
  // any caller. The route still passes MAX_EXTENSION_FACTOR = 4; the RPC narrows
  // it. Saturating it needs > 240 distinct violation seconds; we seed far past
  // that (and past the old 4x ceiling) so the same staging proves both that the
  // clamp binds and that the old 1920 s is now unreachable.
  //
  // Walking there through the HTTP route would take as many real seconds,
  // because a report can only ever cover wall time that has actually elapsed.
  // The RPC reads those buckets as `count(*)` alone (0027:143, 0051) — their
  // instants are never compared to anything — so seeding distinct buckets in the
  // far past is faithful input, and the CEILING ITSELF is then computed by the
  // production RPC via a real /extend-curse call. That call is what we measure.
  const MAX_EXTENSION_FACTOR = 1.5 // 0051
  const cappedDurS = Math.floor(nominalS * MAX_EXTENSION_FACTOR)
  const seedTo = nominalS * 3 + 120 // past BOTH the 1.5x cap and the old 4x one
  dbScript(`
insert into frozen_violation_seconds (curse_id, second_at)
select '${cid}', timestamptz '2020-01-01 00:00:00+00' + (i * interval '1 second')
from generate_series(1, ${seedTo}) i
on conflict do nothing;
`)
  const seeded = frozenBucketCount(cid)
  rec.check(
    `frozen: ${seeded} violation seconds staged (only ${cappedDurS - nominalS} needed to saturate the 1.5x cap; also past the old 4x ceiling of ${nominalS * 4}s)`,
    seeded > nominalS * 3,
    `buckets=${seeded}`,
  )
  const capped = await post(`/api/games/${g.gid}/extend-curse`, {
    device_id: g.east[0].device,
    player_id: g.east[0].player,
    curse_id: cid,
    violation: { started_at: Date.now() - 2_000, ended_at: Date.now() },
  })
  const maxDur = storedDur()
  rec.check(
    'frozen: the capping /extend-curse call succeeded (production RPC recomputed expiry)',
    capped.status < 400,
    `status=${capped.status} total_violation=${capped.body.total_violation_seconds}s`,
  )
  rec.check(
    `frozen: duration CEILING is exactly nominal x ${MAX_EXTENSION_FACTOR} = ${cappedDurS}s (${(cappedDurS / 60).toFixed(0)} min) — 0051 clamps the 4x the route still passes`,
    maxDur === cappedDurS,
    `stored duration=${maxDur}s (${(maxDur / 60).toFixed(1)} min) with ${capped.body.total_violation_seconds}s of violations reported — uncapped arithmetic would give ${nominalS + (capped.body.total_violation_seconds ?? 0)}s, and the pre-0051 4x ceiling would have given ${nominalS * 4}s`,
  )
  rec.check(
    'frozen: further violations past the cap do NOT extend it further',
    await (async () => {
      await sleep(2_200)
      const more = await post(`/api/games/${g.gid}/extend-curse`, {
        device_id: g.east[0].device,
        player_id: g.east[0].player,
        curse_id: cid,
        violation: { started_at: Date.now() - 2_000, ended_at: Date.now() },
      })
      return more.status < 400 && storedDur() === maxDur
    })(),
    `duration still ${storedDur()}s after another report`,
  )
  total = capped.body.total_violation_seconds ?? total
  results.frozen = { nominalS, maxDurationS: maxDur, totalViolationS: total, ladder }
  results.mechanism['curse.frozen'] =
    `active_curses row + client drift readout; SELF-REPORTED violations extend expiry 1:1 up to ${MAX_EXTENSION_FACTOR}x nominal (0051 clamp)`

  // The asymmetry: a client that never reports serves only the nominal 8 min.
  db(`delete from active_curses where game_id='${g.gid}' and target_team_id='${g.eTeam}';`)
  db(`update teams set coins = 9000 where id='${g.wTeam}';`)
  const silent = await castExactly(g.gid, g.west[0], g.wTeam, g.eTeam, 'curse.frozen', 2)
  if (silent.ok) {
    const sid = curseIdOf(g.gid, g.eTeam, 'curse.frozen')
    const sDur = Math.round((curseRow(sid).expiresMs - curseRow(sid).startedMs) / 1000)
    advanceClock(g.gid, nominalS + 30)
    rec.clockJump({ seconds: nominalS + 30, reason: 'expire a never-reported Frozen' })
    const exp = await post(`/api/games/${g.gid}/expire-curses`, { device_id: g.east[0].device })
    rec.check(
      `frozen: a client that NEVER reports serves only the nominal ${nominalS}s and expires`,
      sDur === nominalS && (exp.body.expired_curse_ids ?? []).includes(sid),
      `stored=${sDur}s expired=${JSON.stringify(exp.body.expired_curse_ids ?? [])}`,
    )
    results.findings.push(
      `FROZEN ASYMMETRY after the P5 fix (measured): honest self-reporting extends the curse 1:1 to a ceiling of ${maxDur}s (${(maxDur / 60).toFixed(0)} min) — ${MAX_EXTENSION_FACTOR}x the ${nominalS}s (${nominalS / 60} min) nominal, clamped inside report_frozen_state by migration 0051. A client that closes the app and reports nothing still serves exactly ${sDur}s, so the extension channel (/extend-curse) remains driven solely by the CURSED team's own client (useCurseEnforcement.ts:181-330) and nothing else can add a violation second. The asymmetry is therefore NOT closed — it is BOUNDED: dishonesty saves at most ${maxDur - sDur}s (${((maxDur - sDur) / 60).toFixed(0)} min), down from the pre-0051 ${nominalS * 4 - nominalS}s (${((nominalS * 4 - nominalS) / 60).toFixed(0)} min). Frozen stays non-free-to-ignore while the cost of honesty drops ~6x.`,
    )
  }
})

// ---------------------------------------------------------------------------
// GROUP 7 — eligibility filters + the no_available_curse oracle
// ---------------------------------------------------------------------------

await strictStep(rec, 'group 7: eligibility filters', async () => {
  // A 1v1 game: every min_team_size:2 curse must be unreachable.
  const g = await makeGameN(1, 1, `curs1v1-${seed}`)
  rec.note(`game G ${g.code} (1v1) — min_team_size + resource eligibility`)
  db(`update teams set coins = 9000 where id='${g.wTeam}';`)
  db(`update teams set coins = 400 where id='${g.eTeam}';`)

  const teamSizeGated = CURSES.filter((c) => (c.min_team_size ?? 1) > 1).map((c) => c.id)
  rec.note(`min_team_size:2 curses: ${teamSizeGated.join(', ')}`)

  // Deterministic proof, tier by tier: block every OTHER eligible curse in the
  // tier. If the size-gated member were still eligible it would be selected;
  // a 409 no_available_curse proves the filter excluded it.
  for (const [tier, numDice] of [
    ['minor', 1],
    ['medium', 2],
    ['major', 3],
  ]) {
    const gatedInTier = CURSES.filter(
      (c) => c.tier === tier && c.enabled !== false && (c.min_team_size ?? 1) > 1,
    ).map((c) => c.id)
    if (gatedInTier.length === 0) continue
    db(`delete from active_curses where game_id='${g.gid}' and target_team_id='${g.eTeam}';`)
    // Block everything eligible for a 1-player team in this tier.
    const blocked = blockTierExcept(g.gid, g.eTeam, tier, '__none__', 1)
    if (tier === 'major') {
      db(`update teams set coins = 0 where id='${g.eTeam}';`) // kills coin-drain
      db(
        `update cards set state='consumed' where game_id='${g.gid}' and team_id='${g.eTeam}' and kind='intel' and state='in_hand';`,
      ) // kills intel-loss
    }
    const out = await rollForTier(g.gid, g.west[0], g.wTeam, g.eTeam, tier, numDice)
    rec.check(
      `1v1: ${tier} tier with all size-1 options blocked → 409 no_available_curse (proves ${gatedInTier.join(' + ')} excluded)`,
      !out.ok && out.r?.status === 409 && out.r?.body?.error === 'no_available_curse',
      `blocked=${JSON.stringify(blocked)} observed=${JSON.stringify(out.observed)} ${JSON.stringify(out.r?.body ?? {})}`,
    )
  }

  // --- the oracle measurement: is a 409 free? -----------------------------
  db(`delete from active_curses where game_id='${g.gid}' and target_team_id='${g.eTeam}';`)
  blockTierExcept(g.gid, g.eTeam, 'major', '__none__', 1)
  db(`update teams set coins = 0 where id='${g.eTeam}';`)
  db(
    `update cards set state='consumed' where game_id='${g.gid}' and team_id='${g.eTeam}' and kind='intel' and state='in_hand';`,
  )
  const KNOWN = 777
  db(`update teams set coins = ${KNOWN} where id='${g.wTeam}';`)
  const chargeEvents = () =>
    Number(
      db(
        `select count(*) from events where game_id='${g.gid}' and type='coins_deducted' and payload->>'reason'='buy_curse' and payload->>'team_id'='${g.wTeam}';`,
      )[0],
    )
  let oracle = null
  for (let i = 0; i < 40; i++) {
    // Snapshot immediately before THIS call, so the comparison isolates it
    // from the successful rolls the loop also makes while hunting a major.
    const chargesBefore = chargeEvents()
    const r = await post(`/api/games/${g.gid}/buy-curse`, {
      device_id: g.west[0].device,
      player_id: g.west[0].player,
      num_dice: 3,
    })
    if (r.status === 409 && r.body.error === 'no_available_curse') {
      oracle = { r, coinsAfter: coinsOf(g.wTeam), chargesBefore, chargesAfter: chargeEvents() }
      break
    }
    if (r.status < 400) {
      db(
        `delete from active_curses where game_id='${g.gid}' and target_team_id='${g.eTeam}' and curse_ref='${r.body.curse_ref}';`,
      )
      db(`update teams set coins = ${KNOWN} where id='${g.wTeam}';`)
    }
  }
  rec.check(
    'no_available_curse: 409 returned when the rolled tier has no eligible curse',
    oracle !== null,
    oracle ? `details=${JSON.stringify(oracle.r.body.details)}` : 'never observed in 40 rolls',
  )
  if (oracle) {
    rec.check(
      'no_available_curse: buyer is charged NOTHING (coins byte-identical)',
      oracle.coinsAfter === KNOWN,
      `${KNOWN} → ${oracle.coinsAfter}`,
    )
    rec.check(
      'no_available_curse: no coins_deducted event appended by the failed roll',
      oracle.chargesAfter === oracle.chargesBefore,
      `buy_curse charge events ${oracle.chargesBefore} → ${oracle.chargesAfter} across the failing call`,
    )
    rec.check(
      'no_available_curse: the 409 body no longer echoes the rolled tier (P6 leak closed)',
      oracle.r.body.details === undefined,
      `details=${JSON.stringify(oracle.r.body.details)}`,
    )
    const probeEvents = Number(
      db(
        `select count(*) from events where game_id='${g.gid}' and type='curse_roll_failed' and payload->>'team_id'='${g.wTeam}';`,
      )[0],
    )
    rec.check(
      'no_available_curse: the failed roll IS logged, so the probe is attributable (P6)',
      probeEvents >= 1,
      `curse_roll_failed events for the buyer=${probeEvents}`,
    )
    const probePayload = JSON.parse(
      String(
        db(
          `select payload::text from events where game_id='${g.gid}' and type='curse_roll_failed' and payload->>'team_id'='${g.wTeam}' order by created_at desc limit 1;`,
        )[0],
      ),
    )
    rec.check(
      'no_available_curse: the logged probe carries no enemy state and no tier',
      probePayload.tier === undefined &&
        probePayload.team_id === g.wTeam &&
        Object.keys(probePayload).every((key) =>
          ['team_id', 'num_dice', 'dice_total', 'dice_rolls'].includes(key),
        ),
      `payload keys=${Object.keys(probePayload).join(',')}`,
    )
    results.findings.push(
      'FREE ORACLE (bounded after the P6 fix): a roll whose tier has no eligible curse still returns 409 no_available_curse BEFORE buy_curse_atomic runs and still moves no coins — RULEBOOK §10 explicitly says a tier with no eligible result costs nothing, so the refund is intended and was kept. Two of the three teeth are pulled: the response no longer echoes the rolled tier (so the prober is not told WHICH bucket of hidden enemy state was exhausted), and each failed roll now appends a `curse_roll_failed` event carrying only the buyer\'s own team and dice, so repeated probing is visible and attributable to the victim instead of silent. What remains is that probing is still free and still weakly informative in aggregate: a buyer who rolls enough can infer that some tier is empty. Charging for it would contradict the rulebook, so metering (a per-team roll budget) is the remaining lever if the field test shows it matters.',
    )
  }

  // --- resource predicates, isolated ------------------------------------
  // coin-drain with a solvent enemy must be castable; with 0 coins it must be
  // filtered out. Same shape for intel-loss.
  //
  // Each probe re-installs its own steering rows and removes them before the
  // next enemy-side action, because the major tier's blockers ARE Full Stop and
  // Pilgrimage — leaving them in place would 409 the enemy's intel purchase
  // with actions_locked and silently invalidate the next assertion.
  const g2 = await makeGameN(2, 2, `cursElig-${seed}`)
  db(`update teams set coins = 9000 where id='${g2.wTeam}';`)
  db(`update teams set coins = 300 where id='${g2.eTeam}';`)
  const okDrain = await castExactly(g2.gid, g2.west[0], g2.wTeam, g2.eTeam, 'curse.coin-drain', 2, {
    keepEnemyCoins: true,
  })
  rec.check(
    'coin-drain IS eligible while the enemy holds coins',
    okDrain.ok && okDrain.r.body.curse_ref === 'curse.coin-drain',
    `observed=${JSON.stringify(okDrain.observed)}`,
  )

  // Enemy at 0 coins and 0 intel: the whole major tier must be empty.
  const majorProbe = async (label, expectRef) => {
    db(`delete from active_curses where game_id='${g2.gid}' and target_team_id='${g2.eTeam}';`)
    blockTierExcept(g2.gid, g2.eTeam, 'major', expectRef ?? '__none__', 2)
    db(`update teams set coins = 9000 where id='${g2.wTeam}';`)
    const out = await rollForTier(g2.gid, g2.west[0], g2.wTeam, g2.eTeam, 'major', 3)
    clearBlockers(g2.gid, g2.eTeam)
    return out
  }

  db(`update teams set coins = 0 where id='${g2.eTeam}';`)
  db(
    `update cards set state='consumed' where game_id='${g2.gid}' and team_id='${g2.eTeam}' and kind='intel' and state='in_hand';`,
  )
  const drained = await majorProbe('0 coins, 0 intel')
  rec.check(
    'coin-drain EXCLUDED at 0 enemy coins (major tier now empty → 409)',
    !drained.ok && drained.r?.body?.error === 'no_available_curse',
    `observed=${JSON.stringify(drained.observed)} ${JSON.stringify(drained.r?.body ?? {})}`,
  )

  // Give the enemy one intel card back (needs coins + an unlocked team), then
  // strip the coins again so intel-loss is the only eligible major.
  db(`update teams set coins = 900 where id='${g2.eTeam}';`)
  db(`delete from cards where game_id='${g2.gid}' and team_id='${g2.eTeam}' and kind='intel';`)
  const bought = await post(`/api/games/${g2.gid}/buy-intel`, {
    device_id: g2.east[0].device,
    player_id: g2.east[0].player,
    intel_ref: 'intel.north-south',
  })
  db(`update teams set coins = 0 where id='${g2.eTeam}';`)
  const held = intelInHand(g2.gid, g2.eTeam)
  rec.check(
    'intel-loss setup: enemy re-acquired 1 in_hand intel while unlocked',
    held === 1,
    `held=${held} buy status=${bought.status} ${bought.body.error ?? 'ok'}`,
  )
  const intelOnly = await majorProbe('0 coins, 1 intel', 'curse.intel-loss')
  rec.check(
    'intel-loss IS eligible once the enemy holds 1 in_hand intel (0 coins → only option)',
    intelOnly.ok && intelOnly.r.body.curse_ref === 'curse.intel-loss',
    `held=${held} observed=${JSON.stringify(intelOnly.observed)} ${JSON.stringify(intelOnly.r?.body ?? {})}`,
  )
  const intelGone = await majorProbe('0 coins, 0 intel again')
  rec.check(
    'intel-loss EXCLUDED once the enemy holds 0 in_hand intel → 409',
    intelInHand(g2.gid, g2.eTeam) === 0 &&
      !intelGone.ok &&
      intelGone.r?.body?.error === 'no_available_curse',
    `held=${intelInHand(g2.gid, g2.eTeam)} observed=${JSON.stringify(intelGone.observed)}`,
  )
})

// ---------------------------------------------------------------------------
// GROUP 8 — no-stack and the expiry lifecycle
// ---------------------------------------------------------------------------

await strictStep(rec, 'group 8: no-stack + expiry lifecycle', async () => {
  const g = await makeGameN(2, 2, `cursLife-${seed}`)
  rec.note(`game H ${g.code} (2v2) — no-stack + expiry`)
  db(`update teams set coins = 9000 where id='${g.wTeam}';`)

  // No-stack: cast mute for real, keeping the steering rows in place — this
  // group's whole point is that the medium tier has nothing left to pick.
  const cast = await castExactly(g.gid, g.west[0], g.wTeam, g.eTeam, 'curse.mute', 2, {
    keepBlockers: true,
  })
  rec.check(
    'curse.mute: real cast (medium tier)',
    cast.ok && cast.r.body.curse_ref === 'curse.mute',
    `observed=${JSON.stringify(cast.observed)}`,
  )
  if (!cast.ok) return
  const cid = curseIdOf(g.gid, g.eTeam, 'curse.mute')

  // Every other medium option is already blocked, and mute is now active, so
  // the medium tier must be empty — the route cannot re-pick an active ref.
  db(`update teams set coins = 9000 where id='${g.wTeam}';`)
  const restack = await rollForTier(g.gid, g.west[0], g.wTeam, g.eTeam, 'medium', 2)
  rec.check(
    'no-stack: an already-active ref is excluded from selection (medium tier → 409)',
    !restack.ok && restack.r?.body?.error === 'no_available_curse',
    `observed=${JSON.stringify(restack.observed)} ${JSON.stringify(restack.r?.body ?? {})}`,
  )
  rec.check(
    'no-stack: exactly one row for the ref (unique index active_curses_no_stack_unique, 0018:10)',
    Number(
      db(
        `select count(*) from active_curses where game_id='${g.gid}' and target_team_id='${g.eTeam}' and curse_ref='curse.mute';`,
      )[0],
    ) === 1,
    'single row',
  )
  const dbBlocked = (() => {
    try {
      db(
        `insert into active_curses (game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${g.gid}','${g.eTeam}','curse.mute', now(), now()+interval '5 minutes','{}'::jsonb);`,
      )
      return false
    } catch {
      return true
    }
  })()
  rec.check(
    'no-stack is enforced in the DATABASE, not only by the route filter',
    dbBlocked,
    'direct duplicate insert rejected by the unique index',
  )

  // Expiry lifecycle through the production route.
  const before = curseRow(cid)
  advanceClock(g.gid, before.expiresMs == null ? 600 : Math.round((before.expiresMs - Date.now()) / 1000) + 45)
  rec.clockJump({ reason: 'push mute past its expiry' })
  rec.check(
    'expiry: the row survives past expires_at until housekeeping runs (poll-driven, not pg_cron)',
    curseIdOf(g.gid, g.eTeam, 'curse.mute') === cid,
    'stale row still present before /expire-curses',
  )
  const exp = await post(`/api/games/${g.gid}/expire-curses`, { device_id: g.east[0].device })
  rec.check(
    'expiry: /expire-curses deletes the row and returns its id',
    exp.status < 400 && (exp.body.expired_curse_ids ?? []).includes(cid),
    `status=${exp.status} expired=${JSON.stringify(exp.body.expired_curse_ids ?? [])}`,
  )
  rec.check(
    'expiry: row gone from active_curses',
    curseIdOf(g.gid, g.eTeam, 'curse.mute') === null,
    `refs=${JSON.stringify(activeRefs(g.gid, g.eTeam))}`,
  )
  rec.check(
    'expiry: exactly one curse_expired event appended for it (0046:52)',
    Number(
      db(
        `select count(*) from events where game_id='${g.gid}' and type='curse_expired' and payload->>'curse_id'='${cid}';`,
      )[0],
    ) === 1,
    'one event',
  )
  const again = await post(`/api/games/${g.gid}/expire-curses`, { device_id: g.east[0].device })
  rec.check(
    'expiry: a second /expire-curses is idempotent (no duplicate event)',
    (again.body.expired_curse_ids ?? []).length === 0 &&
      Number(
        db(
          `select count(*) from events where game_id='${g.gid}' and type='curse_expired' and payload->>'curse_id'='${cid}';`,
        )[0],
      ) === 1,
    `second call expired=${JSON.stringify(again.body.expired_curse_ids ?? [])}`,
  )
  // An expired-but-not-yet-housekept ref must not permanently block a recast.
  db(
    `insert into active_curses (game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${g.gid}','${g.eTeam}','curse.mute', now() - interval '20 minutes', now() - interval '5 minutes','{"ping_interval_seconds":60}'::jsonb);`,
  )
  db(`update teams set coins = 9000 where id='${g.wTeam}';`)
  const recast = await rollForTier(g.gid, g.west[0], g.wTeam, g.eTeam, 'medium', 2)
  rec.check(
    'expiry: a stale (expired) row does not block a recast — cast serializes its cleanup (0046:135)',
    recast.ok && recast.r.body.curse_ref === 'curse.mute',
    `observed=${JSON.stringify(recast.observed)} ${JSON.stringify(recast.r?.body ?? {})}`,
  )
})

// ---------------------------------------------------------------------------
// Coverage ledger: every catalog entry must have been reached by SOME group.
// ---------------------------------------------------------------------------

const enabled = CURSES.filter((c) => c.enabled !== false)
const uncovered = enabled.filter((c) => !results.mechanism[c.id])
for (const c of enabled) {
  if (!results.mechanism[c.id]) {
    // Disabled/unreached entries are surfaced, not silently skipped.
    results.mechanism[c.id] = 'NOT EXERCISED'
  }
}
rec.check(
  `coverage: all ${enabled.length} enabled curses exercised by mechanism`,
  uncovered.length === 0,
  uncovered.length === 0 ? 'complete' : `missing: ${uncovered.map((c) => c.id).join(', ')}`,
)
rec.check(
  'coverage: curse.backwards is disabled in the catalog and therefore never castable',
  CURSE_BY_ID.get('curse.backwards')?.enabled === false,
  'enabled:false — excluded by buy-curse/route.ts:274',
)

// Catalog-vs-stored param diff, printed as the report table input.
const paramDiff = []
for (const c of enabled) {
  const stored = results.params[c.id]
  if (!stored) continue
  for (const [k, v] of Object.entries(c.params)) {
    if (JSON.stringify(stored[k]) !== JSON.stringify(v)) {
      paramDiff.push(`${c.id}.${k}: catalog=${JSON.stringify(v)} stored=${JSON.stringify(stored[k])}`)
    }
  }
}
rec.check(
  'catalog params equal stored params for every exercised curse',
  paramDiff.length === 0,
  paramDiff.length === 0 ? 'no drift' : paramDiff.join(' ; '),
)

rec.note('--- MECHANISM LEDGER ---')
for (const c of CURSES) {
  rec.note(
    `${c.id} | ${c.tier} | [${c.enforcement}] | ${c.duration_minutes == null ? 'instant/none' : c.duration_minutes + 'min'} | ${results.mechanism[c.id] ?? 'disabled (enabled:false)'}`,
  )
}
rec.note('--- FINDINGS ---')
for (const f of results.findings) rec.note(f)

const { failed } = rec.finish({ curseCoverage: results })
process.exitCode = failed > 0 ? 1 : 0
