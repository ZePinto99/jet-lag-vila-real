// Strict [B] curse-proof journey: prompt -> private multipart upload -> durable
// receipt, with malformed/window/Full Stop/weather-pause rejection and enemy
// privacy assertions.

import { strict as assert } from 'node:assert'
import { mkdirSync } from 'node:fs'
import {
  BASE,
  SHOTS,
  apiGet,
  apiPost,
  db,
  launchBrowser,
  makeClient,
  makeGameN,
} from './harness.mjs'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

async function postProof(gid, fields, bytes, mime = 'image/png') {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.set(key, String(value))
  if (bytes) form.set('photo', new Blob([bytes], { type: mime }), 'proof.png')
  const response = await fetch(`${BASE}/api/games/${gid}/submit-curse-proof`, {
    method: 'POST',
    body: form,
  })
  return { status: response.status, body: await response.json() }
}

mkdirSync(SHOTS, { recursive: true })
console.log('\n===== STRICT PRIVATE [B] CURSE PROOFS =====')
const g = await makeGameN(2, 2, `proof-${Date.now()}`)
const east = g.east[0]
const west = g.west[0]
const browser = await launchBrowser()

try {
  const client = await makeClient(browser, {
    deviceId: east.device,
    lat: 41.295,
    lng: -7.746,
  })
  await client.goto(`/game/${g.code}`)
  await client.page.locator('.leaflet-container').waitFor({ timeout: 30000 })
  const curseId = db(
    `insert into active_curses(game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${g.gid}','${g.eTeam}','curse.photo-tax',now(),now()+interval '8 minutes','{"interval_seconds":90,"submission_window_seconds":30}'::jsonb) returning id;`,
  )[0]
  const fields = {
    device_id: east.device,
    player_id: east.player,
    curse_id: curseId,
    prompt_index: 0,
  }
  await client.page.reload({ waitUntil: 'domcontentloaded' })
  await client.page.getByText('A real photo is required before this window closes.').waitFor({ timeout: 20000 })
  assert.equal(
    await client.page.getByRole('button', { name: 'Submit proof' }).isDisabled(),
    true,
    'submit must remain disabled until a photo is selected',
  )

  const missing = await postProof(g.gid, fields)
  assert.deepEqual([missing.status, missing.body.error], [400, 'photo_required'])
  const invalid = await postProof(g.gid, fields, Buffer.from('not-an-image'))
  assert.deepEqual([invalid.status, invalid.body.error], [400, 'invalid_photo'])

  const closedCurseId = db(
    `insert into active_curses(game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${g.gid}','${g.eTeam}','curse.pose-patrol',now()-interval '45 seconds',now()+interval '11 minutes 15 seconds','{"interval_seconds":120,"submission_window_seconds":30}'::jsonb) returning id;`,
  )[0]
  const closed = await postProof(g.gid, { ...fields, curse_id: closedCurseId }, PNG)
  assert.deepEqual([closed.status, closed.body.error], [409, 'proof_window_closed'])
  console.log('  ✅ missing, forged-image, and closed-window submissions are rejected')

  await client.page.getByLabel('📷 Add proof photo').setInputFiles({
    name: 'photo-tax.png',
    mimeType: 'image/png',
    buffer: PNG,
  })
  await client.page.getByRole('button', { name: 'Submit proof' }).click()
  await client.page.getByText('✓ Proof photo submitted').waitFor({ timeout: 10000 })

  const proofRow = db(
    `select object_path || '|' || curse_ref || '|' || prompt_index from curse_proofs where curse_id='${curseId}';`,
  )[0]
  assert.ok(proofRow, 'proof row must be durable')
  const [objectPath, ref, promptIndex] = proofRow.split('|')
  assert.equal(ref, 'curse.photo-tax')
  assert.equal(promptIndex, '0')
  const eventPayload = JSON.parse(db(
    `select payload::text from events where game_id='${g.gid}' and type='curse_proof_submitted' order by created_at desc limit 1;`,
  )[0])
  assert.equal(eventPayload.curse_id, curseId)
  assert.equal('object_path' in eventPayload, false)
  assert.equal('photo_url' in eventPayload, false)

  const eastLive = await apiGet(`/api/games/${g.gid}/live-state?device_id=${encodeURIComponent(east.device)}`)
  const westLive = await apiGet(`/api/games/${g.gid}/live-state?device_id=${encodeURIComponent(west.device)}`)
  assert.equal(eastLive.my_curse_proofs.length, 1)
  assert.equal('object_path' in eastLive.my_curse_proofs[0], false)
  assert.equal(westLive.my_curse_proofs.length, 0)
  assert.equal(JSON.stringify(westLive).includes(objectPath), false)
  const publicObject = await fetch(
    `http://127.0.0.1:54321/storage/v1/object/public/curse-proofs/${objectPath}`,
  )
  assert.notEqual(publicObject.status, 200, 'private curse proof must not have an unsigned public URL')

  db(`update active_curses set started_at=now(), expires_at=now()+interval '8 minutes' where id='${curseId}';`)
  await client.page.reload({ waitUntil: 'domcontentloaded' })
  await client.page.getByText('✓ Proof photo submitted').waitFor({ timeout: 20000 })
  await client.tab('Status')
  await client.page.getByText('Proof submitted: Photo Tax · #1').waitFor({ timeout: 10000 })
  await client.shot('strict-curse-proof-private.png')
  console.log('  ✅ valid photo persists privately; reload receipt/log is path-free and enemy sees no proof')

  const lockedCurseId = db(
    `insert into active_curses(game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${g.gid}','${g.eTeam}','curse.single-file',now(),now()+interval '5 minutes','{"prompts_per_curse":2}'::jsonb) returning id;`,
  )[0]
  db(
    `insert into active_curses(game_id,target_team_id,curse_ref,started_at,expires_at,params) values ('${g.gid}','${g.eTeam}','curse.full-stop',now(),now()+interval '10 minutes','{}'::jsonb);`,
  )
  await client.page.reload({ waitUntil: 'domcontentloaded' })
  await client.page.getByRole('alert').filter({ hasText: /Actions locked — Full Stop/ }).first().waitFor({ timeout: 20000 })
  const lockedInput = client.page.locator(`input[id^="curse-proof-${lockedCurseId}"]`)
  await lockedInput.waitFor()
  assert.equal(await lockedInput.isDisabled(), true)
  const fullStop = await postProof(g.gid, { ...fields, curse_id: lockedCurseId }, PNG)
  assert.deepEqual([fullStop.status, fullStop.body.error], [409, 'actions_locked'])

  db(`delete from active_curses where game_id='${g.gid}' and curse_ref='curse.full-stop';`)
  db(
    `update players set respawning=true, respawn_target_ref='landmark.largo-do-pelourinho', respawn_arrived=false where id='${east.player}';`,
  )
  await client.page.reload({ waitUntil: 'domcontentloaded' })
  await client.enableGps()
  const respawnCta = client.page.getByRole('button', { name: "I've reached Largo do Pelourinho" })
  await respawnCta.waitFor({ timeout: 20000 })
  assert.equal(await respawnCta.isEnabled(), true, 'respawn confirmation must remain available')
  assert.equal(
    await client.page.locator(`input[id^="curse-proof-${lockedCurseId}"]`).isDisabled(),
    true,
    'respawning must lock regular proof/game actions',
  )
  const respawning = await postProof(g.gid, { ...fields, curse_id: lockedCurseId }, PNG)
  assert.deepEqual([respawning.status, respawning.body.error], [409, 'player_respawning'])
  db(
    `update players set respawning=false, respawn_target_ref=null, respawn_arrived=false where id='${east.player}';`,
  )
  await apiPost(`/api/games/${g.gid}/pause`, {
    device_id: west.device,
    player_id: west.player,
    action: 'pause',
  })
  await apiPost(`/api/games/${g.gid}/pause`, {
    device_id: east.device,
    player_id: east.player,
    action: 'pause',
  })
  const paused = await postProof(g.gid, { ...fields, curse_id: lockedCurseId }, PNG)
  assert.deepEqual([paused.status, paused.body.error], [409, 'game_not_in_play'])
  await client.page.reload({ waitUntil: 'domcontentloaded' })
  await client.page.getByText('Weather pause — Paused').waitFor({ timeout: 20000 })
  assert.equal(await client.page.locator(`input[id^="curse-proof-${lockedCurseId}"]`).isDisabled(), true)
  client.assertNoUnexpectedErrors([
    // MapLibre emits console noise when its third-party tile/glyph fetches are
    // interrupted while this scenario repeatedly reloads the page. The map's
    // own smoke scenario verifies rendering separately.
    /Unable to load glyph range .*Failed to fetch/i,
    /Image ".+" could not be loaded/i,
    /AJAXError: Failed to fetch.*https:\/\/tiles\.openfreemap\.org\//i,
    /TypeError: Failed to fetch @ http:\/\/localhost:3001\/_next\/static\/chunks\/.*\.js/i,
    // These polling requests race the intentional transition into pause and
    // correctly receive the API's action-lock response.
    /Failed to load resource: the server responded with a status of 409 .*\/(?:challenges|time-tick)/i,
  ])
  console.log('  ✅ Full Stop, respawning, and weather pause lock regular actions without trapping respawn')
} finally {
  await browser.close()
}

console.log('3/3 strict checks passed')
