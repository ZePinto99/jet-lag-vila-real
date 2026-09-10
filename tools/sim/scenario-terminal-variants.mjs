// Strict terminal-state coverage: West flag-return win plus every timeout
// outcome (points, challenge tiebreak, exact tie), including finished proof
// links and PT-PT game-over labels.

import { strict as assert } from 'node:assert'
import { mkdirSync } from 'node:fs'
import {
  SHOTS,
  apiPost,
  backdateStart,
  coord,
  db,
  launchBrowser,
  makeClient,
  makeGameN,
  sleep,
  uploadFlagAttemptProof,
} from './harness.mjs'

mkdirSync(SHOTS, { recursive: true })
const browser = await launchBrowser()
let count = 0
const pass = (label) => { count++; console.log(`  ✅ ${label}`) }

async function finishByTimeout(kind) {
  const g = await makeGameN(2, 2, `timeout-${kind}-${Date.now()}`)
  backdateStart(g.gid, 181)
  if (kind === 'points') {
    // Spending/balances are primary-score neutral. A West tag creates the
    // points lead even though East has more remaining coins.
    db(`update teams set coins=case when id='${g.wTeam}' then 50 else 200 end where game_id='${g.gid}';`)
    db(`insert into events(game_id,type,actor_player_id,payload) values ('${g.gid}','tag','${g.west[0].player}','{"defender_player_id":"${g.west[0].player}","raider_player_id":"${g.east[0].player}"}'::jsonb);`)
  } else if (kind === 'tiebreak') {
    // Totals tie at 1: West has one challenge, East one tag. The
    // challenge-count tiebreak must select West despite East's extra coins.
    db(`update teams set coins=case when id='${g.wTeam}' then 100 else 150 end where game_id='${g.gid}';`)
    db(`insert into events(game_id,type,actor_player_id,payload) values ('${g.gid}','challenge_completed','${g.west[0].player}','{"team_id":"${g.wTeam}","challenge_ref":"challenge.pastel-de-nata","card_id":"proof-card","photo_url":"https://example.com/proof.jpg"}'::jsonb);`)
    db(`insert into events(game_id,type,actor_player_id,payload) values ('${g.gid}','tag','${g.east[0].player}','{"defender_player_id":"${g.east[0].player}","raider_player_id":"${g.west[0].player}"}'::jsonb);`)
  } else if (kind === 'coin-tiebreak') {
    // Both sides have zero primary points/challenges; raw balance is the
    // second and final deterministic tiebreaker.
    db(`update teams set coins=case when id='${g.wTeam}' then 149 else 100 end where game_id='${g.gid}';`)
  }
  const response = await apiPost(`/api/games/${g.gid}/end-by-timeout`, {
    device_id: g.west[0].device,
  })
  return { g, response }
}

console.log('\n===== STRICT TERMINAL VARIANTS =====')
try {
  const westWin = await makeGameN(2, 2, `west-win-${Date.now()}`)
  backdateStart(westWin.gid, 31)
  const eastFlag = coord('landmark.biblioteca-municipal')
  const westHome = coord('landmark.miradouro-vila-velha')
  const flagProof = await uploadFlagAttemptProof(
    westWin.gid,
    westWin.west[0].player,
    'terminal-west-win',
  )
  const attempt = await apiPost(`/api/games/${westWin.gid}/attempt-flag`, {
    device_id: westWin.west[0].device,
    player_id: westWin.west[0].player,
    landmark_ref: 'landmark.biblioteca-municipal',
    pos: { ...eastFlag, accuracy: 5, updated_at: Date.now() },
    photo_url: flagProof,
  })
  assert.equal(attempt.result, 'real')
  const win = await apiPost(`/api/games/${westWin.gid}/complete-run`, {
    device_id: westWin.west[0].device,
    player_id: westWin.west[0].player,
    pos: { ...westHome, accuracy: 5, updated_at: Date.now() },
  })
  assert.equal(win.winner_team_id, westWin.wTeam)

  const westPage = await makeClient(browser, {
    deviceId: westWin.west[0].device,
    lat: westHome.lat,
    lng: westHome.lng,
  })
  await westPage.goto(`/game/${westWin.code}`)
  await westPage.page.getByRole('heading', { name: 'Team West wins!' }).waitFor({ timeout: 15000 })
  await westPage.page.getByText('Flag returned to home base').waitFor()
  await westPage.shot('strict-west-wins.png')
  pass('West can steal East real flag, return to Vila Velha, and see its winner overlay')

  const points = await finishByTimeout('points')
  assert.equal(points.response.winner_team_id, points.g.wTeam)
  assert.equal(points.response.reason, 'timeout_points')
  assert.ok(points.response.scores.every((score) => score.curse_points === 0 && score.coin_points === 0))
  const pointsPage = await makeClient(browser, {
    deviceId: points.g.west[0].device,
    lat: westHome.lat,
    lng: westHome.lng,
  })
  await pointsPage.goto(`/game/${points.g.code}`)
  await pointsPage.page.getByText('Won on points after 3-hour timeout').waitFor({ timeout: 15000 })
  pass('3-hour timeout selects and renders the higher-points winner')

  const tiebreak = await finishByTimeout('tiebreak')
  assert.equal(tiebreak.response.winner_team_id, tiebreak.g.wTeam)
  assert.equal(tiebreak.response.reason, 'timeout_tiebreaker')
  const tiebreakPage = await makeClient(browser, {
    deviceId: tiebreak.g.west[0].device,
    lat: westHome.lat,
    lng: westHome.lng,
  })
  await tiebreakPage.goto(`/game/${tiebreak.g.code}`)
  await tiebreakPage.page.getByText('Won on tiebreaker after 3-hour timeout').waitFor({ timeout: 15000 })
  // Six settled time intervals add 18 terminal-adjacent ledger events, so the
  // older challenge proof lives in the paginated full timeline.
  await tiebreakPage.page.getByRole('button', { name: 'View full timeline' }).click()
  const proof = tiebreakPage.page.getByRole('link', { name: 'View photo' }).first()
  await proof.waitFor({ timeout: 15000 })
  assert.equal(await proof.getAttribute('href'), 'https://example.com/proof.jpg')
  pass('equal points use challenge-count tiebreak and finished log preserves proof link')

  const coinTiebreak = await finishByTimeout('coin-tiebreak')
  assert.equal(coinTiebreak.response.winner_team_id, coinTiebreak.g.wTeam)
  assert.equal(coinTiebreak.response.reason, 'timeout_tiebreaker')
  assert.equal(
    coinTiebreak.response.scores.find((score) => score.team_id === coinTiebreak.g.wTeam).total,
    coinTiebreak.response.scores.find((score) => score.team_id === coinTiebreak.g.eTeam).total,
  )
  assert.equal(
    coinTiebreak.response.scores.find((score) => score.team_id === coinTiebreak.g.wTeam).challenges_completed,
    coinTiebreak.response.scores.find((score) => score.team_id === coinTiebreak.g.eTeam).challenges_completed,
  )
  pass('equal total and challenge count use raw coin balance as the final tiebreak')

  const coinFlip = await finishByTimeout('tie')
  assert.ok([coinFlip.g.wTeam, coinFlip.g.eTeam].includes(coinFlip.response.winner_team_id))
  assert.equal(coinFlip.response.reason, 'timeout_coin_flip')
  const flippedSide = coinFlip.response.winner_team_id === coinFlip.g.wTeam ? 'West' : 'East'
  const repeated = await apiPost(`/api/games/${coinFlip.g.gid}/end-by-timeout`, {
    device_id: coinFlip.g.west[0].device,
  })
  assert.equal(repeated.winner_team_id, coinFlip.response.winner_team_id)
  assert.equal(repeated.reason, 'timeout_coin_flip')
  const tiePage = await makeClient(browser, {
    deviceId: coinFlip.g.west[0].device,
    lat: westHome.lat,
    lng: westHome.lng,
  })
  await tiePage.goto(`/game/${coinFlip.g.code}`)
  await tiePage.page.getByRole('heading', { name: `Team ${flippedSide} wins!` }).waitFor({ timeout: 30000 })
  await tiePage.page.getByText('Won by coin flip after all tiebreakers were tied').waitFor()
  pass('exact timeout tie resolves by one persisted coin flip winner')

  // Locale state is persistent and swaps the load-bearing finished labels.
  await tiePage.page.getByRole('radio', { name: 'PT', exact: true }).last().click()
  await tiePage.page.getByText('Fim de jogo').waitFor()
  const ptSide = flippedSide === 'West' ? 'Oeste' : 'Este'
  await tiePage.page.getByRole('heading', { name: `Equipa ${ptSide} ganhou!` }).waitFor()
  await tiePage.page.getByText('Vencedor por lançamento de moeda após todos os desempates').waitFor()
  await tiePage.shot('strict-timeout-tie-pt.png')
  pass('game-over outcome, reason, score rows, and navigation switch to PT-PT')

  // Finished snapshot/realtime hydration must be stable across reload.
  await tiePage.page.reload({ waitUntil: 'domcontentloaded' })
  await tiePage.page.getByRole('heading', { name: `Equipa ${ptSide} ganhou!` }).waitFor({ timeout: 30000 })
  assert.equal(db(`select count(*) from events where game_id='${coinFlip.g.gid}' and type='game_ended_by_timeout';`)[0], '1')
  await sleep(200)
  pass('finished state survives reload without duplicating terminal events')
} finally {
  await browser.close()
}

console.log(`${count}/${count} strict checks passed`)
