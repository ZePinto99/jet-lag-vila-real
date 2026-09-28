// Strict, repeatable API/business-rule regression matrix.
//
// This intentionally creates isolated games and never resets shared tables.
// Every invariant uses assert, so any regression exits non-zero. It exercises
// concurrent phones, negative guards, storage-backed proofs, phase/event
// atomicity, the complete intel/curse catalogs, pause timers, two-stage
// respawn, and terminal idempotency.

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import {
  BASE,
  EAST_ASSIGN,
  WEST_ASSIGN,
  apiGet,
  apiPost,
  adminRpc,
  backdateStart,
  coord,
  db,
  makeGameN,
  uploadChallengeProof,
  uploadFlagAttemptProof,
  uploadSurroundingsPhoto,
} from './harness.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const challenges = JSON.parse(readFileSync(resolve(here, '../../data/challenges.json'), 'utf8'))
const curses = JSON.parse(readFileSync(resolve(here, '../../data/curses.json'), 'utf8'))
const intel = JSON.parse(readFileSync(resolve(here, '../../data/intel.json'), 'utf8'))
const landmarks = JSON.parse(readFileSync(resolve(here, '../../data/landmarks.json'), 'utf8'))

let checks = 0
function pass(label) { checks += 1; console.log(`  ✅ ${label}`) }
function scalar(sql) { return db(sql)[0] ?? '' }
function number(sql) { return Number(scalar(sql)) }
function point(ref) {
  const item = landmarks.find((candidate) => candidate.id === ref)
  assert.ok(item, `missing landmark ${ref}`)
  return { lat: item.lat, lng: item.lng }
}
async function request(path, body) {
  const response = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let json
  try { json = JSON.parse(text) } catch { json = { raw: text } }
  return { status: response.status, json }
}
function playerOf(join) { return join.player?.id ?? join.me?.id ?? join.id }

async function createAtomicPhaseGame(tag) {
  const created = await apiPost('/api/games', {
    display_name: 'West 1', device_id: `rules-${tag}-w1`, preferred_side: 'west',
  })
  const gid = created.game.id
  const code = created.game.code
  const wTeam = created.teams.find((team) => team.side === 'west').id
  const eTeam = created.teams.find((team) => team.side === 'east').id
  const west = [{ device: `rules-${tag}-w1`, player: created.me.id }]
  const east = []
  for (const [side, index] of [['west', 2], ['east', 1], ['east', 2]]) {
    const device = `rules-${tag}-${side[0]}${index}`
    const joined = await apiPost(`/api/games/${gid}/join`, {
      display_name: `${side} ${index}`, device_id: device, preferred_side: side,
    })
    ;(side === 'west' ? west : east).push({ device, player: playerOf(joined) })
  }
  for (const player of [...west, ...east]) {
    await apiPost(`/api/games/${gid}/ready`, {
      device_id: player.device, player_id: player.player, ready: true,
    })
  }

  const starts = await Promise.all(Array.from({ length: 10 }, () =>
    request(`/api/games/${gid}/start`, { device_id: west[0].device })))
  assert.ok(starts.every((result) => result.status === 200))
  assert.equal(number(`select count(*) from events where game_id='${gid}' and type='game_started';`), 1)
  assert.equal(scalar(`select status from games where id='${gid}';`), 'setup')
  pass('10 concurrent starts commit one setup transition + game_started event')

  const westPath = await uploadSurroundingsPhoto(gid, wTeam, `${tag}-same-path`)
  const westSetups = await Promise.all(Array.from({ length: 6 }, () =>
    request(`/api/games/${gid}/flag-setup`, {
      device_id: west[0].device,
      assignments: WEST_ASSIGN,
      surroundings_photo_path: westPath,
    })))
  assert.equal(westSetups.filter((result) => result.status === 200).length, 1)
  assert.ok(westSetups.filter((result) => result.status === 409).length >= 5)
  assert.equal(number(`select count(*) from landmarks where game_id='${gid}' and team_id='${wTeam}';`), 5)
  assert.equal(number(`select count(*) from flag_surroundings where game_id='${gid}' and team_id='${wTeam}';`), 1)
  pass('same-path setup race keeps one 5-landmark assignment and private object reference')

  const eastPath = await uploadSurroundingsPhoto(gid, eTeam, `${tag}-east`)
  const eastSetups = await Promise.all(Array.from({ length: 6 }, () =>
    request(`/api/games/${gid}/flag-setup`, {
      device_id: east[0].device,
      assignments: EAST_ASSIGN,
      surroundings_photo_path: eastPath,
    })))
  assert.equal(eastSetups.filter((result) => result.status === 200).length, 1)
  assert.equal(scalar(`select status from games where id='${gid}';`), 'live')
  assert.equal(number(`select count(*) from events where game_id='${gid}' and type='flags_assigned';`), 2)
  assert.equal(number(`select count(*) from events where game_id='${gid}' and type='game_live';`), 1)
  pass('second-team setup race commits one live transition + game_live event')
  return { gid, code, wTeam, eTeam, west, east }
}

async function rosterCapScenario(tag) {
  const created = await apiPost('/api/games', {
    display_name: 'Roster host', device_id: `roster-${tag}-host`, preferred_side: 'west',
  })
  const gid = created.game.id
  const joins = await Promise.all(Array.from({ length: 10 }, (_, index) =>
    request(`/api/games/${gid}/join`, {
      display_name: `W${index + 2}`,
      device_id: `roster-${tag}-${index}`,
      preferred_side: 'west',
    })))
  assert.equal(joins.filter((result) => result.status === 201).length, 3)
  const westTeam = created.teams.find((team) => team.side === 'west').id
  assert.equal(number(`select count(*) from players where team_id='${westTeam}';`), 4)
  pass('concurrent lobby joins enforce the four-player team cap in Postgres')
}

async function oneVsOneScenario(tag) {
  const game = await makeGameN(1, 1, `one-v-one-${tag}`)
  assert.equal(scalar(`select status from games where id='${game.gid}';`), 'live')
  assert.equal(
    number(
      `select count(*) from players p join teams t on t.id=p.team_id where t.game_id='${game.gid}';`,
    ),
    2,
  )

  const dealt = await apiGet(
    `/api/games/${game.gid}/challenges?device_id=${game.west[0].device}`,
  )
  assert.equal(dealt.active.length, 3)
  assert.ok(
    dealt.active.every((definition) => (definition.min_team_size ?? 1) <= 1),
  )
  pass('equal 1v1 roster reaches live play with only solo-compatible challenges')
}

async function challengeScenario(g) {
  const gets = await Promise.all(Array.from({ length: 12 }, () =>
    fetch(`${BASE}/api/games/${g.gid}/challenges?device_id=${g.west[0].device}`)))
  const failedGets = gets.filter((result) => result.status !== 200)
  const failureDetails = await Promise.all(
    failedGets.map(async (result) => ({ status: result.status, body: await result.text() })),
  )
  assert.ok(
    failedGets.length === 0,
    `challenge GET failures: ${JSON.stringify(failureDetails)}`,
  )
  assert.equal(number(`select count(*) from cards where game_id='${g.gid}' and team_id='${g.wTeam}' and kind='challenge' and state in ('available','pending');`), 3)
  assert.equal(number(`select count(distinct ref) from cards where game_id='${g.gid}' and team_id='${g.wTeam}' and kind='challenge' and state in ('available','pending');`), 3)
  pass('12 concurrent first challenge loads deal exactly three distinct cards')

  const def = challenges.find((candidate) => candidate.photo_required && candidate.landmark_ref)
  assert.ok(def)
  db(`delete from cards where game_id='${g.gid}' and team_id='${g.wTeam}' and kind='challenge';`)
  const cardId = scalar(`insert into cards(game_id,team_id,kind,ref,state,payload) values ('${g.gid}','${g.wTeam}','challenge','${def.id}','available','{}') returning id;`)
  const pos = { ...point(def.landmark_ref), accuracy: 5, updated_at: Date.now() }
  const base = {
    device_id: g.west[0].device, player_id: g.west[0].player,
    challenge_ref: def.id, pos,
  }
  const fake = await request(`/api/games/${g.gid}/submit-challenge`, {
    ...base, photo_url: 'https://example.com/not-a-proof.jpg',
  })
  assert.equal(fake.status, 400)
  assert.equal(fake.json.error, 'invalid_photo_url')
  assert.equal(scalar(`select state from cards where id='${cardId}';`), 'available')
  pass('challenge API rejects external/nonexistent photo proofs without mutating state')

  const proof = await uploadChallengeProof(g.gid, g.west[0].player, 'atomic-review')
  const submissions = await Promise.all(Array.from({ length: 10 }, () =>
    request(`/api/games/${g.gid}/submit-challenge`, { ...base, photo_url: proof })))
  assert.equal(submissions.filter((result) => result.status === 200).length, 1)
  assert.equal(number(`select count(*) from events where game_id='${g.gid}' and type='challenge_submitted' and payload->>'card_id'='${cardId}';`), 1)

  const reviewBody = {
    device_id: g.east[0].device, player_id: g.east[0].player, card_id: cardId,
  }
  const [accept, reject] = await Promise.all([
    request(`/api/games/${g.gid}/accept-challenge`, reviewBody),
    request(`/api/games/${g.gid}/reject-challenge`, reviewBody),
  ])
  assert.equal([accept, reject].filter((result) => result.status === 200).length, 1)
  assert.equal(number(`select count(*) from events where game_id='${g.gid}' and type in ('challenge_completed','challenge_rejected') and payload->>'card_id'='${cardId}';`), 1)
  pass('duplicate submit and accept-vs-reject races yield one review outcome/event')
}

async function challengeAutoAcceptScenario() {
  const g = await makeGameN(2, 2, `challenge-auto-${Date.now()}`)
  const challenge = challenges.find((candidate) => candidate.photo_required)
  assert.ok(challenge)
  const cardId = scalar(`insert into cards(game_id,team_id,kind,ref,state,payload,updated_at) values ('${g.gid}','${g.wTeam}','challenge','${challenge.id}','pending',jsonb_build_object('submitted_by','${g.west[0].player}','photo_url','https://proof.invalid/auto.jpg','submitted_at',(now()-interval '121 seconds')::text),now()) returning id;`)
  const before = number(`select coins from teams where id='${g.wTeam}';`)
  const resolved = await apiPost(`/api/games/${g.gid}/resolve-challenge-reviews`, {
    device_id: g.east[0].device,
  })
  assert.deepEqual(resolved.resolved_card_ids, [cardId])
  assert.equal(scalar(`select state from cards where id='${cardId}';`), 'consumed')
  assert.equal(number(`select coins from teams where id='${g.wTeam}';`), before + challenge.reward_coins + 30)
  assert.equal(number(`select count(*) from events where game_id='${g.gid}' and type='challenge_completed' and payload->>'card_id'='${cardId}';`), 1)
  assert.equal(number(`select count(*) from events where game_id='${g.gid}' and type='challenge_auto_accepted' and payload->>'card_id'='${cardId}';`), 1)

  const retried = await apiPost(`/api/games/${g.gid}/resolve-challenge-reviews`, {
    device_id: g.west[0].device,
  })
  assert.deepEqual(retried.resolved_card_ids, [])
  assert.equal(number(`select count(*) from events where game_id='${g.gid}' and type='challenge_completed' and payload->>'card_id'='${cardId}';`), 1)
  pass('120-second challenge deadline auto-accepts and credits/draws exactly once across retries')
}

async function economyScenario(g) {
  backdateStart(g.gid, 31)
  const before = number(`select coins from teams where id='${g.wTeam}';`)
  const ticks = await Promise.all(Array.from({ length: 16 }, () =>
    request(`/api/games/${g.gid}/time-tick`, { device_id: g.west[0].device })))
  assert.ok(ticks.every((result) => result.status === 200))
  assert.equal(number(`select count(*) from events where game_id='${g.gid}' and type='time_bonus' and payload->>'interval'='1';`), 1)
  assert.equal(number(`select coins from teams where id='${g.wTeam}';`), before + 20)
  pass('16 concurrent time ticks credit one +20 interval without phantom events')

  db(`update teams set coins=150 where id='${g.wTeam}';`)
  const hardens = await Promise.all(Array.from({ length: 10 }, () =>
    request(`/api/games/${g.gid}/harden-flag`, {
      device_id: g.west[0].device, player_id: g.west[0].player,
      landmark_ref: 'landmark.miradouro-vila-velha',
    })))
  assert.equal(hardens.filter((result) => result.status === 200).length, 1)
  assert.equal(number(`select count(*) from events where game_id='${g.gid}' and type='coins_deducted' and payload->>'reason'='harden_flag';`), 1)
  const hardenedPayload = JSON.parse(scalar(`select payload::text from events where game_id='${g.gid}' and type='flag_hardened' order by created_at desc,id desc limit 1;`))
  assert.deepEqual(hardenedPayload, { team_id: g.wTeam })
  const ownLive = await apiGet(`/api/games/${g.gid}/live-state?device_id=${g.west[0].device}`)
  const enemyLive = await apiGet(`/api/games/${g.gid}/live-state?device_id=${g.east[0].device}`)
  assert.equal(ownLive.my_team_landmarks.find((landmark) => landmark.kind === 'flag_real').hardened, true)
  assert.ok(enemyLive.enemy_landmarks.every((landmark) => !('hardened' in landmark) && !('kind' in landmark)))

  db(`update teams set coins=120 where id='${g.wTeam}';`)
  const places = await Promise.all(Array.from({ length: 10 }, () =>
    request(`/api/games/${g.gid}/place-curse`, {
      device_id: g.west[0].device, player_id: g.west[0].player,
      landmark_ref: 'landmark.mercado-municipal', placed_ref: 'placed.snare',
    })))
  assert.equal(places.filter((result) => result.status === 200).length, 1)
  assert.equal(number(`select count(*) from placed_curses where game_id='${g.gid}' and owner_team_id='${g.wTeam}';`), 1)
  pass('harden and placed-curse spend races debit and create their one-time resource once')
}

async function respawnActionGuardScenario() {
  const g = await makeGameN(2, 2, `respawn-actions-${Date.now()}`)
  db(`update teams set coins=2000 where game_id='${g.gid}';`)
  db(`update players set respawning=true,respawn_arrived=false,respawn_target_ref='landmark.jardim-carreira' where id='${g.west[0].player}';`)
  const challenge = challenges[0]
  const pendingCard = scalar(`insert into cards(game_id,team_id,kind,ref,state,payload) values ('${g.gid}','${g.eTeam}','challenge','${challenge.id}','pending','{"submitted_by":"${g.east[0].player}","photo_url":"https://proof.invalid/test.jpg"}') returning id;`)
  const beforeCoins = number(`select coins from teams where id='${g.wTeam}';`)
  const beforeEvents = number(`select count(*) from events where game_id='${g.gid}';`)
  const calls = [
    request(`/api/games/${g.gid}/buy-intel`, {
      device_id: g.west[0].device, player_id: g.west[0].player,
      intel_ref: 'intel.north-south',
    }),
    request(`/api/games/${g.gid}/buy-curse`, {
      device_id: g.west[0].device, player_id: g.west[0].player, num_dice: 1,
    }),
    request(`/api/games/${g.gid}/place-curse`, {
      device_id: g.west[0].device, player_id: g.west[0].player,
      landmark_ref: 'landmark.mercado-municipal', placed_ref: 'placed.snare',
    }),
    request(`/api/games/${g.gid}/harden-flag`, {
      device_id: g.west[0].device, player_id: g.west[0].player,
      landmark_ref: 'landmark.miradouro-vila-velha',
    }),
    request(`/api/games/${g.gid}/accept-challenge`, {
      device_id: g.west[0].device, player_id: g.west[0].player, card_id: pendingCard,
    }),
    request(`/api/games/${g.gid}/reject-challenge`, {
      device_id: g.west[0].device, player_id: g.west[0].player, card_id: pendingCard,
    }),
  ]
  const results = await Promise.all(calls)
  assert.ok(results.every((result) => result.status === 409 && result.json.error === 'player_respawning'))
  assert.equal(number(`select coins from teams where id='${g.wTeam}';`), beforeCoins)
  assert.equal(number(`select count(*) from events where game_id='${g.gid}';`), beforeEvents)
  assert.equal(scalar(`select state from cards where id='${pendingCard}';`), 'pending')
  assert.equal(number(`select count(*) from placed_curses where game_id='${g.gid}' and owner_team_id='${g.wTeam}';`), 0)
  assert.equal(scalar(`select coalesce(bool_or(hardened),false) from landmarks where game_id='${g.gid}' and team_id='${g.wTeam}';`), 'f')
  pass('tagged/decoy respawn blocks spend, placement, harden, and peer review without side effects')
}

async function reloadDeadlineAndResultsScenario() {
  const g = await makeGameN(2, 2, `reload-results-${Date.now()}`)
  db(`update teams set coins=2000 where game_id='${g.gid}';`)
  const challenge = challenges[0]
  const cardId = scalar(`insert into cards(game_id,team_id,kind,ref,state,payload) values ('${g.gid}','${g.eTeam}','challenge','${challenge.id}','pending','{"submitted_by":"${g.east[0].player}","photo_url":"https://proof.invalid/durable.jpg"}') returning id;`)
  db(`insert into events(game_id,type,actor_player_id,payload) values ('${g.gid}','challenge_submitted','${g.east[0].player}','{"card_id":"${cardId}","team_id":"${g.eTeam}"}');`)
  db(`insert into events(game_id,type,payload) select '${g.gid}','scenario_churn',jsonb_build_object('n',n) from generate_series(1,220) n;`)
  const live = await apiGet(`/api/games/${g.gid}/live-state?device_id=${g.west[0].device}`)
  assert.equal(live.recent_events.length, 50)
  assert.equal(live.recent_events.some((event) => event.type === 'challenge_submitted'), false)
  assert.equal(live.pending_challenge_reviews.some((card) => card.id === cardId), true)
  pass('pending challenge reviews survive reload after more than 50 later events')

  // Exercise a deliberately late timeout worker: authoritative settlement for
  // the standard three-hour game must stop at six half-hour bonuses, even a
  // full day after started_at.
  backdateStart(g.gid, 24 * 60)
  const seventh = await adminRpc('apply_time_bonus_interval', {
    p_game_id: g.gid,
    p_actor_player_id: g.west[0].player,
    p_interval: 7,
    p_amount: 20,
    p_is_power_hour: false,
  })
  assert.equal(seventh.error, null)
  assert.equal(seventh.data, false)
  const beforeCoins = number(`select coins from teams where id='${g.wTeam}';`)
  const expiredBeforeTerminal = await request(`/api/games/${g.gid}/buy-intel`, {
    device_id: g.west[0].device, player_id: g.west[0].player,
    intel_ref: 'intel.north-south',
  })
  assert.equal(expiredBeforeTerminal.status, 409)
  assert.equal(expiredBeforeTerminal.json.error, 'game_expired')
  const [lateAction, finish] = await Promise.all([
    request(`/api/games/${g.gid}/buy-intel`, {
      device_id: g.west[0].device, player_id: g.west[0].player,
      intel_ref: 'intel.eliminate-one',
    }),
    request(`/api/games/${g.gid}/end-by-timeout`, { device_id: g.east[0].device }),
  ])
  assert.equal(lateAction.status, 409)
  assert.ok(['game_expired', 'game_not_in_play'].includes(lateAction.json.error))
  assert.equal(finish.status, 200)
  assert.equal(number(`select coins from teams where id='${g.wTeam}';`), beforeCoins + 120)
  assert.equal(number(`select count(*) from events where game_id='${g.gid}' and type='time_bonus';`), 6)
  assert.equal(number(`select count(*) from events where game_id='${g.gid}' and type='time_bonus' and (payload->>'interval')::int > 6;`), 0)
  assert.equal(scalar(`select status from games where id='${g.gid}';`), 'finished')

  const collected = []
  let offset = 0
  let summary = null
  do {
    summary = await apiGet(`/api/games/${g.gid}/results?device_id=${g.west[0].device}&offset=${offset}&limit=100`)
    collected.push(...summary.timeline_events)
    offset = summary.timeline_next_offset
  } while (offset !== null)
  assert.ok(summary.timeline_total > 200)
  assert.equal(collected.length, summary.timeline_total)
  assert.equal(new Set(collected.map((event) => event.id)).size, summary.timeline_total)
  assert.ok(summary.winner_team_id === g.wTeam || summary.winner_team_id === g.eTeam)
  const persistedScores = JSON.parse(scalar(`select payload->'scores' from events where game_id='${g.gid}' and type='game_ended_by_timeout' order by created_at desc,id desc limit 1;`))
  assert.deepEqual(
    summary.scores
      .map((score) => ({ ...score, total: Number(score.total) }))
      .sort((a, b) => a.team_id.localeCompare(b.team_id)),
    persistedScores
      .map((score) => ({ ...score, total: Number(score.total) }))
      .sort((a, b) => a.team_id.localeCompare(b.team_id)),
  )
  pass('deadline rejects mutations transactionally and >200-event results reload with complete scoring + paginated timeline')
}

async function pauseActionRaceScenario() {
  const g = await makeGameN(2, 2, `pause-action-race-${Date.now()}`)
  db(`update teams set coins=2000 where game_id='${g.gid}';`)
  const proposed = await request(`/api/games/${g.gid}/pause`, {
    device_id: g.west[0].device, player_id: g.west[0].player, action: 'pause',
  })
  assert.equal(proposed.status, 200)
  const [confirmed, action] = await Promise.all([
    request(`/api/games/${g.gid}/pause`, {
      device_id: g.east[0].device, player_id: g.east[0].player, action: 'pause',
    }),
    request(`/api/games/${g.gid}/buy-intel`, {
      device_id: g.east[0].device, player_id: g.east[0].player,
      intel_ref: 'intel.north-south',
    }),
  ])
  assert.equal(confirmed.status, 200)
  assert.equal(scalar(`select status from games where id='${g.gid}';`), 'paused')
  assert.ok(action.status === 200 || (action.status === 409 && action.json.error === 'game_not_in_play'))
  const cardsAfterRace = number(`select count(*) from cards where game_id='${g.gid}' and team_id='${g.eTeam}' and kind='intel';`)
  assert.equal(cardsAfterRace, action.status === 200 ? 1 : 0)
  const retry = await request(`/api/games/${g.gid}/buy-intel`, {
    device_id: g.east[0].device, player_id: g.east[0].player,
    intel_ref: action.status === 200 ? 'intel.eliminate-one' : 'intel.north-south',
  })
  assert.equal(retry.status, 409)
  assert.equal(number(`select count(*) from cards where game_id='${g.gid}' and team_id='${g.eTeam}' and kind='intel';`), cardsAfterRace)
  pass('pause/action game-row race commits at most the action ordered before pause and rejects every later retry')
}

async function actionLockRaceScenario() {
  const g = await makeGameN(2, 2, `action-lock-race-${Date.now()}`)
  db(`update teams set coins=2000 where game_id='${g.gid}'; delete from active_curses where game_id='${g.gid}';`)
  const [castResult, action] = await Promise.all([
    adminRpc('buy_curse_atomic', {
      p_game_id: g.gid,
      p_buyer_team_id: g.eTeam,
      p_target_team_id: g.wTeam,
      p_actor_player_id: g.east[0].player,
      p_cost: 150,
      p_num_dice: 3,
      p_dice_total: 18,
      p_dice_rolls: [6, 6, 6],
      p_curse_ref: 'curse.full-stop',
      p_tier: 'major',
      p_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      p_params: {},
    }),
    request(`/api/games/${g.gid}/buy-intel`, {
      device_id: g.west[0].device, player_id: g.west[0].player,
      intel_ref: 'intel.north-south',
    }),
  ])
  assert.equal(castResult.error, null)
  assert.equal(castResult.data.error, undefined)
  assert.equal(number(`select count(*) from active_curses where game_id='${g.gid}' and target_team_id='${g.wTeam}' and curse_ref='curse.full-stop';`), 1)
  assert.ok(action.status === 200 || (action.status === 409 && action.json.error === 'actions_locked'))
  const cardsAfterRace = number(`select count(*) from cards where game_id='${g.gid}' and team_id='${g.wTeam}' and kind='intel';`)
  assert.equal(cardsAfterRace, action.status === 200 ? 1 : 0)
  const retry = await request(`/api/games/${g.gid}/buy-intel`, {
    device_id: g.west[0].device, player_id: g.west[0].player,
    intel_ref: action.status === 200 ? 'intel.eliminate-one' : 'intel.north-south',
  })
  assert.equal(retry.status, 409)
  assert.equal(retry.json.error, 'actions_locked')
  assert.equal(number(`select count(*) from cards where game_id='${g.gid}' and team_id='${g.wTeam}' and kind='intel';`), cardsAfterRace)
  pass('Full Stop/action lock race serializes on game row and permits only mutations ordered before the cast')
}

async function bulkTagAtomicScenario() {
  const g = await makeGameN(2, 2, `bulk-tag-${Date.now()}`)
  const library = point('landmark.miradouro-vila-velha')
  const camping = await apiPost(`/api/games/${g.gid}/camping-heartbeat`, {
    device_id: g.west[0].device,
    player_id: g.west[0].player,
    pos: { ...library, accuracy: 5, updated_at: Date.now() },
  })
  db(`update players set respawning=true,respawn_target_ref='landmark.jardim-da-carreira' where id='${g.east[1].player}';`)
  const rejectedBatch = await adminRpc('apply_tags_atomic', {
    p_game_id: g.gid,
    p_raider_player_ids: [g.east[0].player, g.east[1].player],
    p_defender_player_id: g.west[0].player,
    p_lat: library.lat,
    p_lng: library.lng,
    p_respawn_target_ref: 'landmark.jardim-da-carreira',
    p_expected_camping_heartbeat_at: camping.last_heartbeat_at,
  })
  assert.equal(rejectedBatch.error, null)
  assert.equal(rejectedBatch.data.error, 'target_state_changed')
  assert.equal(scalar(`select respawning from players where id='${g.east[0].player}';`), 'f')
  assert.equal(number(`select count(*) from events where game_id='${g.gid}' and type='tag';`), 0)
  db(`update players set respawning=false,respawn_target_ref=null,respawn_arrived=false where id='${g.east[1].player}';`)
  const tagged = await request(`/api/games/${g.gid}/tag`, {
    device_id: g.west[0].device,
    tagger_player_id: g.west[0].player,
    tagger_pos: { ...library, accuracy: 5, updated_at: Date.now() },
    targets: g.east.map((player, index) => ({
      player_id: player.player,
      pos: {
        lat: library.lat + (index + 1) * 0.000005,
        lng: library.lng,
        accuracy: 5,
        updated_at: Date.now(),
      },
    })),
  })
  assert.equal(tagged.status, 200)
  assert.deepEqual([...tagged.json.tagged_player_ids].sort(), g.east.map((player) => player.player).sort())
  assert.equal(number(`select count(*) from events where game_id='${g.gid}' and type='tag';`), 2)
  pass('bulk tag precondition failure rolls back all targets; valid two-raider tap commits both')

  const race = await makeGameN(2, 2, `bulk-tag-pause-${Date.now()}`)
  const firstVote = await request(`/api/games/${race.gid}/pause`, {
    device_id: race.west[0].device,
    player_id: race.west[0].player,
    action: 'pause',
  })
  assert.equal(firstVote.status, 200)
  const tagBody = {
    device_id: race.west[0].device,
    tagger_player_id: race.west[0].player,
    tagger_pos: { ...library, accuracy: 5, updated_at: Date.now() },
    targets: race.east.map((player, index) => ({
      player_id: player.player,
      pos: {
        lat: library.lat + (index + 1) * 0.000005,
        lng: library.lng,
        accuracy: 5,
        updated_at: Date.now(),
      },
    })),
  }
  const [paused, racedTag] = await Promise.all([
    request(`/api/games/${race.gid}/pause`, {
      device_id: race.east[0].device,
      player_id: race.east[0].player,
      action: 'pause',
    }),
    request(`/api/games/${race.gid}/tag`, tagBody),
  ])
  assert.equal(paused.status, 200)
  const tagCount = number(`select count(*) from events where game_id='${race.gid}' and type='tag';`)
  const respawningCount = number(`select count(*) from players where id in ('${race.east[0].player}','${race.east[1].player}') and respawning;`)
  assert.ok(tagCount === 0 || tagCount === 2)
  assert.equal(respawningCount, tagCount)
  assert.ok(racedTag.status === 200 || racedTag.status === 409)
  pass('pause-vs-two-raider tag barrier is all-or-none with no partial respawn/events')
}

async function removeStartRaceScenario(tag) {
  const created = await apiPost('/api/games', {
    display_name: 'Race host', device_id: `remove-race-${tag}-w1`, preferred_side: 'west',
  })
  const gid = created.game.id
  const players = [{ device: `remove-race-${tag}-w1`, player: created.me.id }]
  for (const [side, index] of [['west', 2], ['east', 1], ['east', 2]]) {
    const device = `remove-race-${tag}-${side[0]}${index}`
    const joined = await apiPost(`/api/games/${gid}/join`, {
      display_name: `${side} ${index}`, device_id: device, preferred_side: side,
    })
    players.push({ device, player: playerOf(joined) })
  }
  for (const player of players) {
    await apiPost(`/api/games/${gid}/ready`, {
      device_id: player.device, player_id: player.player, ready: true,
    })
  }
  const target = players[3]
  const [start, remove] = await Promise.all([
    request(`/api/games/${gid}/start`, { device_id: players[0].device }),
    request(`/api/games/${gid}/remove-player`, {
      device_id: players[0].device, target_player_id: target.player,
    }),
  ])
  assert.ok(
    (start.status === 200 && remove.status === 409) ||
    (remove.status === 200 && start.status === 409),
  )
  const status = scalar(`select status from games where id='${gid}';`)
  const playerCount = number(`select count(*) from players p join teams t on t.id=p.team_id where t.game_id='${gid}';`)
  assert.ok((status === 'setup' && playerCount === 4) || (status === 'lobby' && playerCount === 3))
  assert.equal(number(`select count(*) from events where game_id='${gid}' and type='player_left';`), remove.status === 200 ? 1 : 0)
  pass('atomic remove-vs-start barrier yields either intact setup or one lobby removal/host event')
}

async function pauseScenario(g) {
  db(`delete from active_curses where game_id='${g.gid}';`)
  const row = scalar(`insert into active_curses(game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${g.gid}','${g.eTeam}','curse.frozen',now()-interval '2 minutes',now()+interval '6 minutes','{}') returning id||'|'||extract(epoch from started_at)::bigint||'|'||extract(epoch from expires_at)::bigint;`)
  const [curseId, startBefore, expiryBefore] = row.split('|')
  const pauseBody = { device_id: g.west[0].device, player_id: g.west[0].player, action: 'pause' }
  const first = await request(`/api/games/${g.gid}/pause`, pauseBody)
  assert.equal(first.status, 200); assert.equal(first.json.pending, true)
  const repeated = await request(`/api/games/${g.gid}/pause`, pauseBody)
  assert.equal(repeated.json.proposal_expires_at, first.json.proposal_expires_at)
  const confirms = await Promise.all(Array.from({ length: 8 }, () =>
    request(`/api/games/${g.gid}/pause`, {
      device_id: g.east[0].device, player_id: g.east[0].player, action: 'pause',
    })))
  assert.ok(confirms.every((result) => result.status === 200))
  assert.equal(scalar(`select status from games where id='${g.gid}';`), 'paused')
  assert.equal(number(`select count(*) from events where game_id='${g.gid}' and type='game_paused';`), 1)

  db(`insert into active_curses(game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${g.gid}','${g.eTeam}','curse.slow-walk',now()-interval '10 minutes',now()-interval '1 minute','{}');`)
  const expiredWhilePaused = await apiPost(`/api/games/${g.gid}/expire-curses`, { device_id: g.west[0].device })
  assert.deepEqual(expiredWhilePaused.expired_curse_ids, [])
  const tickWhilePaused = await request(`/api/games/${g.gid}/time-tick`, { device_id: g.west[0].device })
  assert.equal(tickWhilePaused.status, 409)
  const frozenWhilePaused = await request(`/api/games/${g.gid}/extend-curse`, {
    device_id: g.east[0].device, player_id: g.east[0].player, curse_id: curseId,
    anchor_pos: { ...point('landmark.biblioteca-municipal'), accuracy: 5, updated_at: Date.now() },
  })
  assert.equal(frozenWhilePaused.status, 409)

  db(`update games set config=jsonb_set(config,'{weather_pause,paused_at}',to_jsonb((now()-interval '120 seconds')::text),false) where id='${g.gid}';`)
  const resumeFirst = await request(`/api/games/${g.gid}/pause`, {
    device_id: g.west[0].device, player_id: g.west[0].player, action: 'resume',
  })
  assert.equal(resumeFirst.json.pending, true)
  const resumed = await request(`/api/games/${g.gid}/pause`, {
    device_id: g.east[0].device, player_id: g.east[0].player, action: 'resume',
  })
  assert.equal(resumed.status, 200); assert.equal(resumed.json.applied, true)
  const shifted = scalar(`select extract(epoch from started_at)::bigint||'|'||extract(epoch from expires_at)::bigint from active_curses where id='${curseId}';`).split('|')
  assert.ok(Number(shifted[0]) - Number(startBefore) >= 119)
  assert.ok(Number(shifted[1]) - Number(expiryBefore) >= 119)
  assert.equal(number(`select count(*) from events where game_id='${g.gid}' and type='game_resumed';`), 1)
  pass('two-team pause/resume is idempotent and freezes game, prompt, expiry, and Frozen clocks')
}

async function respawnAndTerminalScenario(g) {
  db(`delete from active_curses where game_id='${g.gid}';`)
  const library = point('landmark.miradouro-vila-velha')
  const tagBody = {
    device_id: g.west[0].device,
    tagger_player_id: g.west[0].player,
    tagger_pos: { ...library, accuracy: 5, updated_at: Date.now() },
    targets: [{
      player_id: g.east[0].player,
      pos: { lat: library.lat + 0.00001, lng: library.lng, accuracy: 5, updated_at: Date.now() },
    }],
  }
  const tagged = await apiPost(`/api/games/${g.gid}/tag`, tagBody)
  assert.deepEqual(tagged.tagged_player_ids, [g.east[0].player])
  const targetRef = scalar(`select respawn_target_ref from players where id='${g.east[0].player}';`)
  assert.ok(targetRef.startsWith('landmark.'))
  const wrong = landmarks.find((item) => item.team_pool === 'neutral' && item.id !== targetRef)
  const wrongResult = await request(`/api/games/${g.gid}/respawn-clear`, {
    device_id: g.east[0].device, player_id: g.east[0].player,
    pos: { lat: wrong.lat, lng: wrong.lng, accuracy: 5, updated_at: Date.now() },
  })
  assert.equal(wrongResult.status, 409)
  assert.equal(wrongResult.json.error, 'wrong_respawn_landmark')
  assert.equal(wrongResult.json.details.required_ref, targetRef)

  const target = point(targetRef)
  const arrivals = await Promise.all(Array.from({ length: 10 }, () =>
    request(`/api/games/${g.gid}/respawn-clear`, {
      device_id: g.east[0].device, player_id: g.east[0].player,
      pos: { ...target, accuracy: 5, updated_at: Date.now() },
    })))
  assert.equal(arrivals.filter((result) => result.status === 200 && result.json.stage === 'arrived').length, 1)
  assert.equal(number(`select count(*) from events where game_id='${g.gid}' and type='player_respawn_arrived' and actor_player_id='${g.east[0].player}';`), 1)
  assert.equal(scalar(`select respawning||'|'||respawn_arrived from players where id='${g.east[0].player}';`), 'true|true')
  const immune = await apiPost(`/api/games/${g.gid}/tag`, {
    ...tagBody,
    tagger_pos: { ...library, accuracy: 5, updated_at: Date.now() },
    targets: [{ player_id: g.east[0].player, pos: { ...library, accuracy: 5, updated_at: Date.now() } }],
  })
  assert.equal(immune.tagged_player_ids.length, 0)
  assert.equal(immune.rejected[0].reason, 'already_respawning')

  const departure = { lat: target.lat + 0.001, lng: target.lng, accuracy: 5, updated_at: Date.now() }
  const clears = await Promise.all(Array.from({ length: 10 }, () =>
    request(`/api/games/${g.gid}/respawn-clear`, {
      device_id: g.east[0].device, player_id: g.east[0].player, pos: departure,
    })))
  assert.equal(clears.filter((result) => result.status === 200 && result.json.stage === 'cleared').length, 1)
  assert.equal(number(`select count(*) from events where game_id='${g.gid}' and type='player_respawning_cleared' and actor_player_id='${g.east[0].player}';`), 1)
  assert.equal(scalar(`select respawning from players where id='${g.east[0].player}';`), 'f')
  pass('respawn requires the nearest neutral, retains immunity on arrival, and clears once after departure')

  backdateStart(g.gid, 31)
  const fakeAttempt = await request(`/api/games/${g.gid}/attempt-flag`, {
    device_id: g.east[1].device, player_id: g.east[1].player,
    landmark_ref: 'landmark.miradouro-vila-velha',
    pos: { ...library, accuracy: 5, updated_at: Date.now() },
    photo_url: 'https://example.com/fake.jpg',
  })
  assert.equal(fakeAttempt.status, 400); assert.equal(fakeAttempt.json.error, 'invalid_photo_url')
  const proof = await uploadFlagAttemptProof(g.gid, g.east[1].player, 'terminal')
  const attempt = await apiPost(`/api/games/${g.gid}/attempt-flag`, {
    device_id: g.east[1].device, player_id: g.east[1].player,
    landmark_ref: 'landmark.miradouro-vila-velha',
    pos: { ...library, accuracy: 5, updated_at: Date.now() }, photo_url: proof,
  })
  assert.equal(attempt.result, 'real')
  const eastHome = point('landmark.biblioteca-municipal')
  const completeBody = {
    device_id: g.east[1].device, player_id: g.east[1].player,
    pos: { ...eastHome, accuracy: 5, updated_at: Date.now() },
  }
  const finishes = await Promise.all(Array.from({ length: 16 }, () =>
    request(`/api/games/${g.gid}/complete-run`, completeBody)))
  assert.ok(finishes.every((result) => result.status === 200))
  assert.ok(finishes.every((result) => result.json.winner_team_id === g.eTeam))
  assert.equal(number(`select count(*) from events where game_id='${g.gid}' and type='game_won';`), 1)
  assert.equal(scalar(`select status from games where id='${g.gid}';`), 'finished')
  pass('proof-backed real attempt + 16 run-completion races persist one stable winner event')
}

async function intelCatalogScenario() {
  // The cap is 4 in_hand cards per team per game, so the catalogue tour is split
  // across as many games as it takes. Derived from the catalogue length rather
  // than hardcoded, so removing a card (I9, then I2 East/West) cannot silently
  // drop the tail of the deck from the sweep — the deepEqual below would then
  // fail, but only after the sweep had already stopped testing those refs.
  const CAP = 4
  const groups = []
  for (let start = 0; start < intel.length; start += CAP) {
    groups.push(intel.slice(start, start + CAP))
  }
  const seen = new Set()
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const g = await makeGameN(2, 2, `intel-${groupIndex}-${Date.now()}`)
    db(`update teams set coins=5000 where game_id='${g.gid}';`)
    for (const definition of groups[groupIndex]) {
      const body = {
        device_id: g.west[0].device, player_id: g.west[0].player,
        intel_ref: definition.id,
        ...(definition.id === 'intel.hot-cold' ? {
          player_pos: { ...point('landmark.miradouro-vila-velha'), accuracy: 5, updated_at: Date.now() },
        } : {}),
      }
      const bought = await apiPost(`/api/games/${g.gid}/buy-intel`, body)
      assert.equal(bought.answer.intel_ref, definition.id)
      seen.add(definition.id)
      if (definition.id === 'intel.north-south') {
        assert.equal(bought.answer.pivot_lat, 41.29820795)
      }
      if (definition.id === 'intel.hot-cold') {
        assert.equal('target' in bought.answer, false)
        const payload = JSON.parse(scalar(`select payload::text from cards where game_id='${g.gid}' and team_id='${g.wTeam}' and ref='intel.hot-cold';`))
        assert.equal('target' in payload, false)
        const live = await apiGet(`/api/games/${g.gid}/live-state?device_id=${g.west[0].device}`)
        assert.equal('target' in live.my_cards.find((card) => card.ref === definition.id).payload, false)
      }
      if (definition.id === 'intel.surroundings') {
        assert.match(bought.answer.photo_url, /token=/)
        const payload = JSON.parse(scalar(`select payload::text from cards where game_id='${g.gid}' and team_id='${g.wTeam}' and ref='intel.surroundings';`))
        assert.equal('object_path' in payload, false)
        assert.equal('photo_url' in payload, false)
        const live = await apiGet(`/api/games/${g.gid}/live-state?device_id=${g.west[0].device}`)
        const liveCard = live.my_cards.find((card) => card.ref === definition.id)
        assert.match(liveCard.payload.photo_url, /token=/)
        assert.equal('object_path' in liveCard.payload, false)
      }
    }
  }
  assert.deepEqual([...seen].sort(), intel.map((definition) => definition.id).sort())
  pass('all seven intel refs purchase with valid payloads; I1/I5/I6/I7 use current secure geometry contracts')
}

async function curseEligibilityRaceScenario() {
  const g = await makeGameN(2, 2, `curse-eligibility-race-${Date.now()}`)
  const buyArgs = (curseRef, params, expiresAt = null) => ({
    p_game_id: g.gid,
    p_buyer_team_id: g.wTeam,
    p_target_team_id: g.eTeam,
    p_actor_player_id: g.west[0].player,
    p_cost: 50,
    p_num_dice: 3,
    p_dice_total: 9,
    p_dice_rolls: [3, 3, 3],
    p_curse_ref: curseRef,
    p_tier: 'major',
    p_expires_at: expiresAt,
    p_params: params,
  })

  db(`delete from active_curses where game_id='${g.gid}'; update teams set coins=500 where id='${g.wTeam}'; update teams set coins=50 where id='${g.eTeam}';`)
  const coinResults = await Promise.all([
    adminRpc('buy_curse_atomic', buyArgs('curse.coin-drain', { amount: 50 })),
    adminRpc('buy_curse_atomic', buyArgs('curse.coin-drain', { amount: 50 })),
  ])
  assert.ok(coinResults.every((result) => result.error === null))
  assert.equal(coinResults.filter((result) => result.data.error === 'no_available_curse').length, 1)
  assert.equal(number(`select coins from teams where id='${g.wTeam}';`), 450)
  assert.equal(number(`select coins from teams where id='${g.eTeam}';`), 0)
  assert.equal(number(`select count(*) from events where game_id='${g.gid}' and type='coins_deducted' and payload->>'reason'='buy_curse';`), 1)
  assert.equal(number(`select count(*) from events where game_id='${g.gid}' and type='curse_cast' and payload->>'curse_ref'='curse.coin-drain';`), 1)
  pass('concurrent Coin Drain casts spend once; the locked zero-balance loser returns no_available_curse')

  db(`update teams set coins=500 where id='${g.wTeam}'; insert into cards(game_id,team_id,kind,ref,state,payload) values ('${g.gid}','${g.eTeam}','intel','intel.north-south','in_hand','{}');`)
  const victimId = scalar(`select id from cards where game_id='${g.gid}' and team_id='${g.eTeam}' and kind='intel' and state='in_hand' order by created_at desc limit 1;`)
  const intelResults = await Promise.all([
    adminRpc('buy_curse_atomic', buyArgs('curse.intel-loss', { count: 1 })),
    adminRpc('buy_curse_atomic', buyArgs('curse.intel-loss', { count: 1 })),
  ])
  assert.ok(intelResults.every((result) => result.error === null))
  assert.equal(intelResults.filter((result) => result.data.error === 'no_available_curse').length, 1)
  assert.equal(number(`select coins from teams where id='${g.wTeam}';`), 450)
  assert.equal(scalar(`select state from cards where id='${victimId}';`), 'expired')
  assert.equal(number(`select count(*) from events where game_id='${g.gid}' and type='intel_lost' and payload->>'card_id'='${victimId}';`), 1)
  assert.equal(number(`select count(*) from events where game_id='${g.gid}' and type='curse_cast' and payload->>'curse_ref'='curse.intel-loss';`), 1)
  pass('concurrent Intel Loss casts claim one victim before spend and expire that exact card once')

  db(`delete from active_curses where game_id='${g.gid}'; update teams set coins=500 where id='${g.wTeam}';`)
  const expiredId = scalar(`insert into active_curses(game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${g.gid}','${g.eTeam}','curse.slow-walk',now()-interval '10 minutes',now()-interval '1 minute','{}') returning id;`)
  const [expiryResult, recastResult] = await Promise.all([
    adminRpc('expire_curses_atomic', {
      p_game_id: g.gid,
      p_actor_player_id: g.west[0].player,
    }),
    adminRpc('buy_curse_atomic', buyArgs(
      'curse.slow-walk',
      { max_speed_kmh: 2.5 },
      new Date(Date.now() + 5 * 60_000).toISOString(),
    )),
  ])
  assert.equal(expiryResult.error, null)
  assert.equal(recastResult.error, null)
  assert.equal(recastResult.data.error, undefined)
  assert.equal(number(`select count(*) from active_curses where id='${expiredId}';`), 0)
  assert.equal(number(`select count(*) from active_curses where game_id='${g.gid}' and target_team_id='${g.eTeam}' and curse_ref='curse.slow-walk';`), 1)
  assert.equal(number(`select count(*) from events where game_id='${g.gid}' and type='curse_expired' and payload->>'curse_id'='${expiredId}';`), 1)
  pass('expiry/cast race logs exactly one expiry and replaces the elapsed same-ref curse without a unique conflict')

  const liveCurseId = scalar(`select id from active_curses where game_id='${g.gid}' and target_team_id='${g.eTeam}' and curse_ref='curse.slow-walk';`)
  const placementId = scalar(`insert into placed_curses(game_id,owner_team_id,landmark_ref,placed_ref,curse_ref,armed) values ('${g.gid}','${g.wTeam}','landmark.mercado-municipal','placed.slow-trap','curse.slow-walk',true) returning id;`)
  const placedArgs = {
    p_placement_id: placementId,
    p_game_id: g.gid,
    p_intruder_player_id: g.east[0].player,
    p_intruder_team_id: g.eTeam,
    p_curse_ref: 'curse.slow-walk',
    p_tier: 'minor',
    p_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    p_params: { max_speed_kmh: 2.5 },
  }
  const blocked = await adminRpc('trigger_placed_curse_atomic', placedArgs)
  assert.equal(blocked.error, null)
  assert.deepEqual(blocked.data, { cast: false, triggered: false })
  assert.equal(scalar(`select armed from placed_curses where id='${placementId}';`), 't')

  db(`update active_curses set expires_at=now()-interval '1 second' where id='${liveCurseId}';`)
  const retriggered = await adminRpc('trigger_placed_curse_atomic', {
    ...placedArgs,
    p_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
  })
  assert.equal(retriggered.error, null)
  assert.deepEqual(retriggered.data, { cast: true, triggered: true })
  assert.equal(scalar(`select armed from placed_curses where id='${placementId}';`), 'f')
  assert.equal(number(`select count(*) from active_curses where id='${liveCurseId}';`), 0)
  assert.equal(number(`select count(*) from events where game_id='${g.gid}' and type='curse_expired' and payload->>'curse_id'='${liveCurseId}';`), 1)
  assert.equal(number(`select count(*) from active_curses where game_id='${g.gid}' and target_team_id='${g.eTeam}' and curse_ref='curse.slow-walk';`), 1)
  pass('blocked placement stays armed, then expires/logs the old effect once and casts on later re-entry')

  db(`delete from active_curses where game_id='${g.gid}'; delete from cards where game_id='${g.gid}' and team_id='${g.eTeam}' and kind='intel'; update teams set coins=500 where id='${g.wTeam}'; update teams set coins=0 where id='${g.eTeam}'; insert into active_curses(game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${g.gid}','${g.eTeam}','curse.frozen',now(),now()+interval '1 hour','{}'),('${g.gid}','${g.eTeam}','curse.pilgrimage',now(),null,'{}'),('${g.gid}','${g.eTeam}','curse.solo-quarantine',now(),now()+interval '1 hour','{}'),('${g.gid}','${g.eTeam}','curse.full-stop',now(),now()+interval '1 hour','{}');`)
  let unavailable = null
  for (let attempt = 0; attempt < 20 && unavailable === null; attempt += 1) {
    const spendsBefore = number(`select count(*) from events where game_id='${g.gid}' and type='coins_deducted' and payload->>'reason'='buy_curse';`)
    const coinsBefore = number(`select coins from teams where id='${g.wTeam}';`)
    const result = await request(`/api/games/${g.gid}/buy-curse`, {
      device_id: g.west[0].device,
      player_id: g.west[0].player,
      num_dice: 3,
    })
    if (result.status === 409 && result.json.error === 'no_available_curse') {
      unavailable = result
      const rollsBefore = number(`select count(*) from events where game_id='${g.gid}' and type='curse_roll_failed';`)
      // Finding P6: the refund stays (RULEBOOK §10) but the response must no
      // longer echo the rolled tier, which told a free prober which bucket of
      // hidden enemy state had been exhausted.
      assert.equal(result.json.details, undefined, 'no_available_curse must not echo the rolled tier')
      assert.equal(number(`select coins from teams where id='${g.wTeam}';`), coinsBefore)
      assert.equal(number(`select count(*) from events where game_id='${g.gid}' and type='coins_deducted' and payload->>'reason'='buy_curse';`), spendsBefore)
      // ...and the probe is no longer invisible: it leaves an attributable
      // event carrying only the buyer's own team and dice, never enemy state.
      assert.ok(rollsBefore >= 1, 'failed roll must append a curse_roll_failed event')
      const logged = db(`select payload::text from events where game_id='${g.gid}' and type='curse_roll_failed' order by created_at desc limit 1;`)
      const payload = JSON.parse(String(logged[0] ?? logged))
      assert.equal(payload.team_id, g.wTeam)
      assert.equal(payload.tier, undefined, 'the logged probe must not record the rolled tier')
    } else {
      assert.equal(result.status, 200)
      db(`delete from active_curses where game_id='${g.gid}' and curse_ref not in ('curse.frozen','curse.pilgrimage','curse.solo-quarantine','curse.full-stop'); update teams set coins=500 where id='${g.wTeam}';`)
    }
  }
  assert.ok(unavailable, 'expected a major roll to exercise the no_available_curse HTTP mapping')
  pass('buy-curse maps an exhausted rolled tier to HTTP 409 without a buyer ledger event')
}

async function curseCatalogScenario() {
  const g = await makeGameN(2, 2, `curse-catalog-${Date.now()}`)
  const enabledCurses = curses.filter((definition) => definition.enabled !== false)
  const seen = new Set()
  const diceFor = { minor: 1, medium: 2, major: 3 }
  for (const wanted of enabledCurses) {
    let bought = null
    for (let attempt = 0; attempt < 40 && !bought; attempt += 1) {
      db(`delete from active_curses where game_id='${g.gid}' and target_team_id='${g.eTeam}';`)
      const blockers = enabledCurses.filter((candidate) => candidate.tier === wanted.tier && candidate.id !== wanted.id)
      if (blockers.length > 0) {
        const values = blockers.map((candidate) =>
          `('${g.gid}','${g.eTeam}','${candidate.id}',now(),now()+interval '1 hour','{}')`).join(',')
        db(`insert into active_curses(game_id,target_team_id,curse_ref,started_at,expires_at,params) values ${values};`)
      }
      db(`update teams set coins=100000 where id='${g.wTeam}'; update teams set coins=1000 where id='${g.eTeam}';`)
      if (wanted.id === 'curse.intel-loss') {
        if (number(`select count(*) from cards where game_id='${g.gid}' and team_id='${g.eTeam}' and kind='intel' and state='in_hand';`) === 0) {
          db(`insert into cards(game_id,team_id,kind,ref,state,payload) values ('${g.gid}','${g.eTeam}','intel','intel.north-south','in_hand','{}');`)
        }
      }
      const result = await request(`/api/games/${g.gid}/buy-curse`, {
        device_id: g.west[0].device, player_id: g.west[0].player,
        num_dice: diceFor[wanted.tier],
      })
      if (result.status === 200 && result.json.curse_ref === wanted.id) bought = result.json
    }
    assert.ok(bought, `could not force purchase of ${wanted.id}`)
    seen.add(wanted.id)
    assert.equal(scalar(`select payload->>'curse_ref' from events where game_id='${g.gid}' and type='curse_cast' order by created_at desc,id desc limit 1;`), wanted.id)
    if (wanted.duration_minutes !== null || ['curse.pilgrimage', 'curse.full-stop'].includes(wanted.id)) {
      const paramsText = scalar(`select params::text from active_curses where game_id='${g.gid}' and target_team_id='${g.eTeam}' and curse_ref='${wanted.id}' order by created_at desc limit 1;`)
      if (wanted.id === 'curse.detour') {
        const params = JSON.parse(paramsText)
        assert.ok(params.banned_street_name && params.banned_street_polyline.length >= 2)
      }
      if (wanted.id === 'curse.pilgrimage') {
        const params = JSON.parse(paramsText)
        assert.ok(params.target_landmark_ref)
        db(`delete from active_curses where game_id='${g.gid}' and target_team_id='${g.eTeam}' and curse_ref<>'curse.pilgrimage';`)
        const curseId = scalar(`select id from active_curses where game_id='${g.gid}' and target_team_id='${g.eTeam}' and curse_ref='curse.pilgrimage';`)
        const locked = await request(`/api/games/${g.gid}/buy-intel`, {
          device_id: g.east[0].device, player_id: g.east[0].player,
          intel_ref: 'intel.north-south',
        })
        assert.equal(locked.status, 409); assert.equal(locked.json.error, 'actions_locked')
        const completed = await apiPost(`/api/games/${g.gid}/complete-pilgrimage`, {
          device_id: g.east[0].device, player_id: g.east[0].player, curse_id: curseId,
          pos: { ...point(params.target_landmark_ref), accuracy: 5, updated_at: Date.now() },
        })
        assert.equal(completed.completed, true)
      }
    }
    if (wanted.id === 'curse.coin-drain') {
      assert.equal(bought.ledger_effect.kind, 'coin_drain')
      assert.equal(bought.ledger_effect.amount, 50)
    }
    if (wanted.id === 'curse.intel-loss') assert.equal(bought.ledger_effect.kind, 'intel_loss')
  }
  assert.deepEqual([...seen].sort(), enabledCurses.map((definition) => definition.id).sort())
  assert.equal(curses.find((definition) => definition.id === 'curse.backwards').enabled, false)
  pass('every enabled curse casts through purchase selection; disabled Backwards is excluded from new rolls')
}

if (process.env.SIM_ONLY_CURSE_RACES === '1') {
  console.log('\n===== FOCUSED CURSE ELIGIBILITY / EXPIRY RACES =====')
  await curseEligibilityRaceScenario()
} else {
  console.log('\n===== STRICT API / RULEBOOK MATRIX =====')
  const tag = `${Date.now()}`
  await rosterCapScenario(tag)
  await oneVsOneScenario(tag)
  await removeStartRaceScenario(tag)
  const game = await createAtomicPhaseGame(tag)
  await challengeScenario(game)
  await challengeAutoAcceptScenario()
  await economyScenario(game)
  await pauseScenario(game)
  await respawnAndTerminalScenario(game)
  await respawnActionGuardScenario()
  await reloadDeadlineAndResultsScenario()
  await pauseActionRaceScenario()
  await actionLockRaceScenario()
  await bulkTagAtomicScenario()
  await intelCatalogScenario()
  await curseEligibilityRaceScenario()
  await curseCatalogScenario()
}
console.log(`\n${checks} strict API scenario groups passed`)
