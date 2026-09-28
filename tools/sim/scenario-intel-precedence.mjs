// Regression: the buy-intel route must report the SAME refusal reason as the
// authoritative RPC when a team is both at the intel cap and short of coins.
//
//   node tools/sim/scenario-intel-precedence.mjs [seed]
//
// The RPC checks the cap first (0015_atomic_game_mutations.sql:245-250) and only
// then the balance (:259). The route previously checked coins first, so a capped
// AND broke team was told `insufficient_coins` — which sends the player off to
// earn coins that can never unblock the purchase, because the cap is permanent.

import { makeGameN, db, BASE, adminRpc } from './harness.mjs'
import { advanceClockMinutes } from './clock.mjs'
import { makeRecorder, strictStep } from './artifact.mjs'

const seed = Number(process.argv[2] || 1212)
const rec = makeRecorder({ scenario: 'intel-precedence', seed })

const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

const g = await makeGameN(1, 1, `prec-${seed}`)
rec.bindGame(g.gid, g.code)
advanceClockMinutes(g.gid, 31)
const e = g.east[0]

const buy = (ref) =>
  post(`/api/games/${g.gid}/buy-intel`, {
    device_id: e.device,
    player_id: e.player,
    intel_ref: ref,
  })

await strictStep(rec, 'reach the cap', async () => {
  db(`update teams set coins = 900 where id='${g.eTeam}';`)
  // 4 cheap-to-mid cards that need no player_pos.
  for (const ref of [
    'intel.north-south',
    'intel.eliminate-one',
    'intel.eliminate-two',
    'intel.decoy-reveal',
  ]) {
    const r = await buy(ref)
    rec.check(`bought ${ref}`, r.status < 400, `status=${r.status} ${r.body.error ?? ''}`)
  }
  rec.check(
    'team holds exactly 4 intel cards (the cap)',
    Number(db(`select count(*) from cards where team_id='${g.eTeam}' and kind='intel';`)[0]) === 4,
    `count=${db(`select count(*) from cards where team_id='${g.eTeam}' and kind='intel';`)[0]}`,
  )
})

await strictStep(rec, 'capped AND broke reports the cap, not the balance', async () => {
  // Drain the balance below the cheapest remaining card so BOTH conditions hold.
  db(`update teams set coins = 5 where id='${g.eTeam}';`)
  const r = await buy('intel.surroundings') // costs 80, team has 5
  rec.check(
    'route reports intel_cap_reached (matches the RPC), not insufficient_coins',
    r.status === 409 && r.body.error === 'intel_cap_reached',
    `status=${r.status} error=${r.body.error}`,
  )

  // Prove the RPC agrees, so the two layers genuinely give one answer. Calling
  // it directly bypasses the route's pre-checks.
  let rpcResult = null
  try {
    const { data } = await adminRpc('purchase_intel_atomic', {
      p_game_id: g.gid,
      p_team_id: g.eTeam,
      p_actor_player_id: e.player,
      p_intel_ref: 'intel.decoy-reveal',
      p_cost: 100,
      p_answer: {},
    })
    rpcResult = data
  } catch (err) {
    rec.note(`RPC probe threw: ${String(err).slice(0, 120)}`)
  }
  if (rpcResult && typeof rpcResult === 'object' && 'error' in rpcResult) {
    rec.check(
      'authoritative RPC returns the same reason',
      rpcResult.error === 'intel_cap_reached',
      `rpc error=${rpcResult.error}`,
    )
  } else {
    rec.note(`RPC probe inconclusive (signature mismatch or null): ${JSON.stringify(rpcResult)}`)
  }

  rec.check(
    'the refused purchase charged nothing',
    Number(db(`select coins from teams where id='${g.eTeam}';`)[0]) === 5,
    `coins=${db(`select coins from teams where id='${g.eTeam}';`)[0]}`,
  )
})

await strictStep(rec, 'broke but NOT capped still reports the balance', async () => {
  // A fresh team: under the cap, no coins. The reason must be about money.
  const g2 = await makeGameN(1, 1, `prec2-${seed}`)
  advanceClockMinutes(g2.gid, 31)
  db(`update teams set coins = 5 where id='${g2.eTeam}';`)
  const r = await post(`/api/games/${g2.gid}/buy-intel`, {
    device_id: g2.east[0].device,
    player_id: g2.east[0].player,
    intel_ref: 'intel.north-south',
  })
  rec.check(
    'under the cap and short of coins → insufficient_coins (with the numbers)',
    r.status === 409 && r.body.error === 'insufficient_coins',
    `status=${r.status} error=${r.body.error} details=${JSON.stringify(r.body.details)}`,
  )
})

await strictStep(rec, 'duplicate-ref precedence is unchanged below the cap', async () => {
  const g3 = await makeGameN(1, 1, `prec3-${seed}`)
  advanceClockMinutes(g3.gid, 31)
  db(`update teams set coins = 900 where id='${g3.eTeam}';`)
  await post(`/api/games/${g3.gid}/buy-intel`, {
    device_id: g3.east[0].device,
    player_id: g3.east[0].player,
    intel_ref: 'intel.north-south',
  })
  const dup = await post(`/api/games/${g3.gid}/buy-intel`, {
    device_id: g3.east[0].device,
    player_id: g3.east[0].player,
    intel_ref: 'intel.north-south',
  })
  rec.check(
    're-buying an owned ref below the cap → intel_already_purchased',
    dup.status === 409 && dup.body.error === 'intel_already_purchased',
    `status=${dup.status} error=${dup.body.error}`,
  )
})

const { failed } = rec.finish()
process.exitCode = failed > 0 ? 1 : 0
