// Data-driven scenario plans.
//
// A plan is a plain object — teams, flag placements, waypoint paths, purchases,
// clock jumps — so a scenario becomes reviewable data instead of bespoke code,
// and every random input is seeded from one number so a failing run replays
// exactly.
//
// WHAT IS SEEDED, AND WHAT CANNOT BE
// ---------------------------------------------------------------------------
// Seeded here (harness side): GPS jitter, waypoint choice, which purchases fire
// in which order, and any plan-level selection.
//
// NOT seedable from outside the app, because the randomness lives server-side
// and is not injectable:
//   * curse tier dice        app/api/games/[id]/buy-curse/route.ts:59 Math.random
//   * intel pickDistinct     app/api/games/[id]/buy-intel/route.ts:77,85
//   * challenge refresh      0024_atomic_challenge_draw.sql:48 order by random()
//   * intel-loss card choice 0044:111 order by random()
//   * timeout coin flip      0045:237 random()
//   * banned_street_random   lib/curses/castParams.ts:23 (takes an injectable
//                            rng param, but the route passes the default)
//
// For those, a plan can PIN the outcome instead of predicting it: `forceCurse`
// inserts the exact curse row the scenario needs, and `expectOneOf` lets a
// check accept any legal draw. Both are recorded in the artifact so a rerun is
// interpretable. castParams.ts:23 is the one place the app already accepts an
// injected rng — worth noting as the pattern the other five could follow.

import { makeRng } from './geoutil.mjs'
import { makeGameN, coord, apiPost, apiGet, db } from './harness.mjs'
import { advanceClockMinutes, advanceClock } from './clock.mjs'
import { makeRecorder } from './artifact.mjs'
import { walkPath, WALK_MPS } from './movement.mjs'

/**
 * Run a plan. Returns { rec, game, rng } so the caller can add bespoke checks
 * after the declarative part has executed.
 *
 * Plan shape:
 * {
 *   scenario: 'tag-boundary',
 *   seed: 1234,
 *   west: 2, east: 2,             // team sizes
 *   clockMinutes: 31,             // initial coherent clock advance
 *   coins: 500,                   // fund both teams (skips the earn loop)
 *   steps: [
 *     { kind: 'advance', minutes: 16 },
 *     { kind: 'buyIntel', side: 'east', ref: 'intel.north-south' },
 *     { kind: 'buyCurse', side: 'west', dice: 3 },
 *     { kind: 'forceCurse', side: 'east', ref: 'curse.frozen', minutes: 8, params: {...} },
 *     { kind: 'walk', who: 'east0', to: 'landmark.x', sigmaM: 5, speedMps: 1.3 },
 *     { kind: 'expectError', label, request: {...}, status: 409, error: 'x' },
 *   ]
 * }
 */
export async function runPlan(plan, { browser = null, clients = null } = {}) {
  const seed = plan.seed ?? 1
  const rng = makeRng(seed)
  const rec = makeRecorder({ scenario: plan.scenario, seed, config: plan })

  console.log(`\n===== ${plan.scenario} (seed ${seed}) =====`)
  const game = await makeGameN(plan.west ?? 2, plan.east ?? 2, `${plan.scenario}-${seed}`)
  rec.bindGame(game.gid, game.code)
  rec.note(`game ${game.code} live — West ${game.west.length} / East ${game.east.length}`)

  if (plan.coins) {
    db(`update teams set coins = ${plan.coins} where game_id='${game.gid}';`)
    rec.note(`funded both teams to ${plan.coins} coins`)
  }
  if (plan.clockMinutes) {
    advanceClockMinutes(game.gid, plan.clockMinutes)
    rec.clockJump({ minutes: plan.clockMinutes, reason: 'plan.clockMinutes' })
    rec.note(`clock advanced ${plan.clockMinutes} min`)
  }

  const actor = (who) => {
    const m = /^(west|east)(\d+)$/.exec(who)
    if (!m) throw new Error(`bad actor "${who}" (expected west0 / east1 / ...)`)
    const list = m[1] === 'west' ? game.west : game.east
    const p = list[Number(m[2])]
    if (!p) throw new Error(`no such player ${who} (team size ${list.length})`)
    return p
  }
  const teamId = (side) => (side === 'west' ? game.wTeam : game.eTeam)

  for (const step of plan.steps ?? []) {
    switch (step.kind) {
      case 'advance': {
        const s = step.seconds ?? (step.minutes ?? 0) * 60
        advanceClock(game.gid, s)
        rec.clockJump({ seconds: s, reason: step.reason ?? 'plan step' })
        rec.note(`clock +${s}s`)
        break
      }
      case 'coins': {
        db(`update teams set coins = ${step.value} where id='${teamId(step.side)}';`)
        rec.note(`${step.side} coins set to ${step.value}`)
        break
      }
      case 'buyIntel': {
        const p = actor(`${step.side}0`)
        const r = await apiPost(`/api/games/${game.gid}/buy-intel`, {
          device_id: p.device,
          player_id: p.player,
          intel_ref: step.ref,
          ...(step.pos ? { player_pos: { ...coord(step.pos), accuracy: 5, updated_at: Date.now() } } : {}),
        })
        rec.note(`${step.side} bought ${step.ref}`)
        if (step.onResult) step.onResult(r, rec)
        break
      }
      case 'buyCurse': {
        const p = actor(`${step.side}0`)
        const r = await apiPost(`/api/games/${game.gid}/buy-curse`, {
          device_id: p.device,
          player_id: p.player,
          num_dice: step.dice ?? 1,
        })
        rec.note(`${step.side} cast ${r.curse_ref ?? '(unknown)'} (tier ${r.tier ?? '?'})`)
        if (step.onResult) step.onResult(r, rec)
        break
      }
      case 'forceCurse': {
        // Pin a specific curse because the tier dice are server-side and not
        // injectable (buy-curse/route.ts:59). Uses the production column shape
        // so expiry/enforcement behave normally.
        const params = JSON.stringify(step.params ?? {})
        const expires =
          step.minutes == null
            ? 'null'
            : `now() + interval '${step.minutes} minutes'`
        db(
          `insert into active_curses (game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${game.gid}','${teamId(step.side)}','${step.ref}', now(), ${expires}, '${params}'::jsonb);`,
        )
        rec.note(`forced ${step.ref} on ${step.side} (${step.minutes ?? 'no'} min)`)
        break
      }
      case 'walk': {
        if (!clients) throw new Error('walk step needs browser clients')
        const p = actor(step.who)
        const client = clients[p.device]
        if (!client) throw new Error(`no client for ${step.who}`)
        const from = step.from ? coord(step.from) : null
        const waypoints = [
          ...(from ? [from] : []),
          ...(step.via ?? []).map((r) => (typeof r === 'string' ? coord(r) : r)),
          typeof step.to === 'string' ? coord(step.to) : step.to,
        ]
        const result = await walkPath(client, waypoints, {
          speedMps: step.speedMps ?? WALK_MPS,
          stepSeconds: step.stepSeconds ?? 3,
          sigmaM: step.sigmaM ?? 0,
          rng,
          onFix: (fix) => rec.position(p.device, fix),
        })
        rec.note(
          `${step.who} walked ${result.totalMeters} m in ${result.fixes} fixes (~${result.walkSeconds}s of walking)`,
        )
        break
      }
      case 'expectError': {
        const res = await fetch(`${process.env.SIM_BASE || 'http://localhost:3001'}${step.path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(step.body),
        })
        const body = await res.json().catch(() => ({}))
        const okStatus = res.status === step.status
        const okError = !step.error || body.error === step.error
        rec.check(
          step.label,
          okStatus && okError,
          `got ${res.status} ${body.error ?? JSON.stringify(body).slice(0, 80)}`,
        )
        break
      }
      case 'note':
        rec.note(step.text)
        break
      default:
        throw new Error(`unknown plan step kind "${step.kind}"`)
    }
  }

  return { rec, game, rng, actor, teamId }
}

export { coord, apiPost, apiGet, db }
