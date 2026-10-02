// Intel coverage sweep: all 7 cards in data/intel.json, their payload shapes,
// their TRUTHFULNESS against the hidden landmarks.kind, how much each one
// actually narrows the enemy pool, and the whole-game intel economy (cap 4,
// duplicates, expiry, exact-coin edge).
//
//   node tools/sim/scenario-intel-coverage.mjs [seed]
//
// Pure-API (no browser) so every assertion lands on the SERVER's authority:
// the answers are computed in app/api/games/[id]/buy-intel/route.ts and the
// cap/duplicate/debit are serialized inside purchase_intel_atomic
// (0015:221, re-guarded by 0030:107).
//
// Sources of truth under test:
//   catalogue + costs          data/intel.json
//   cap = 4 (any state)        lib/gameConstants.ts:52 + 0015:247
//   duplicate ref rejection    0015:251
//   narrowing semantics        lib/intel/narrowing.ts
//   hot/cold buckets           lib/intel/answers.ts
//   N/S pivot per defender     lib/intel/northSouth.ts
//   direction origin           lib/geo/playArea.ts PLAY_AREA_CENTRE
//   decoy wipes ALL in_hand    0026_two_stage_respawn.sql:130-133
//   tag expires 1 random       0039_one_intel_loss_per_tag_action.sql:155-164
//
// Because the cap is 4 per team per game and each ref may be bought once, the
// 7-card tour is split across two games (4 + 3); East buys in both, so every
// answer is measured against the SAME West real flag
// (landmark.miradouro-vila-velha).
//
// intel.east-west (the former I2) was REMOVED from data/intel.json — it
// eliminated exactly one candidate 6 times in 7 for 30 coins and narrowed 4/5
// when a defender hid on its own home (SIM_EVALUATION P3a). It is therefore not
// in ALL_REFS and no longer part of this sweep.

import {
  makeGameN,
  coord,
  apiPost,
  db,
  BASE,
  uploadFlagAttemptProof,
  uploadSurroundingsPhoto,
  WEST_ASSIGN,
  EAST_ASSIGN,
} from './harness.mjs'
import { advanceClockMinutes } from './clock.mjs'
import { makeRecorder, strictStep } from './artifact.mjs'
import { offsetMeters } from './movement.mjs'
import { haversineMeters as hav } from './geoutil.mjs'
import intelCatalog from '../../data/intel.json' with { type: 'json' }

const seed = Number(process.argv[2] || 20260924)
const rec = makeRecorder({ scenario: 'intel-coverage', seed })

const COST = new Map(intelCatalog.map((i) => [i.id, i.cost_coins]))
const ALL_REFS = intelCatalog.map((i) => i.id)

// Fixed by the harness's WEST_ASSIGN.
const WEST_REAL_REF = 'landmark.miradouro-vila-velha'
const WEST_DECOY_REFS = ['landmark.miradouro-meia-laranja', 'landmark.estacao-ferroviaria']
const WEST_EMPTY_REFS = ['landmark.mercado-municipal', 'landmark.parque-florestal']
const WEST_REAL = coord(WEST_REAL_REF)
const EAST_HOME = coord('landmark.biblioteca-municipal')

// Mirrors lib/geo/playArea.ts + lib/intel/northSouth.ts. Duplicated because the
// harness is plain ESM; asserted against the server's own echoed pivots below.
const PLAY_AREA_CENTRE = { lat: 41.2955, lng: -7.7461 }
const NS_PIVOT_WEST = 41.2954885

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

const post = async (path, body) => {
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
// One compact JSON object per output line — json_agg would embed newlines that
// db()'s line splitting has to stitch back together.
const jsonRows = (sql) => db(sql).map((line) => JSON.parse(line))

const setCoins = (gid, teamId, coins) =>
  db(`update teams set coins = ${coins} where id='${teamId}' and game_id='${gid}';`)
const coinsOf = (teamId) =>
  Number(db(`select coins from teams where id='${teamId}';`)[0])
const clearRespawn = (playerId) =>
  db(
    `update players set respawning=false, respawn_arrived=false, respawn_target_ref=null where id='${playerId}';`,
  )

/**
 * Re-roll West's hidden roles without changing the five chosen landmarks.
 *
 * The harness's WEST_ASSIGN puts the real flag ON West's home base
 * (miradouro-vila-velha is both). That is a legal but DEGENERATE layout: the
 * Direction bearing from PLAY_AREA_CENTRE happens to be unique there, so
 * measuring narrowing only at that layout would overstate it. (This also used
 * to collapse the removed intel.east-west pivot onto its own target — the
 * defect that got that card deleted; see SIM_EVALUATION P3a.) This rewrites
 * `kind` to the layout a different setup submission would have produced, so
 * the same 7 cards can be measured against an off-home real flag too.
 */
function relabelWest(gid, wTeamId, { real, decoys }) {
  const quoted = (arr) => arr.map((r) => `'${r}'`).join(',')
  db(
    `update landmarks set kind='flag_empty' where game_id='${gid}' and team_id='${wTeamId}' and kind in ('flag_real','flag_decoy','flag_empty');`,
  )
  db(
    `update landmarks set kind='flag_decoy' where game_id='${gid}' and team_id='${wTeamId}' and ref in (${quoted(decoys)});`,
  )
  db(
    `update landmarks set kind='flag_real' where game_id='${gid}' and team_id='${wTeamId}' and ref='${real}';`,
  )
}

/** The enemy (West) candidate rows WITH the hidden kind — service-role read. */
const enemyCandidates = (gid, westTeamId) =>
  jsonRows(
    `select json_build_object('ref', ref, 'kind', kind, 'lat', lat, 'lng', lng)::text from landmarks where game_id='${gid}' and team_id='${westTeamId}' and kind in ('flag_real','flag_decoy','flag_empty') order by ref;`,
  )

/** Every intel card a team has ever held, newest last. */
const intelCards = (gid, teamId) =>
  jsonRows(
    `select json_build_object('id', id, 'ref', ref, 'state', state, 'payload', payload)::text from cards where game_id='${gid}' and team_id='${teamId}' and kind='intel' order by created_at, id;`,
  )

// ---------------------------------------------------------------------------
// Replica of lib/intel/narrowing.ts — single card, so we can attribute the
// narrowing to the card under test rather than to the accumulated hand.
// ---------------------------------------------------------------------------

function bucketRange(bucket) {
  switch (bucket) {
    case 'under_200m':
      return [0, 200]
    case 'under_500m':
      return [200, 500]
    case 'under_1km':
      return [500, 1000]
    case 'over_1km':
      return [1000, Infinity]
    default:
      return null
  }
}

/**
 * Refs this ONE card proves are not the real flag, per narrowing.ts.
 * `candidates` are the enemy landmarks as the attacker sees them (ref+coords).
 */
function narrowedByCard(payload, candidates) {
  const out = new Set()
  switch (payload.intel_ref) {
    case 'intel.north-south': {
      const pivot = payload.pivot_lat
      for (const c of candidates) {
        if ((c.lat > pivot ? 'north' : 'south') !== payload.direction) out.add(c.ref)
      }
      break
    }
    // Historical only — the card is gone from the catalogue, but this mirrors
    // lib/intel/narrowing.ts, which still decodes pre-removal cards.
    case 'intel.east-west': {
      const pivot = payload.pivot_lng
      for (const c of candidates) {
        if ((c.lng > pivot ? 'east' : 'west') !== payload.direction) out.add(c.ref)
      }
      break
    }
    case 'intel.eliminate-one':
      out.add(payload.not_real.ref)
      break
    case 'intel.eliminate-two':
      for (const n of payload.not_real) out.add(n.ref)
      break
    case 'intel.decoy-reveal':
      out.add(payload.decoy.ref)
      break
    case 'intel.hot-cold': {
      const [lo, hi] = bucketRange(payload.bucket)
      for (const c of candidates) {
        const d = hav(payload.buy_position, c)
        if (d < lo || d >= hi) out.add(c.ref)
      }
      break
    }
    case 'intel.surroundings':
    case 'intel.direction':
      // narrowing.ts deliberately narrows nothing for these two.
      break
    default:
      throw new Error(`narrowedByCard: unhandled ${payload.intel_ref}`)
  }
  return out
}

// Mirrors lib/intel/direction.ts, for the geometric truth check.
function bearingDeg(from, to) {
  const rad = (d) => (d * Math.PI) / 180
  const lat1 = rad(from.lat)
  const lat2 = rad(to.lat)
  const dLng = rad(to.lng - from.lng)
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}
function compass4(deg) {
  if (deg < 45 || deg >= 315) return 'N'
  if (deg < 135) return 'E'
  if (deg < 225) return 'S'
  return 'W'
}
function trueBucket(m) {
  if (m < 200) return 'under_200m'
  if (m < 500) return 'under_500m'
  if (m < 1000) return 'under_1km'
  return 'over_1km'
}

/**
 * A point whose HAVERSINE distance from `from` is `metres`, due north.
 *
 * movement.ts's offsetMeters divides by a flat 111_320 m/deg, while
 * lib/geo/haversine.ts uses R = 6_371_000 (≈111_195 m/deg). That 0.11 %
 * disagreement is irrelevant for a 28 m geofence but lands a nominal "200 m"
 * probe at 199.8 m — the wrong side of a bracket edge. Solve for the offset
 * that the app's own metric will measure as exactly `metres`.
 */
function northAtHaversine(from, metres) {
  let guess = metres
  for (let i = 0; i < 6; i++) {
    const d = hav(from, offsetMeters(from, guess, 0))
    if (d === 0) break
    guess *= metres / d
  }
  return offsetMeters(from, guess, 0)
}

// Table rows accumulated for the report.
const table = []

// ---------------------------------------------------------------------------
// The per-card tour. Buys `ref` as East, then asserts cost, shape, truth and
// narrowing. Returns the purchase response.
// ---------------------------------------------------------------------------

async function buyAndVerify(g, ref, { playerPos = null } = {}) {
  const east = g.east[0]
  const cost = COST.get(ref)
  const before = coinsOf(g.eTeam)
  const cands = enemyCandidates(g.gid, g.wTeam)
  const visible = cands.map(({ ref: r, lat, lng }) => ({ ref: r, lat, lng }))
  const real = cands.find((c) => c.kind === 'flag_real')
  const nonRealRefs = new Set(cands.filter((c) => c.kind !== 'flag_real').map((c) => c.ref))
  const decoyRefs = new Set(cands.filter((c) => c.kind === 'flag_decoy').map((c) => c.ref))

  const body = { device_id: east.device, player_id: east.player, intel_ref: ref }
  if (playerPos) body.player_pos = freshPos(playerPos)
  const r = await post(`/api/games/${g.gid}/buy-intel`, body)

  const ok = rec.check(
    `${ref}: purchase accepted`,
    r.status < 400 && !!r.body.answer,
    `status=${r.status} ${r.body.error ?? ''}`,
  )
  if (!ok) {
    table.push({ ref, cost, narrowed: 'n/a', correct: 'PURCHASE FAILED' })
    return r
  }

  const after = coinsOf(g.eTeam)
  rec.check(
    `${ref}: coins debited by exactly ${cost}`,
    before - after === cost && r.body.team_coins === after,
    `before=${before} after=${after} delta=${before - after} response.team_coins=${r.body.team_coins}`,
  )

  // Persisted card: the payload the CLIENT will narrow from.
  const cards = intelCards(g.gid, g.eTeam)
  const card = cards.find((c) => c.ref === ref)
  rec.check(
    `${ref}: card persisted in_hand`,
    !!card && card.state === 'in_hand',
    card ? `state=${card.state}` : 'card row missing',
  )

  const answer = r.body.answer
  const stored = card?.payload ?? {}
  let shapeOk = false
  let truthDetail = ''
  let truthOk = false

  switch (ref) {
    case 'intel.north-south': {
      shapeOk =
        answer.direction === 'north' || answer.direction === 'south'
          ? typeof answer.pivot_lat === 'number'
          : false
      const expected = real.lat > answer.pivot_lat ? 'north' : 'south'
      truthOk = answer.direction === expected && answer.pivot_lat === NS_PIVOT_WEST
      truthDetail = `direction=${answer.direction} expected=${expected} pivot=${answer.pivot_lat} (northSouth.ts west=${NS_PIVOT_WEST}) realLat=${real.lat}`
      break
    }
    case 'intel.eliminate-one': {
      shapeOk = !!answer.not_real?.ref && typeof answer.not_real?.name === 'string'
      truthOk = nonRealRefs.has(answer.not_real?.ref)
      const kind = cands.find((c) => c.ref === answer.not_real?.ref)?.kind
      truthDetail = `named=${answer.not_real?.ref} trueKind=${kind} (must not be flag_real)`
      break
    }
    case 'intel.eliminate-two': {
      shapeOk =
        Array.isArray(answer.not_real) &&
        answer.not_real.length === 2 &&
        answer.not_real.every((n) => n.ref && typeof n.name === 'string')
      const refs = (answer.not_real ?? []).map((n) => n.ref)
      const distinct = new Set(refs).size === refs.length
      truthOk = distinct && refs.every((x) => nonRealRefs.has(x))
      truthDetail = `named=${refs.join(',')} kinds=${refs
        .map((x) => cands.find((c) => c.ref === x)?.kind)
        .join(',')} distinct=${distinct}`
      break
    }
    case 'intel.decoy-reveal': {
      shapeOk = !!answer.decoy?.ref && typeof answer.decoy?.name === 'string'
      truthOk = decoyRefs.has(answer.decoy?.ref)
      truthDetail = `named=${answer.decoy?.ref} trueKind=${
        cands.find((c) => c.ref === answer.decoy?.ref)?.kind
      } (must be flag_decoy, not empty and not real)`
      break
    }
    case 'intel.hot-cold': {
      shapeOk =
        !!bucketRange(answer.bucket) &&
        typeof answer.buy_position?.lat === 'number' &&
        typeof answer.buy_position?.lng === 'number'
      const trueD = hav(playerPos, real)
      truthOk = answer.bucket === trueBucket(trueD)
      truthDetail = `bucket=${answer.bucket} trueDistance=${trueD.toFixed(0)}m expected=${trueBucket(trueD)}`
      // 0038 stripped the real-flag coords from this payload; make sure they
      // have not crept back in.
      rec.check(
        'intel.hot-cold: payload carries NO real-flag coords (0038 regression guard)',
        stored.target === undefined && answer.target === undefined,
        `stored keys=[${Object.keys(stored).join(',')}]`,
      )
      break
    }
    case 'intel.surroundings': {
      shapeOk = typeof answer.photo_url === 'string' && answer.photo_url.length > 0
      // Truth = the signed URL actually resolves to the DEFENDING team's photo.
      const path = db(
        `select object_path from flag_surroundings where game_id='${g.gid}' and team_id='${g.wTeam}';`,
      )[0]
      const head = await fetch(answer.photo_url, { method: 'GET' })
      truthOk = head.status === 200 && !!path && answer.photo_url.includes(encodeURI(path))
      truthDetail = `httpStatus=${head.status} westPath=${path} urlMatchesWestPath=${
        !!path && answer.photo_url.includes(encodeURI(path))
      }`
      rec.check(
        'intel.surroundings: signed URL is NOT persisted to cards.payload (route.ts:418-425)',
        stored.photo_url === undefined && Object.keys(stored).join(',') === 'intel_ref',
        `stored=${JSON.stringify(stored)}`,
      )
      break
    }
    case 'intel.direction': {
      shapeOk = ['N', 'E', 'S', 'W'].includes(answer.bearing)
      const deg = bearingDeg(PLAY_AREA_CENTRE, real)
      truthOk = answer.bearing === compass4(deg)
      truthDetail = `bearing=${answer.bearing} trueBearing=${deg.toFixed(1)}deg expected=${compass4(deg)} origin=PLAY_AREA_CENTRE`
      break
    }
    default:
      throw new Error(`no verification path for ${ref}`)
  }

  rec.check(`${ref}: payload shape correct`, shapeOk, JSON.stringify(answer).slice(0, 220))
  rec.check(`${ref}: revealed answer is TRUE vs hidden landmarks.kind`, truthOk, truthDetail)

  const narrowed = narrowedByCard(answer, visible)
  const narrowsReal = narrowed.has(real.ref)
  rec.check(
    `${ref}: narrowing never rules out the REAL flag`,
    !narrowsReal,
    `narrowed ${narrowed.size}/5: [${[...narrowed].join(', ')}]`,
  )
  rec.note(
    `${ref} (${cost} coins) narrows ${narrowed.size}/5 candidates -> ${
      5 - narrowed.size
    } still live${narrowed.size ? `; ruled out: ${[...narrowed].join(', ')}` : ''}`,
  )
  table.push({
    ref,
    cost,
    narrowed: narrowed.size,
    correct: truthOk ? 'yes' : 'NO',
    detail: truthDetail,
  })
  return r
}

// ---------------------------------------------------------------------------
// GAME A — refs 1-4 + the duplicate-purchase probe
// ---------------------------------------------------------------------------

const gA = await makeGameN(2, 2, `intelA-${seed}`)
rec.bindGame(gA.gid, gA.code)
rec.note(`game A ${gA.code} — East buys N/S, E/W, eliminate-one, eliminate-two`)
setCoins(gA.gid, gA.eTeam, 900)

// Sanity: the hidden layout really is what the harness promised, otherwise
// every truth assertion below is measuring the wrong thing.
await strictStep(rec, 'hidden West layout matches WEST_ASSIGN', async () => {
  const cands = enemyCandidates(gA.gid, gA.wTeam)
  const byKind = (k) => cands.filter((c) => c.kind === k).map((c) => c.ref).sort()
  rec.check(
    'West real flag is landmark.miradouro-vila-velha',
    byKind('flag_real').join() === WEST_REAL_REF,
    byKind('flag_real').join(),
  )
  rec.check(
    'West decoys are meia-laranja + estacao-ferroviaria',
    byKind('flag_decoy').join() === [...WEST_DECOY_REFS].sort().join(),
    byKind('flag_decoy').join(),
  )
  rec.check(
    'West empties are mercado + parque-florestal',
    byKind('flag_empty').join() === [...WEST_EMPTY_REFS].sort().join(),
    byKind('flag_empty').join(),
  )
})

await strictStep(rec, 'card 1: intel.north-south', () => buyAndVerify(gA, 'intel.north-south'))

// DUPLICATE PROBE — must run while the hand is still under the cap, because
// the cap check (route.ts:225 / 0015:247) precedes the duplicate check
// (route.ts:228 / 0015:251).
await strictStep(rec, 'duplicate purchase of the same intel_ref', async () => {
  const before = coinsOf(gA.eTeam)
  const r = await post(`/api/games/${gA.gid}/buy-intel`, {
    device_id: gA.east[0].device,
    player_id: gA.east[0].player,
    intel_ref: 'intel.north-south',
  })
  rec.check(
    're-buying an owned intel_ref -> 409 intel_already_purchased',
    r.status === 409 && r.body.error === 'intel_already_purchased',
    `status=${r.status} error=${r.body.error}`,
  )
  rec.check(
    'rejected duplicate does not charge coins',
    coinsOf(gA.eTeam) === before,
    `before=${before} after=${coinsOf(gA.eTeam)}`,
  )
  rec.check(
    'rejected duplicate creates no second card row',
    intelCards(gA.gid, gA.eTeam).filter((c) => c.ref === 'intel.north-south').length === 1,
    `rows=${intelCards(gA.gid, gA.eTeam).filter((c) => c.ref === 'intel.north-south').length}`,
  )
})

await strictStep(rec, 'card 2: intel.eliminate-one', () => buyAndVerify(gA, 'intel.eliminate-one'))
await strictStep(rec, 'card 3: intel.eliminate-two', () => buyAndVerify(gA, 'intel.eliminate-two'))
await strictStep(rec, 'card 4: intel.decoy-reveal', () => buyAndVerify(gA, 'intel.decoy-reveal'))

// ---------------------------------------------------------------------------
// INTEL CAP — the 5th purchase in game A
// ---------------------------------------------------------------------------

await strictStep(rec, 'intel cap = 4', async () => {
  const cards = intelCards(gA.gid, gA.eTeam)
  rec.check('East holds exactly 4 intel cards', cards.length === 4, `count=${cards.length}`)
  const before = coinsOf(gA.eTeam)
  const r = await post(`/api/games/${gA.gid}/buy-intel`, {
    device_id: gA.east[0].device,
    player_id: gA.east[0].player,
    intel_ref: 'intel.direction',
  })
  rec.check(
    '5th distinct intel purchase -> 409 intel_cap_reached',
    r.status === 409 && r.body.error === 'intel_cap_reached',
    `status=${r.status} error=${r.body.error}`,
  )
  rec.check(
    'capped purchase does not charge coins',
    coinsOf(gA.eTeam) === before,
    `before=${before} after=${coinsOf(gA.eTeam)}`,
  )

  // ---- the suspected bug: does the cap count cards the team has LOST? ----
  const victim = cards[0]
  db(`update cards set state='expired', updated_at=now() where id='${victim.id}';`)
  const afterExpiry = intelCards(gA.gid, gA.eTeam)
  const inHand = afterExpiry.filter((c) => c.state === 'in_hand').length
  rec.note(
    `simulated tag-driven loss of ${victim.ref}: total=${afterExpiry.length} in_hand=${inHand} expired=${
      afterExpiry.length - inHand
    }`,
  )
  const r2 = await post(`/api/games/${gA.gid}/buy-intel`, {
    device_id: gA.east[0].device,
    player_id: gA.east[0].player,
    intel_ref: 'intel.direction',
  })
  // P1 FIXED (0054): the cap counts only `in_hand`, so a card destroyed by an
  // enemy action frees its slot and can be replaced.
  rec.check(
    'P1 FIXED (0054): with 3 in hand + 1 lost to the enemy, the slot is free and the rebuy succeeds',
    r2.status === 200 && r2.body.error === undefined,
    `status=${r2.status} error=${r2.body.error} in_hand=${inHand} total=${afterExpiry.length}`,
  )
  // The anti-farm guard must survive the narrower cap: a freed slot must NOT
  // let the team re-buy the SAME ref it just lost, or intel becomes churnable
  // by deliberately absorbing tags.
  const rDup = await post(`/api/games/${gA.gid}/buy-intel`, {
    device_id: gA.east[0].device,
    player_id: gA.east[0].player,
    intel_ref: victim.ref,
  })
  rec.check(
    'anti-farm intact: the freed slot cannot re-buy the ref the enemy destroyed',
    rDup.status === 409 &&
      ['intel_already_purchased', 'intel_cap_reached'].includes(rDup.body.error),
    `status=${rDup.status} error=${rDup.body.error} (re-buying ${victim.ref})`,
  )
  rec.note(
    'P1 (fixed, migration 0054): the cap now counts only in_hand intel, so a tag / intel-loss curse / decoy wipe costs the CARD but not the purchase slot. Sound because intel is never self-consumed — the only writer of state=consumed (0015:110) filters kind=challenge at 0015:117, so for intel `expired` means exactly "the enemy destroyed it". The duplicate-ref guard is deliberately left state-agnostic and is now the whole anti-farm mechanism. P16 resolves with it: Intel Loss costs exactly the one card its catalogue text promises.',
  )
})

// ---------------------------------------------------------------------------
// GAME B — refs 5-7
// ---------------------------------------------------------------------------

const gB = await makeGameN(2, 2, `intelB-${seed}`)
rec.note(`game B ${gB.code} — East buys hot-cold, surroundings, direction`)
setCoins(gB.gid, gB.eTeam, 900)

await strictStep(rec, 'card 5: intel.hot-cold', () =>
  buyAndVerify(gB, 'intel.hot-cold', { playerPos: EAST_HOME }),
)
await strictStep(rec, 'card 6: intel.surroundings', () => buyAndVerify(gB, 'intel.surroundings'))
await strictStep(rec, 'card 7: intel.direction', () => buyAndVerify(gB, 'intel.direction'))

await strictStep(rec, 'catalogue fully covered', async () => {
  const bought = [
    ...intelCards(gA.gid, gA.eTeam).map((c) => c.ref),
    ...intelCards(gB.gid, gB.eTeam).map((c) => c.ref),
  ]
  const missing = ALL_REFS.filter((r) => !bought.includes(r))
  rec.check(
    `all ${ALL_REFS.length} catalogue refs exercised`,
    missing.length === 0,
    missing.length ? `missing=${missing.join(',')}` : bought.join(','),
  )
})

// ---------------------------------------------------------------------------
// SECOND LAYOUT — the same 8 cards against an OFF-HOME real flag.
//
// Games A/B used the harness layout, where West's real flag is also West's
// home base. That makes I2 (pivot = defender's home) degenerate and I8's
// sector accidentally unique. Re-measure everything with real =
// mercado-municipal so the reported narrowing is not an artefact of one
// layout.
// ---------------------------------------------------------------------------

const ALT_REAL = 'landmark.mercado-municipal'
const ALT_DECOYS = ['landmark.parque-florestal', 'landmark.miradouro-vila-velha']
const altTable = []

async function measureAltLayout(gameTag, refs) {
  const g = await makeGameN(1, 1, gameTag)
  setCoins(g.gid, g.eTeam, 900)
  relabelWest(g.gid, g.wTeam, { real: ALT_REAL, decoys: ALT_DECOYS })
  const cands = enemyCandidates(g.gid, g.wTeam)
  const real = cands.find((c) => c.kind === 'flag_real')
  const visible = cands.map(({ ref, lat, lng }) => ({ ref, lat, lng }))
  const nonReal = new Set(cands.filter((c) => c.kind !== 'flag_real').map((c) => c.ref))
  const decoys = new Set(cands.filter((c) => c.kind === 'flag_decoy').map((c) => c.ref))

  for (const ref of refs) {
    const body = { device_id: g.east[0].device, player_id: g.east[0].player, intel_ref: ref }
    if (ref === 'intel.hot-cold') body.player_pos = freshPos(EAST_HOME)
    const r = await post(`/api/games/${g.gid}/buy-intel`, body)
    if (r.status >= 400) {
      rec.check(`alt layout ${ref}: purchase accepted`, false, `status=${r.status} ${r.body.error}`)
      continue
    }
    const a = r.body.answer
    const narrowed = narrowedByCard(a, visible)
    // Truth re-checked against the relabelled kinds.
    let truthOk
    switch (ref) {
      case 'intel.north-south':
        truthOk = a.direction === (real.lat > a.pivot_lat ? 'north' : 'south')
        break
      case 'intel.eliminate-one':
        truthOk = nonReal.has(a.not_real.ref)
        break
      case 'intel.eliminate-two':
        truthOk = a.not_real.every((n) => nonReal.has(n.ref))
        break
      case 'intel.decoy-reveal':
        truthOk = decoys.has(a.decoy.ref)
        break
      case 'intel.hot-cold':
        truthOk = a.bucket === trueBucket(hav(EAST_HOME, real))
        break
      case 'intel.surroundings':
        truthOk = typeof a.photo_url === 'string' && a.photo_url.length > 0
        break
      case 'intel.direction':
        truthOk = a.bearing === compass4(bearingDeg(PLAY_AREA_CENTRE, real))
        break
      default:
        truthOk = false
    }
    rec.check(
      `alt layout ${ref}: answer TRUE vs relabelled kind, and does not rule out the real flag`,
      truthOk && !narrowed.has(real.ref),
      `narrowed=${narrowed.size}/5 [${[...narrowed].join(', ')}] answer=${JSON.stringify(a).slice(0, 140)}`,
    )
    altTable.push({ ref, cost: COST.get(ref), narrowed: narrowed.size, correct: truthOk ? 'yes' : 'NO' })
  }
  return g
}

await strictStep(rec, 'alt layout part 1 (N/S, eliminate-one, eliminate-two, decoy-reveal)', () =>
  measureAltLayout(`intelAltA-${seed}`, [
    'intel.north-south',
    'intel.eliminate-one',
    'intel.eliminate-two',
    'intel.decoy-reveal',
  ]),
)
await strictStep(rec, 'alt layout part 2 (hot-cold, surroundings, direction)', () =>
  measureAltLayout(`intelAltB-${seed}`, [
    'intel.hot-cold',
    'intel.surroundings',
    'intel.direction',
  ]),
)

await strictStep(rec, 'layout sensitivity of the surviving pivot-based card', async () => {
  const byRef = (arr, ref) => arr.find((t) => t.ref === ref)
  rec.check(
    'SIM_EVALUATION P3a: intel.east-west is gone from the catalogue, so no clue is set by where the defender hid',
    !ALL_REFS.includes('intel.east-west') &&
      !table.some((t) => t.ref === 'intel.east-west') &&
      !altTable.some((t) => t.ref === 'intel.east-west'),
    `ALL_REFS=${ALL_REFS.length} refs, neither measured table contains it`,
  )
  rec.note(
    'intel.east-west used to narrow 4/5 when the real flag WAS the defender home and 1/5 when it was not, for the same 30 coins. Removed rather than repivoted: on the real pools the defender-home pivot splits 6/1 and 1/6 (so 6 times in 7 it eliminated exactly ONE candidate, which eliminate-one does outright for 50), and the buyer-home alternative measures 0/7 and 6/1, i.e. near-constant. north-south remains the clean half-the-map clue; east-west added only one extra partition on top of it (2 groups -> 3).',
  )
  const nsHome = byRef(table, 'intel.north-south')
  const nsAlt = byRef(altTable, 'intel.north-south')
  rec.note(
    `intel.north-south narrows ${nsHome?.narrowed}/5 vs ${nsAlt?.narrowed}/5 across the two layouts (fixed pivot ${NS_PIVOT_WEST}).`,
  )
})

// hot/cold needs GPS; prove the server says so rather than silently guessing.
await strictStep(rec, 'intel.hot-cold requires a position', async () => {
  const gx = await makeGameN(1, 1, `intelHC-${seed}`)
  setCoins(gx.gid, gx.eTeam, 900)
  const r = await post(`/api/games/${gx.gid}/buy-intel`, {
    device_id: gx.east[0].device,
    player_id: gx.east[0].player,
    intel_ref: 'intel.hot-cold',
  })
  rec.check(
    'hot-cold with no player_pos -> 400 player_pos_required',
    r.status === 400 && r.body.error === 'player_pos_required',
    `status=${r.status} error=${r.body.error}`,
  )
  const r2 = await post(`/api/games/${gx.gid}/buy-intel`, {
    device_id: gx.east[0].device,
    player_id: gx.east[0].player,
    intel_ref: 'intel.hot-cold',
    player_pos: { ...EAST_HOME, accuracy: 6, updated_at: Date.now() - 60_000 },
  })
  rec.check(
    'hot-cold with a 60 s old fix -> 409 stale_position',
    r2.status === 409 && r2.body.error === 'stale_position',
    `status=${r2.status} error=${r2.body.error}`,
  )
  rec.check(
    'neither rejected hot-cold attempt created a card',
    intelCards(gx.gid, gx.eTeam).length === 0,
    `cards=${intelCards(gx.gid, gx.eTeam).length}`,
  )
})

// Sweep every hot/cold bracket, straddling each boundary. answers.ts:9-14 uses
// `<`, so an edge value belongs to the HIGHER bracket; we probe 0.5 m either
// side rather than exactly on the edge, because "exactly 500.000 m" is not
// representable — the solver and the server's own haversine can land on
// opposite sides of the comparison at the last float bit.
await strictStep(rec, 'intel.hot-cold bracket sweep incl. boundaries', async () => {
  const cases = [
    { m: 120, expect: 'under_200m' },
    { m: 199.5, expect: 'under_200m' },
    { m: 200.5, expect: 'under_500m' },
    { m: 480, expect: 'under_500m' },
    { m: 499.5, expect: 'under_500m' },
    { m: 500.5, expect: 'under_1km' },
    { m: 980, expect: 'under_1km' },
    { m: 999.5, expect: 'under_1km' },
    { m: 1000.5, expect: 'over_1km' },
    { m: 1400, expect: 'over_1km' },
  ]
  for (const c of cases) {
    // One game per probe: hot-cold may be bought once per team per game.
    const gh = await makeGameN(1, 1, `intelHCB-${seed}-${String(c.m).replace('.', 'p')}`)
    setCoins(gh.gid, gh.eTeam, 200)
    const stand = northAtHaversine(WEST_REAL, c.m)
    const trueD = hav(stand, WEST_REAL)
    const r = await post(`/api/games/${gh.gid}/buy-intel`, {
      device_id: gh.east[0].device,
      player_id: gh.east[0].player,
      intel_ref: 'intel.hot-cold',
      player_pos: freshPos(stand),
    })
    rec.check(
      `hot-cold at ${c.m} m -> ${c.expect}`,
      r.status < 400 && r.body.answer?.bucket === c.expect,
      `trueDistance=${trueD.toFixed(1)}m bucket=${r.body.answer?.bucket} status=${r.status}`,
    )
  }
  rec.note(
    'hot-cold brackets are half-open [lo, hi): answers.ts:9-14 uses `<`, so 200 m reads under_500m and 1000 m reads over_1km.',
  )
})

// Error precedence and the guards that share the buy path.
await strictStep(rec, 'purchase guards: precedence, respawn, unknown ref, wrong actor', async () => {
  const gg = await makeGameN(2, 2, `intelG-${seed}`)
  const east = gg.east[0]
  setCoins(gg.gid, gg.eTeam, 900)

  const bad = await post(`/api/games/${gg.gid}/buy-intel`, {
    device_id: east.device,
    player_id: east.player,
    intel_ref: 'intel.does-not-exist',
  })
  rec.check(
    'unknown intel_ref -> 400 invalid_intel_ref',
    bad.status === 400 && bad.body.error === 'invalid_intel_ref',
    `status=${bad.status} error=${bad.body.error}`,
  )
  const malformed = await post(`/api/games/${gg.gid}/buy-intel`, {
    device_id: east.device,
    player_id: east.player,
    intel_ref: 'north-south',
  })
  rec.check(
    'intel_ref without the "intel." prefix -> 400 invalid_body',
    malformed.status === 400 && malformed.body.error === 'invalid_body',
    `status=${malformed.status} error=${malformed.body.error}`,
  )
  const spoof = await post(`/api/games/${gg.gid}/buy-intel`, {
    device_id: east.device,
    player_id: gg.west[0].player,
    intel_ref: 'intel.north-south',
  })
  rec.check(
    'device_id / player_id mismatch -> 403 forbidden',
    spoof.status === 403 && spoof.body.error === 'forbidden',
    `status=${spoof.status} error=${spoof.body.error}`,
  )

  // Respawning player cannot spend (actionLock.ts:39 + 0030 guard).
  db(`update players set respawning=true where id='${east.player}';`)
  const blocked = await post(`/api/games/${gg.gid}/buy-intel`, {
    device_id: east.device,
    player_id: east.player,
    intel_ref: 'intel.north-south',
  })
  rec.check(
    'respawning player cannot buy intel -> 409 player_respawning',
    blocked.status === 409 && blocked.body.error === 'player_respawning',
    `status=${blocked.status} error=${blocked.body.error}`,
  )
  clearRespawn(east.player)

  // A team-mate may buy on the team's behalf — there is no captain role.
  const mate = await post(`/api/games/${gg.gid}/buy-intel`, {
    device_id: gg.east[1].device,
    player_id: gg.east[1].player,
    intel_ref: 'intel.north-south',
  })
  rec.check(
    'any team-mate may buy for the team (no captain role)',
    mate.status < 400,
    `status=${mate.status} ${mate.body.error ?? ''}`,
  )

  // Precedence: at the cap AND duplicating a ref, the CAP error wins
  // (route.ts:225 precedes :228; 0015:247 precedes :251).
  for (const ref of ['intel.eliminate-one', 'intel.eliminate-two', 'intel.decoy-reveal']) {
    await post(`/api/games/${gg.gid}/buy-intel`, {
      device_id: east.device,
      player_id: east.player,
      intel_ref: ref,
    })
  }
  const both = await post(`/api/games/${gg.gid}/buy-intel`, {
    device_id: east.device,
    player_id: east.player,
    intel_ref: 'intel.north-south', // already owned AND team is at the cap
  })
  rec.check(
    'at cap + duplicate ref: cap error wins (cap check precedes duplicate check)',
    both.status === 409 && both.body.error === 'intel_cap_reached',
    `status=${both.status} error=${both.body.error}`,
  )
  rec.note(
    'PLAYER-EXPERIENCE: a player who re-taps an already-owned card while at the cap is told "cap reached", not "you already own this" — a slightly misleading message, but never a wrong charge.',
  )

  // Insufficient coins vs cap: BOTH layers must name the cap, because the cap
  // is permanent for the rest of the game while a coin shortfall is not. The
  // route checks the cap first (route.ts:198-229) to match the authoritative
  // RPC, which tests the cap at 0015:245-250 before the balance at :259.
  // Pinned so a future reorder cannot silently send a capped team off to earn
  // coins that can never unblock the purchase.
  setCoins(gg.gid, gg.eTeam, 0)
  const broke = await post(`/api/games/${gg.gid}/buy-intel`, {
    device_id: east.device,
    player_id: east.player,
    intel_ref: 'intel.direction',
  })
  rec.check(
    'at cap + zero coins: cap error wins over insufficient_coins (route order matches the RPC)',
    broke.status === 409 && broke.body.error === 'intel_cap_reached',
    `status=${broke.status} error=${broke.body.error}`,
  )
  // The coin check must still be reachable for a team that is NOT capped —
  // moving it after the cap check could have shadowed it entirely.
  const gp = await makeGameN(1, 1, `intelP-${seed}`)
  setCoins(gp.gid, gp.eTeam, 0)
  const poor = await post(`/api/games/${gp.gid}/buy-intel`, {
    device_id: gp.east[0].device,
    player_id: gp.east[0].player,
    intel_ref: 'intel.direction',
  })
  rec.check(
    'not capped + zero coins: still 409 insufficient_coins (coin check not shadowed by the reorder)',
    poor.status === 409 && poor.body.error === 'insufficient_coins',
    `status=${poor.status} error=${poor.body.error} details=${JSON.stringify(poor.body.details ?? {})}`,
  )
  // Same team, now funded: the cap must be what refuses it.
  setCoins(gg.gid, gg.eTeam, 900)
  const funded = await post(`/api/games/${gg.gid}/buy-intel`, {
    device_id: east.device,
    player_id: east.player,
    intel_ref: 'intel.direction',
  })
  rec.check(
    'at cap with plenty of coins: 409 intel_cap_reached',
    funded.status === 409 && funded.body.error === 'intel_cap_reached',
    `status=${funded.status} error=${funded.body.error} coins=${coinsOf(gg.eTeam)}`,
  )
})

// ---------------------------------------------------------------------------
// DECOY WIPE — the headline economy measurement
// ---------------------------------------------------------------------------

const gD = await makeGameN(2, 2, `intelD-${seed}`)
await strictStep(rec, 'decoy attempt expires ALL in-hand intel', async () => {
  setCoins(gD.gid, gD.eTeam, 900)
  const east = gD.east[0]
  await post(`/api/games/${gD.gid}/buy-intel`, {
    device_id: east.device,
    player_id: east.player,
    intel_ref: 'intel.north-south',
  })
  await post(`/api/games/${gD.gid}/buy-intel`, {
    device_id: east.device,
    player_id: east.player,
    intel_ref: 'intel.eliminate-one',
  })
  const pre = intelCards(gD.gid, gD.eTeam)
  rec.check(
    'East holds 2 in-hand cards before the raid',
    pre.length === 2 && pre.every((c) => c.state === 'in_hand'),
    `total=${pre.length} states=${pre.map((c) => c.state).join(',')}`,
  )

  advanceClockMinutes(gD.gid, 31)
  rec.clockJump({ minutes: 31, reason: 'clear the 30-min protection window' })

  const decoyRef = WEST_DECOY_REFS[0]
  const site = coord(decoyRef)
  const standing = offsetMeters(site, 10, 0)
  const proof = await uploadFlagAttemptProof(gD.gid, east.player, `decoy-${seed}`)
  const att = await post(`/api/games/${gD.gid}/attempt-flag`, {
    device_id: east.device,
    player_id: east.player,
    landmark_ref: decoyRef,
    pos: freshPos(standing),
    photo_url: proof,
  })
  rec.check(
    `decoy attempt on ${decoyRef} resolves as 'decoy'`,
    att.status < 400 && att.body.result === 'decoy',
    `status=${att.status} result=${att.body.result ?? att.body.error} d=${hav(site, standing).toFixed(1)}m`,
  )

  const post0 = intelCards(gD.gid, gD.eTeam)
  const inHand = post0.filter((c) => c.state === 'in_hand')
  const expired = post0.filter((c) => c.state === 'expired')
  rec.check(
    'decoy expired BOTH cards (no 1-card limit, unlike a tag)',
    post0.length === 2 && inHand.length === 0 && expired.length === 2,
    `total=${post0.length} in_hand=${inHand.length} expired=${expired.length}`,
  )
  rec.note(
    `after one decoy raid: total=${post0.length} in_hand=${inHand.length} expired=${expired.length}; purchases remaining = 4 - ${post0.length} = ${4 - post0.length}`,
  )

  // Can the team rebuild? Only into the 2 slots the wiped cards still occupy.
  clearRespawn(east.player)
  const r3 = await post(`/api/games/${gD.gid}/buy-intel`, {
    device_id: east.device,
    player_id: east.player,
    intel_ref: 'intel.decoy-reveal',
  })
  const r4 = await post(`/api/games/${gD.gid}/buy-intel`, {
    device_id: east.device,
    player_id: east.player,
    intel_ref: 'intel.direction',
  })
  rec.check(
    'after the wipe the team may still buy into the 2 unused slots',
    r3.status < 400 && r4.status < 400,
    `3rd=${r3.status}${r3.body.error ? ` ${r3.body.error}` : ''} 4th=${r4.status}${r4.body.error ? ` ${r4.body.error}` : ''}`,
  )
  const r5 = await post(`/api/games/${gD.gid}/buy-intel`, {
    device_id: east.device,
    player_id: east.player,
    intel_ref: 'intel.surroundings',
  })
  const final = intelCards(gD.gid, gD.eTeam)
  const finalInHand = final.filter((c) => c.state === 'in_hand').length
  rec.check(
    'P1 FIXED (0054): a 5th purchase after a decoy wipe is allowed — the wiped cards freed their slots',
    r5.status === 200 && r5.body.error === undefined,
    `status=${r5.status} error=${r5.body.error} total=${final.length} in_hand=${finalInHand}`,
  )
  rec.check(
    'a wiped team can rebuild a usable hand rather than being locked out for the game',
    finalInHand >= 3,
    `total=${final.length} purchased over the game, in_hand=${finalInHand} usable now`,
  )
  rec.note(
    `P1 (fixed, migration 0054): before the fix, one decoy raid while holding 4 cards permanently locked a team out of intel — 0 usable, 0 purchases, any balance. Now the wipe costs the cards but not the slots: the team purchased ${final.length} over the game and holds ${finalInHand}. The decoy raid is still expensive (every card lost, coins spent again to rebuild) but it is no longer terminal. Re-buying a destroyed ref is still refused, so the rebuild must be new information.`,
  )
})

// ---------------------------------------------------------------------------
// REAL TAG-DRIVEN LOSS — the production path for losing intel, so the cap
// finding above does not rest on a hand-written UPDATE.
// ---------------------------------------------------------------------------

await strictStep(rec, 'a real tag fines coins and leaves intel alone (0058)', async () => {
  const gt = await makeGameN(2, 2, `intelT-${seed}`)
  const east = gt.east[0]
  const westDefender = gt.west[0]
  setCoins(gt.gid, gt.eTeam, 900)
  for (const ref of [
    'intel.north-south',
    'intel.eliminate-one',
    'intel.eliminate-two',
    'intel.decoy-reveal',
  ]) {
    await post(`/api/games/${gt.gid}/buy-intel`, {
      device_id: east.device,
      player_id: east.player,
      intel_ref: ref,
    })
  }
  const pre = intelCards(gt.gid, gt.eTeam)
  const coinsBefore = coinsOf(gt.eTeam)
  rec.check(
    'East bought its full 4-card hand',
    pre.length === 4 && pre.every((c) => c.state === 'in_hand'),
    `total=${pre.length} in_hand=${pre.filter((c) => c.state === 'in_hand').length} coins=${coinsBefore}`,
  )

  // West defender stands on its own candidate (inside its 200 m zone); East
  // raider is 8 m away, inside the 10 m server tag range.
  const raiderPos = offsetMeters(WEST_REAL, 8, 0)
  await post(`/api/games/${gt.gid}/camping-heartbeat`, {
    device_id: westDefender.device,
    player_id: westDefender.player,
    pos: freshPos(WEST_REAL),
  })
  const tag = await post(`/api/games/${gt.gid}/tag`, {
    device_id: westDefender.device,
    tagger_player_id: westDefender.player,
    tagger_pos: freshPos(WEST_REAL),
    targets: [{ player_id: east.player, pos: freshPos(raiderPos) }],
  })
  rec.check(
    'West tags the East raider at 8 m',
    (tag.body.tagged_player_ids ?? []).length === 1,
    `status=${tag.status} tagged=${JSON.stringify(tag.body.tagged_player_ids ?? [])} rejected=${JSON.stringify(tag.body.rejected ?? [])}`,
  )

  const postTag = intelCards(gt.gid, gt.eTeam)
  const coinsAfter = coinsOf(gt.eTeam)
  rec.check(
    '0058: the tag fines exactly 40 coins',
    coinsBefore - coinsAfter === 40 && tag.body.coins_drained === 40,
    `coins ${coinsBefore} -> ${coinsAfter} (delta ${coinsBefore - coinsAfter}); route reported coins_drained=${tag.body.coins_drained}`,
  )
  rec.check(
    '0058: NO intel card is touched — the hand is intact and every card still in_hand',
    postTag.length === 4 && postTag.every((c) => c.state === 'in_hand'),
    `total=${postTag.length} in_hand=${postTag.filter((c) => c.state === 'in_hand').length} expired=${postTag.filter((c) => c.state === 'expired').length}`,
  )
  const ledger = db(
    `select count(*) from events where game_id='${gt.gid}' and type='coins_deducted' and payload->>'reason'='tag_penalty';`,
  )
  rec.check(
    'the fine is recorded as a coins_deducted event with reason tag_penalty',
    Number(ledger[0]) === 1,
    `tag_penalty coins_deducted events=${ledger[0]}`,
  )
  rec.note(
    `0058 (via the production tag path, not a hand-written UPDATE): a tag now costs the raiding team 40 coins — measured ${coinsBefore} -> ${coinsAfter} — and leaves all 4 intel cards in_hand. The old rule expired 1 random card, which read well but confiscated little: /live-state loads cards with select('*') in ANY state, so the expired card's payload (the answer) was still sent to the client and only the map narrowing stopped. The team kept the knowledge and lost an overlay, and the real cost was the re-purchase price anyway — so the fine now charges that directly. One fine per Tag ACTION, clamped at the team's balance.`,
  )
})

await strictStep(rec, 'the tag fine clamps at a broke team and never goes negative (0058)', async () => {
  const gt = await makeGameN(2, 2, `intelZ-${seed}`)
  const east = gt.east[0]
  const westDefender = gt.west[0]
  // 10 coins: less than the 40-coin fine, so the clamp is the whole point.
  setCoins(gt.gid, gt.eTeam, 10)
  const raiderPos = offsetMeters(WEST_REAL, 8, 0)
  await post(`/api/games/${gt.gid}/camping-heartbeat`, {
    device_id: westDefender.device,
    player_id: westDefender.player,
    pos: freshPos(WEST_REAL),
  })
  const tag = await post(`/api/games/${gt.gid}/tag`, {
    device_id: westDefender.device,
    tagger_player_id: westDefender.player,
    tagger_pos: freshPos(WEST_REAL),
    targets: [{ player_id: east.player, pos: freshPos(raiderPos) }],
  })
  const after = coinsOf(gt.eTeam)
  rec.check(
    '0058: a team with 10 coins is fined only 10 and lands on exactly 0, never negative',
    tag.status === 200 && after === 0 && tag.body.coins_drained === 10,
    `coins 10 -> ${after}; coins_drained=${tag.body.coins_drained}`,
  )
  const respawning = db(
    `select respawning from players where id='${east.player}';`,
  )[0]
  rec.check(
    'the tag still APPLIES to a broke team — the respawn is the real penalty',
    (tag.body.tagged_player_ids ?? []).includes(east.player) && respawning === 't',
    `tagged=${JSON.stringify(tag.body.tagged_player_ids ?? [])} respawning=${respawning}`,
  )
})

// ---------------------------------------------------------------------------
// EXACT-COIN EDGE
// ---------------------------------------------------------------------------

await strictStep(rec, 'coins exactly equal to cost', async () => {
  const gE = await makeGameN(1, 1, `intelE-${seed}`)
  const east = gE.east[0]
  const cost = COST.get('intel.eliminate-one') // 50
  setCoins(gE.gid, gE.eTeam, cost)
  const r = await post(`/api/games/${gE.gid}/buy-intel`, {
    device_id: east.device,
    player_id: east.player,
    intel_ref: 'intel.eliminate-one',
  })
  rec.check(
    `buying a ${cost}-coin card with exactly ${cost} coins succeeds`,
    r.status < 400,
    `status=${r.status} ${r.body.error ?? ''}`,
  )
  rec.check(
    'coins land on exactly 0 (not negative)',
    coinsOf(gE.eTeam) === 0 && r.body.team_coins === 0,
    `db=${coinsOf(gE.eTeam)} response=${r.body.team_coins}`,
  )
  const r2 = await post(`/api/games/${gE.gid}/buy-intel`, {
    device_id: east.device,
    player_id: east.player,
    intel_ref: 'intel.north-south',
  })
  rec.check(
    'next purchase at 0 coins -> 409 insufficient_coins',
    r2.status === 409 && r2.body.error === 'insufficient_coins',
    `status=${r2.status} error=${r2.body.error} details=${JSON.stringify(r2.body.details ?? {})}`,
  )
  rec.check(
    'insufficient purchase leaves coins at 0 and creates no card',
    coinsOf(gE.eTeam) === 0 && intelCards(gE.gid, gE.eTeam).length === 1,
    `coins=${coinsOf(gE.eTeam)} cards=${intelCards(gE.gid, gE.eTeam).length}`,
  )
  // One coin short of the cheapest card.
  setCoins(gE.gid, gE.eTeam, 29)
  const r3 = await post(`/api/games/${gE.gid}/buy-intel`, {
    device_id: east.device,
    player_id: east.player,
    intel_ref: 'intel.north-south',
  })
  rec.check(
    '29 coins vs a 30-coin card -> 409 insufficient_coins',
    r3.status === 409 && r3.body.error === 'insufficient_coins',
    `status=${r3.status} error=${r3.body.error}`,
  )
  setCoins(gE.gid, gE.eTeam, 30)
  const r4 = await post(`/api/games/${gE.gid}/buy-intel`, {
    device_id: east.device,
    player_id: east.player,
    intel_ref: 'intel.north-south',
  })
  rec.check(
    '30 coins vs a 30-coin card -> accepted, coins 0',
    r4.status < 400 && coinsOf(gE.eTeam) === 0,
    `status=${r4.status} coins=${coinsOf(gE.eTeam)}`,
  )
})

// ---------------------------------------------------------------------------
// PLAYER-EXPERIENCE READOUT: what does each card actually buy you?
// ---------------------------------------------------------------------------

await strictStep(rec, 'information-per-coin readout', async () => {
  const cands = enemyCandidates(gA.gid, gA.wTeam).map(({ ref, lat, lng, kind }) => ({
    ref,
    lat,
    lng,
    kind,
  }))
  const real = cands.find((c) => c.kind === 'flag_real')

  // intel.direction narrows 0 refs mechanically — but is the answer even
  // ambiguous to a human reading the map?
  const sectors = cands.map((c) => ({
    ref: c.ref,
    sector: compass4(bearingDeg(PLAY_AREA_CENTRE, c)),
  }))
  const realSector = compass4(bearingDeg(PLAY_AREA_CENTRE, real))
  const sameSector = sectors.filter((s) => s.sector === realSector)
  rec.note(
    `intel.direction sectors from PLAY_AREA_CENTRE: ${sectors
      .map((s) => `${s.ref.replace('landmark.', '')}=${s.sector}`)
      .join(', ')}`,
  )
  rec.check(
    `intel.direction (${COST.get('intel.direction')} coins) dims 0 candidates on the map although only ${sameSector.length}/5 sit in sector ${realSector}`,
    sameSector.length >= 1,
    `sector=${realSector} candidatesInSector=${sameSector.map((s) => s.ref).join(',')} narrowedByApp=0`,
  )
  if (sameSector.length === 1) {
    rec.note(
      `PLAYER-EXPERIENCE: intel.direction is a UNIQUE solve for this pool (only ${sameSector[0].ref} is ${realSector}) yet narrowing.ts:112-119 deliberately dims nothing, so the app shows no progress for 80 coins.`,
    )
  }

  // The intel.east-west measurement that used to live here is gone with the
  // card (SIM_EVALUATION P3a): hiding on the defender's own home made its pivot
  // equal its target, so the cheapest card in the deck narrowed 4/5. No hand can
  // contain it any more; the removal is asserted in the layout-sensitivity step.

  // Cheapest-first ranking, so the report can call out mispricing.
  const ranked = table
    .filter((t) => typeof t.narrowed === 'number')
    .map((t) => ({ ...t, coinsPerRef: t.narrowed ? t.cost / t.narrowed : Infinity }))
    .sort((a, b) => a.coinsPerRef - b.coinsPerRef)
  for (const row of ranked) {
    rec.note(
      `price/value: ${row.ref} ${row.cost} coins -> ${row.narrowed} refs (${
        row.coinsPerRef === Infinity ? 'no mechanical narrowing' : `${row.coinsPerRef.toFixed(0)} coins/ref`
      })`,
    )
  }
  const zeroValue = ranked.filter((r) => r.narrowed === 0)
  rec.check(
    `${zeroValue.length} card(s) narrow 0 candidates while costing coins`,
    true,
    zeroValue.map((r) => `${r.ref}@${r.cost}`).join(', ') || 'none',
  )
})

console.log('\n=== INTEL TABLE (harness layout: West real flag == West home base) ===')
console.log('ref | cost | refs narrowed | answer correct?')
for (const t of table) {
  console.log(`${t.ref} | ${t.cost} | ${t.narrowed} | ${t.correct}`)
}
console.log('\n=== INTEL TABLE (alt layout: real flag = mercado-municipal, off home) ===')
console.log('ref | cost | refs narrowed | answer correct?')
for (const t of altTable) {
  console.log(`${t.ref} | ${t.cost} | ${t.narrowed} | ${t.correct}`)
}

const { failed } = rec.finish({ intelTable: table, intelTableAltLayout: altTable })
process.exitCode = failed > 0 ? 1 : 0
