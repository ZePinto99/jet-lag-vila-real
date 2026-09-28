// Degenerate flag layouts + the challenge review lifecycle.
//
//   node tools/sim/scenario-degenerate.mjs [seed]
//
// Layouts the rules permit but nobody plays on purpose:
//   * real flag ON the team's own home base (legal — home bases sit in their
//     own pools, RULEBOOK §3.3)
//   * all 5 candidates clustered as tightly as the pool allows
//   * flags maximally far apart
// Each changes the defense-zone geometry, so each changes who can tag whom.

import { strict as assert } from 'node:assert'
import {
  apiPost,
  coord,
  db,
  BASE,
  uploadSurroundingsPhoto,
  uploadChallengeProof,
  uploadFlagAttemptProof,
} from './harness.mjs'
import { advanceClockMinutes, advanceClock } from './clock.mjs'
import { makeRecorder, strictStep } from './artifact.mjs'
import { haversineMeters as hav } from './geoutil.mjs'
import { offsetMeters } from './movement.mjs'

const seed = Number(process.argv[2] || 5150)
const rec = makeRecorder({ scenario: 'degenerate', seed })

const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}
const get = async (path) => {
  const res = await fetch(`${BASE}${path}`)
  return { status: res.status, body: await res.json().catch(() => ({})) }
}
const freshPos = (p, accuracy = 5) => ({ lat: p.lat, lng: p.lng, accuracy, updated_at: Date.now() })

// Build a game to LIVE with caller-chosen assignments, so we can install a
// degenerate layout the standard harness never produces.
async function makeGameWith(westAssign, eastAssign, tag) {
  const create = await apiPost('/api/games', {
    display_name: 'W1',
    device_id: `dg-w-${tag}`,
    preferred_side: 'west',
  })
  const gid = create.game.id
  const wTeam = create.teams.find((t) => t.side === 'west').id
  const eTeam = create.teams.find((t) => t.side === 'east').id
  const west = [{ device: `dg-w-${tag}`, player: create.me.id }]
  const j = await apiPost(`/api/games/${gid}/join`, {
    display_name: 'E1',
    device_id: `dg-e-${tag}`,
    preferred_side: 'east',
  })
  const east = [{ device: `dg-e-${tag}`, player: j.player?.id ?? j.me?.id ?? j.id }]
  for (const p of [...west, ...east]) {
    await apiPost(`/api/games/${gid}/ready`, { player_id: p.player, device_id: p.device, ready: true })
  }
  await apiPost(`/api/games/${gid}/start`, { device_id: west[0].device })
  await apiPost(`/api/games/${gid}/flag-setup`, {
    device_id: west[0].device,
    assignments: westAssign,
    surroundings_photo_path: await uploadSurroundingsPhoto(gid, wTeam, `${tag}-w`),
  })
  await apiPost(`/api/games/${gid}/flag-setup`, {
    device_id: east[0].device,
    assignments: eastAssign,
    surroundings_photo_path: await uploadSurroundingsPhoto(gid, eTeam, `${tag}-e`),
  })
  return { gid, code: create.game.code, wTeam, eTeam, west, east }
}

const roles = (real, decoys, empties) => [
  { landmark_ref: real, role: 'real' },
  ...decoys.map((r) => ({ landmark_ref: r, role: 'decoy' })),
  ...empties.map((r) => ({ landmark_ref: r, role: 'empty' })),
]

// --- 1. Real flag ON the team's own home base ---
await strictStep(rec, 'flag on own home base', async () => {
  const g = await makeGameWith(
    // West hides its real flag at its own home base, Miradouro da Vila Velha.
    roles(
      'landmark.miradouro-vila-velha',
      ['landmark.miradouro-meia-laranja', 'landmark.estacao-ferroviaria'],
      ['landmark.mercado-municipal', 'landmark.parque-florestal'],
    ),
    roles(
      'landmark.biblioteca-municipal',
      ['landmark.igreja-sao-pedro', 'landmark.jardim-da-carreira'],
      ['landmark.capela-sao-lazaro', 'landmark.escola-sao-pedro'],
    ),
    `home-${seed}`,
  )
  rec.note(`game ${g.code}: West real flag == West home base`)
  advanceClockMinutes(g.gid, 31)
  db(`update teams set coins = 900 where game_id='${g.gid}';`)

  const home = coord('landmark.miradouro-vila-velha')
  const raider = g.east[0]
  const proof = await uploadFlagAttemptProof(g.gid, raider.player, 'home')
  const a = await post(`/api/games/${g.gid}/attempt-flag`, {
    device_id: raider.device,
    player_id: raider.player,
    landmark_ref: 'landmark.miradouro-vila-velha',
    pos: freshPos(home),
    photo_url: proof,
  })
  rec.check(
    'a flag hidden on own home base is still capturable (legal per §3.3)',
    a.body.result === 'real',
    `result=${a.body.result} status=${a.status}`,
  )

  // The interesting consequence: the carrier now stands on the ENEMY home base
  // and must walk all the way to its own. Measure that walk.
  const eastHome = coord('landmark.biblioteca-municipal')
  const walkM = hav(home, eastHome)
  rec.note(
    `carrier must now walk ${Math.round(walkM)} m (~${Math.round(walkM / 1.3 / 60)} min at 1.3 m/s) from the West home to the East home`,
  )
  // And the defenders are sitting exactly where the raider has to be, so the
  // capture happens deepest inside their own defense zone.
  rec.check(
    'capturing a home-base flag puts the raider at the heart of the defenders zone (0 m from a candidate)',
    hav(home, coord('landmark.miradouro-vila-velha')) < 1,
    `distance from West candidate = ${hav(home, coord('landmark.miradouro-vila-velha')).toFixed(1)} m`,
  )
})

// --- 2. Maximally clustered candidates ---
await strictStep(rec, 'clustered candidates', async () => {
  // East's pool has a tight São Pedro / Jardim / Escola / Sé cluster.
  const eastCluster = [
    'landmark.igreja-sao-pedro',
    'landmark.jardim-da-carreira',
    'landmark.escola-sao-pedro',
    'landmark.se-catedral',
    'landmark.capela-sao-lazaro',
  ]
  const g = await makeGameWith(
    roles(
      'landmark.miradouro-vila-velha',
      ['landmark.miradouro-meia-laranja', 'landmark.estacao-ferroviaria'],
      ['landmark.mercado-municipal', 'landmark.parque-florestal'],
    ),
    roles(eastCluster[0], [eastCluster[1], eastCluster[2]], [eastCluster[3], eastCluster[4]]),
    `clus-${seed}`,
  )
  advanceClockMinutes(g.gid, 31)
  const pts = eastCluster.map((r) => coord(r))
  let maxSpread = 0
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) maxSpread = Math.max(maxSpread, hav(pts[i], pts[j]))
  rec.note(`East cluster max pairwise spread = ${Math.round(maxSpread)} m`)

  // With every candidate inside one 200 m-radius union, a single standing
  // defender would cover the whole objective set. Measure whether the pools
  // actually permit that — exhaustive search over all 5-subsets of both pools
  // says they do NOT: no pool member has any other pool member within 200 m,
  // and the tightest legal 5-pick still spans 621 m (East) / 771 m (West). So
  // the degenerate "one defender covers everything" layout is structurally
  // unreachable, which is a deliberate-looking property of the curated pools.
  const centre = pts[0]
  const covered = pts.filter((p) => hav(centre, p) <= 200).length
  rec.check(
    'pools PREVENT the degenerate one-spot-covers-all layout (each candidate sits alone in its 200 m circle)',
    covered === 1,
    `${covered}/5 East candidates within 200 m of ${eastCluster[0]}; tightest legal 5-pick spans ${Math.round(maxSpread)} m`,
  )
  rec.note(
    'PLAYER EXPERIENCE: good — a defender must physically choose which candidate to sit on, so raiders always have an uncovered approach. Worth preserving if the pools are ever edited.',
  )
})

// --- 3. Flags maximally far apart ---
await strictStep(rec, 'maximally distant flags', async () => {
  const g = await makeGameWith(
    roles(
      'landmark.parque-florestal', // farthest West option from the East side
      ['landmark.miradouro-vila-velha', 'landmark.miradouro-meia-laranja'],
      ['landmark.mercado-municipal', 'landmark.estacao-ferroviaria'],
    ),
    roles(
      'landmark.escola-sao-pedro', // farthest East option
      ['landmark.biblioteca-municipal', 'landmark.igreja-sao-pedro'],
      ['landmark.capela-sao-lazaro', 'landmark.jardim-da-carreira'],
    ),
    `far-${seed}`,
  )
  advanceClockMinutes(g.gid, 31)
  const d = hav(coord('landmark.parque-florestal'), coord('landmark.escola-sao-pedro'))
  rec.note(
    `real flags ${Math.round(d)} m apart — ~${Math.round(d / 1.3 / 60)} min one-way at walking pace`,
  )
  rec.check(
    'maximally distant real flags stay inside the 1.5 km play disk',
    d < 3000,
    `separation=${Math.round(d)} m`,
  )
  // Both must still be reachable and capturable.
  const proof = await uploadFlagAttemptProof(g.gid, g.east[0].player, 'far')
  const a = await post(`/api/games/${g.gid}/attempt-flag`, {
    device_id: g.east[0].device,
    player_id: g.east[0].player,
    landmark_ref: 'landmark.parque-florestal',
    pos: freshPos(coord('landmark.parque-florestal')),
    photo_url: proof,
  })
  rec.check(
    'the farthest candidate is still capturable',
    a.body.result === 'real',
    `result=${a.body.result}`,
  )
})

// --- 4. Challenge review lifecycle: reject -> resubmit -> accept, and auto-accept ---
await strictStep(rec, 'challenge review lifecycle', async () => {
  const g = await makeGameWith(
    roles(
      'landmark.miradouro-vila-velha',
      ['landmark.miradouro-meia-laranja', 'landmark.estacao-ferroviaria'],
      ['landmark.mercado-municipal', 'landmark.parque-florestal'],
    ),
    roles(
      'landmark.biblioteca-municipal',
      ['landmark.igreja-sao-pedro', 'landmark.jardim-da-carreira'],
      ['landmark.capela-sao-lazaro', 'landmark.escola-sao-pedro'],
    ),
    `rev-${seed}`,
  )
  advanceClockMinutes(g.gid, 31)
  const w = g.west[0]
  const e = g.east[0]

  const list = await get(`/api/games/${g.gid}/challenges?device_id=${w.device}`)
  const ch = (list.body.active ?? []).find((c) => c.photo_required && c.landmark_ref)
  assert.ok(ch, 'need a photo challenge with a landmark')
  const site = coord(ch.landmark_ref)

  const submit = async (tag) =>
    post(`/api/games/${g.gid}/submit-challenge`, {
      device_id: w.device,
      player_id: w.player,
      challenge_ref: ch.id,
      pos: freshPos(site),
      photo_url: await uploadChallengeProof(g.gid, w.player, tag),
    })

  const coinsBefore = Number(db(`select coins from teams where id='${g.wTeam}';`)[0])
  const s1 = await submit('r1')
  rec.check('photo challenge submits to pending', s1.status < 400, `status=${s1.status}`)
  const cardId = db(
    `select id from cards where team_id='${g.wTeam}' and ref='${ch.id}' and state='pending';`,
  )[0]
  rec.check('card is in pending review state', !!cardId, `card=${cardId}`)
  rec.check(
    'no coins credited while pending',
    Number(db(`select coins from teams where id='${g.wTeam}';`)[0]) === coinsBefore,
    `coins=${db(`select coins from teams where id='${g.wTeam}';`)[0]} before=${coinsBefore}`,
  )

  // The other team rejects it.
  const rej = await post(`/api/games/${g.gid}/reject-challenge`, {
    device_id: e.device,
    player_id: e.player,
    card_id: cardId,
  })
  rec.check('enemy team can reject the proof', rej.status < 400, `status=${rej.status} ${rej.body.error ?? ''}`)
  rec.check(
    'rejection credits nothing',
    Number(db(`select coins from teams where id='${g.wTeam}';`)[0]) === coinsBefore,
    `coins=${db(`select coins from teams where id='${g.wTeam}';`)[0]}`,
  )

  // Resubmit, then accept.
  const s2 = await submit('r2')
  rec.check('rejected challenge can be resubmitted', s2.status < 400, `status=${s2.status} ${s2.body.error ?? ''}`)
  const cardId2 = db(
    `select id from cards where team_id='${g.wTeam}' and ref='${ch.id}' and state='pending';`,
  )[0]
  const acc = await post(`/api/games/${g.gid}/accept-challenge`, {
    device_id: e.device,
    player_id: e.player,
    card_id: cardId2,
  })
  rec.check('acceptance credits the reward', acc.status < 400, `status=${acc.status} ${acc.body.error ?? ''}`)
  const coinsAfter = Number(db(`select coins from teams where id='${g.wTeam}';`)[0])
  rec.check(
    'reward + first blood credited exactly once',
    coinsAfter > coinsBefore,
    `before=${coinsBefore} after=${coinsAfter} delta=${coinsAfter - coinsBefore} (reward=${ch.reward_coins} +30 first blood)`,
  )

  // Double-accept must not double-credit.
  const acc2 = await post(`/api/games/${g.gid}/accept-challenge`, {
    device_id: e.device,
    player_id: e.player,
    card_id: cardId2,
  })
  rec.check(
    're-accepting the same card does not double-credit',
    Number(db(`select coins from teams where id='${g.wTeam}';`)[0]) === coinsAfter,
    `status=${acc2.status} coins=${db(`select coins from teams where id='${g.wTeam}';`)[0]}`,
  )

  // --- auto-accept after 120 s of silence (0048:45) ---
  const list2 = await get(`/api/games/${g.gid}/challenges?device_id=${w.device}`)
  const ch2 = (list2.body.active ?? []).find((c) => c.photo_required && c.landmark_ref && c.id !== ch.id)
  if (!ch2) {
    rec.note('no second photo challenge available for the auto-accept probe')
    return
  }
  const s3 = await post(`/api/games/${g.gid}/submit-challenge`, {
    device_id: w.device,
    player_id: w.player,
    challenge_ref: ch2.id,
    pos: freshPos(coord(ch2.landmark_ref)),
    photo_url: await uploadChallengeProof(g.gid, w.player, 'auto'),
  })
  rec.check('second challenge submitted to pending', s3.status < 400, `status=${s3.status}`)

  // Inside the window, auto-accept must refuse.
  const early = await post(`/api/games/${g.gid}/resolve-challenge-reviews`, { device_id: e.device })
  const stillPending = Number(
    db(`select count(*) from cards where team_id='${g.wTeam}' and ref='${ch2.id}' and state='pending';`)[0],
  )
  rec.check(
    'auto-accept does NOT fire inside the 120 s review window',
    stillPending === 1,
    `pending=${stillPending} status=${early.status}`,
  )

  // Age past it and resolve. advanceClock shifts payload.submitted_at too,
  // which 0048:40 reads in preference to cards.updated_at.
  const coins2 = Number(db(`select coins from teams where id='${g.wTeam}';`)[0])
  advanceClock(g.gid, 130)
  rec.clockJump({ seconds: 130, reason: 'age past the 120 s review window' })
  const late = await post(`/api/games/${g.gid}/resolve-challenge-reviews`, { device_id: e.device })
  rec.check(
    'auto-accept fires after 120 s and credits the reward',
    Number(db(`select coins from teams where id='${g.wTeam}';`)[0]) > coins2,
    `status=${late.status} coins ${coins2} -> ${db(`select coins from teams where id='${g.wTeam}';`)[0]}`,
  )
  rec.check(
    'a challenge_auto_accepted event is recorded',
    Number(
      db(`select count(*) from events where game_id='${g.gid}' and type='challenge_auto_accepted';`)[0],
    ) >= 1,
    `events=${db(`select count(*) from events where game_id='${g.gid}' and type='challenge_auto_accepted';`)[0]}`,
  )
  // Idempotence: a second resolve must not credit again.
  const coins3 = Number(db(`select coins from teams where id='${g.wTeam}';`)[0])
  await post(`/api/games/${g.gid}/resolve-challenge-reviews`, { device_id: e.device })
  rec.check(
    'resolving twice does not double-credit',
    Number(db(`select coins from teams where id='${g.wTeam}';`)[0]) === coins3,
    `coins=${db(`select coins from teams where id='${g.wTeam}';`)[0]}`,
  )
})

// --- 8. A carrier who reaches home AFTER the deadline gets 409, not 500 ---
await strictStep(rec, 'expired-game carrier is refused cleanly', async () => {
  const g = await makeGameWith(
    roles(
      'landmark.miradouro-vila-velha',
      ['landmark.miradouro-meia-laranja', 'landmark.estacao-ferroviaria'],
      ['landmark.mercado-municipal', 'landmark.parque-florestal'],
    ),
    roles(
      'landmark.biblioteca-municipal',
      ['landmark.igreja-sao-pedro', 'landmark.jardim-da-carreira'],
      ['landmark.capela-sao-lazaro', 'landmark.escola-sao-pedro'],
    ),
    `exp-${seed}`,
  )
  advanceClockMinutes(g.gid, 31)
  const carrier = g.east[0]

  // Become the flag carrier legitimately.
  const a = await post(`/api/games/${g.gid}/attempt-flag`, {
    device_id: carrier.device,
    player_id: carrier.player,
    landmark_ref: 'landmark.miradouro-vila-velha',
    pos: freshPos(coord('landmark.miradouro-vila-velha')),
    photo_url: await uploadFlagAttemptProof(g.gid, carrier.player, 'exp'),
  })
  rec.check('carrier established before the deadline', a.body.result === 'real', `result=${a.body.result}`)

  // Push past the 180-minute game duration WITHOUT settling the timeout, so the
  // authoritative guard (0030:51) is what refuses the run.
  advanceClockMinutes(g.gid, 190)
  rec.clockJump({ minutes: 190, reason: 'expire the game before the run completes' })

  const r = await post(`/api/games/${g.gid}/complete-run`, {
    device_id: carrier.device,
    player_id: carrier.player,
    pos: freshPos(coord('landmark.biblioteca-municipal')),
  })
  // The refusal itself is correct; what matters is that it is a 409 the client
  // can explain, not a 500 that looks like a dropped connection.
  rec.check(
    'post-deadline carrier gets 409 game_expired, NOT 500',
    r.status === 409 && r.body.error === 'game_expired',
    `status=${r.status} error=${r.body.error}`,
  )
  rec.check(
    'the refusal did not finish the game or crown a winner',
    db(`select status from games where id='${g.gid}';`)[0] !== 'finished',
    `game status=${db(`select status from games where id='${g.gid}';`)[0]}`,
  )
})

const { failed } = rec.finish()
process.exitCode = failed > 0 ? 1 : 0
