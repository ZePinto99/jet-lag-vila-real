// Lobby + setup edge cases. Pure-API (no browser), so every assertion lands on
// the SERVER contract rather than on what a client chose to render.
//
//   node tools/sim/scenario-lobby-setup-edges.mjs [seed]
//
// Why this file exists: almost every other scenario drives lobby -> setup ->
// live through makeGameN/setupLiveGame in a few happy-path calls and then spends
// its checks on the live phase. Three routes therefore had NO scenario reference
// at all before this file (switch-team, setup-state, host-clear-respawn) and
// remove-player had one. The pre-game phase is where a real evening actually
// starts, and it is the phase a group will hammer: people join the wrong side,
// un-ready themselves, get kicked, reload, and re-pick flags.
//
// Routes under test (source of truth in brackets):
//   join                app/api/games/[id]/join/route.ts        + 0028 join_player_atomic
//   switch-team         app/api/games/[id]/switch-team/route.ts + 0028 switch_player_team_atomic
//   ready               app/api/games/[id]/ready/route.ts
//   start               app/api/games/[id]/start/route.ts       + start_game_setup_atomic
//   remove-player       app/api/games/[id]/remove-player/route.ts + 0032 remove_lobby_player_atomic
//   flag-setup          app/api/games/[id]/flag-setup/route.ts  + submit_flag_setup_atomic
//   setup-state         app/api/games/[id]/setup-state/route.ts (enemy-hiding boundary)
//   harden-flag         app/api/games/[id]/harden-flag/route.ts + 0054 harden_flag_atomic
//   place-curse         app/api/games/[id]/place-curse/route.ts
//   host-clear-respawn  app/api/games/[id]/host-clear-respawn/route.ts + 0055
//
// Everything asserted here was PROBED against the running server first; no
// expected error string is guessed. Where behaviour looked wrong rather than
// merely undocumented it is recorded as a `FINDING:` note and NOT fixed.

import {
  BASE,
  EAST_ASSIGN,
  WEST_ASSIGN,
  apiPost,
  coord,
  db,
  makeGameN,
  uploadSurroundingsPhoto,
} from './harness.mjs'
import { makeRecorder, strictStep } from './artifact.mjs'
import { makeRng } from './geoutil.mjs'

const seed = Number(process.argv[2] || 20260928)
const rng = makeRng(seed)
const rec = makeRecorder({ scenario: 'lobby-setup-edges', seed })
// Seeded, so a device-id collision across replays is impossible but the run
// still reproduces the same ordering.
const RUN = `lse-${seed}-${Math.floor(rng() * 1e6)}`

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
const scalar = (sql) => db(sql)[0] ?? ''
const count = (sql) => Number(scalar(sql))
const playerOf = (join) => join.player?.id ?? join.me?.id ?? join.id
const teamCounts = (gid) =>
  db(
    `select side || '=' || (select count(*) from players where team_id = teams.id) from teams where game_id='${gid}' order by side;`,
  ).join(' ')
const rosterSize = (gid) =>
  count(
    `select count(*) from players p join teams t on t.id = p.team_id where t.game_id='${gid}';`,
  )
const freshPos = (p) => ({ lat: p.lat, lng: p.lng, accuracy: 5, updated_at: Date.now() })

/**
 * Next dev compiles a route on first hit, so the FIRST request to an
 * uncompiled route can be slow or return a spurious 500. Warm every route with
 * a body that fails validation (-> 400 invalid_body) so the module compiles and
 * nothing mutates, before any status code here is treated as meaningful.
 */
async function warmRoutes() {
  const dead = '00000000-0000-0000-0000-000000000000'
  const routes = [
    'join', 'switch-team', 'ready', 'start', 'remove-player',
    'flag-setup', 'harden-flag', 'place-curse', 'host-clear-respawn',
    'tag', 'camping-heartbeat', 'buy-intel', 'pause',
  ]
  await Promise.all(routes.map((route) => post(`/api/games/${dead}/${route}`, {})))
  await get(`/api/games/${dead}/setup-state?device_id=warm`)
}
await warmRoutes()

/** Build a lobby-phase game with the given per-side counts, nobody ready. */
async function makeLobby(westN, eastN, label) {
  const created = await apiPost('/api/games', {
    display_name: 'W1',
    device_id: `${RUN}-${label}-w1`,
    preferred_side: 'west',
  })
  const gid = created.game.id
  const west = [{ device: `${RUN}-${label}-w1`, player: created.me.id, name: 'W1' }]
  const east = []
  for (let i = 2; i <= westN; i += 1) {
    const device = `${RUN}-${label}-w${i}`
    const joined = await apiPost(`/api/games/${gid}/join`, {
      display_name: `W${i}`, device_id: device, preferred_side: 'west',
    })
    west.push({ device, player: playerOf(joined), name: `W${i}` })
  }
  for (let i = 1; i <= eastN; i += 1) {
    const device = `${RUN}-${label}-e${i}`
    const joined = await apiPost(`/api/games/${gid}/join`, {
      display_name: `E${i}`, device_id: device, preferred_side: 'east',
    })
    east.push({ device, player: playerOf(joined), name: `E${i}` })
  }
  return {
    gid,
    code: created.game.code,
    wTeam: created.teams.find((team) => team.side === 'west').id,
    eTeam: created.teams.find((team) => team.side === 'east').id,
    west,
    east,
  }
}
const readyAll = async (g, ready = true) => {
  for (const p of [...g.west, ...g.east]) {
    await post(`/api/games/${g.gid}/ready`, {
      player_id: p.player, device_id: p.device, ready,
    })
  }
}

// ===========================================================================
// LOBBY
// ===========================================================================

// ---------------------------------------------------------------------------
// 1. Joining a game that has already STARTED
// ---------------------------------------------------------------------------
// join/route.ts:64 gates on status === 'lobby'. `start` moves the game to
// `setup`, so a late arrival must be refused rather than landing in a game whose
// flags are already being placed.
await strictStep(rec, 'join after start', async () => {
  const g = await makeLobby(1, 1, 'joinlate')
  rec.bindGame(g.gid, g.code)
  rec.note(`primary lobby game ${g.code}`)
  await readyAll(g)
  const started = await post(`/api/games/${g.gid}/start`, { device_id: g.west[0].device })
  rec.check(
    'start 1v1 with everyone ready → 200 setup',
    started.status === 200 && started.body.game?.status === 'setup',
    `status=${started.status} game=${started.body.game?.status}`,
  )

  const late = await post(`/api/games/${g.gid}/join`, {
    display_name: 'Latecomer', device_id: `${RUN}-late`, preferred_side: 'west',
  })
  rec.check(
    'join a STARTED game → 409 game_not_in_lobby',
    late.status === 409 && late.body.error === 'game_not_in_lobby',
    `status=${late.status} error=${late.body.error}`,
  )
  rec.check(
    'refused late join adds no player row',
    rosterSize(g.gid) === 2,
    `roster=${rosterSize(g.gid)}`,
  )

  // 4. switch-team after start, and the sibling lobby-only routes, for contrast:
  // all four share the same gate, so they must all answer the same way.
  const after = {}
  after.switch = await post(`/api/games/${g.gid}/switch-team`, {
    player_id: g.east[0].player, device_id: g.east[0].device,
  })
  after.ready = await post(`/api/games/${g.gid}/ready`, {
    player_id: g.east[0].player, device_id: g.east[0].device, ready: false,
  })
  after.remove = await post(`/api/games/${g.gid}/remove-player`, {
    device_id: g.west[0].device, target_player_id: g.east[0].player,
  })
  rec.check(
    'switch-team after start → 409 game_not_in_lobby',
    after.switch.status === 409 && after.switch.body.error === 'game_not_in_lobby',
    `status=${after.switch.status} error=${after.switch.body.error}`,
  )
  rec.check(
    'ready + remove-player after start also → 409 game_not_in_lobby (same gate)',
    after.ready.status === 409 && after.ready.body.error === 'game_not_in_lobby' &&
      after.remove.status === 409 && after.remove.body.error === 'game_not_in_lobby',
    `ready=${after.ready.status}/${after.ready.body.error} remove=${after.remove.status}/${after.remove.body.error}`,
  )
  rec.check(
    'the started game keeps its exact roster and side assignment',
    rosterSize(g.gid) === 2 && teamCounts(g.gid) === 'east=1 west=1',
    `counts=${teamCounts(g.gid)}`,
  )

  // 6c. start twice — documented as IDEMPOTENT, not 409: start/route.ts:90
  // short-circuits on status !== 'lobby' and echoes the game back.
  const again = await post(`/api/games/${g.gid}/start`, { device_id: g.west[0].device })
  rec.check(
    'start twice → 200 idempotent echo (NOT 409), one game_started event',
    again.status === 200 && again.body.game?.status === 'setup' &&
      count(`select count(*) from events where game_id='${g.gid}' and type='game_started';`) === 1,
    `status=${again.status} game_started_events=${count(`select count(*) from events where game_id='${g.gid}' and type='game_started';`)}`,
  )
  rec.note(
    'start is idempotent by design (start/route.ts:89-93): a second tap returns the current game rather than 409, which is the right contract for a flaky-network double-tap.',
  )
})

// ---------------------------------------------------------------------------
// 2. Duplicate display_name — ALLOWED. Documented, not asserted as a bug.
// ---------------------------------------------------------------------------
// There is no uniqueness constraint on players.display_name and no route-level
// check. Two "Ana"s can sit in the same lobby. That is a UX wart rather than a
// rule break — identity is carried by device_id everywhere that matters (tag,
// spend, respawn) — but it is worth pinning so a later change is a deliberate
// one, and worth measuring for the kick UI, which lists players by name.
await strictStep(rec, 'duplicate display_name', async () => {
  const g = await makeLobby(1, 1, 'dupname')
  const dup = await post(`/api/games/${g.gid}/join`, {
    display_name: 'W1', // byte-identical to the host's name
    device_id: `${RUN}-dupname-clone`,
    preferred_side: 'east',
  })
  rec.check(
    'duplicate display_name join is ALLOWED → 201',
    dup.status === 201,
    `status=${dup.status} error=${dup.body.error ?? 'none'}`,
  )
  const named = count(
    `select count(*) from players p join teams t on t.id=p.team_id where t.game_id='${g.gid}' and p.display_name='W1';`,
  )
  rec.check(
    'both same-named players coexist as distinct rows',
    named === 2 && rosterSize(g.gid) === 3,
    `rows named W1=${named} roster=${rosterSize(g.gid)}`,
  )
  rec.note(
    'display_name is NOT unique: no DB constraint and no route check. Two identically-named players are distinguished only by device_id/uuid, so the lobby kick list can show two indistinguishable rows. Behaviour documented, not changed.',
  )
})

// ---------------------------------------------------------------------------
// 3. switch-team: happy path, imbalance, full team, ownership
// ---------------------------------------------------------------------------
// switch-team does NOT preserve balance. It caps the destination at 4
// (switch-team/route.ts:125 + 0028's recheck under the game lock) and refuses a
// ready player, but nothing stops 2v2 -> 3v1. Balance is enforced LATER, by
// `start`. That split is defensible — the lobby is where you shuffle sides — but
// it means the only thing standing between a lopsided game and the field is the
// start gate, so both halves are asserted here.
await strictStep(rec, 'switch-team lobby mechanics', async () => {
  const g = await makeLobby(2, 2, 'switch')
  rec.check('lobby starts balanced 2v2', teamCounts(g.gid) === 'east=2 west=2', teamCounts(g.gid))

  const moved = await post(`/api/games/${g.gid}/switch-team`, {
    player_id: g.east[0].player, device_id: g.east[0].device,
  })
  rec.check(
    'switch-team happy path → 200 and the player is on the other side',
    moved.status === 200 && moved.body.player?.team_id === g.wTeam &&
      moved.body.team?.id === g.wTeam,
    `status=${moved.status} team=${moved.body.team?.side ?? moved.body.error}`,
  )
  rec.check(
    'switch-team CAN create a 3v1 imbalance (not blocked in the lobby)',
    teamCounts(g.gid) === 'east=1 west=3',
    teamCounts(g.gid),
  )

  // The imbalance is caught by start, which is the actual invariant that
  // matters: nobody reaches the field 3v1.
  await readyAll(g)
  const lopsided = await post(`/api/games/${g.gid}/start`, { device_id: g.west[0].device })
  rec.check(
    'start at 3v1 → 409 invalid_team_sizes with the counts echoed',
    lopsided.status === 409 && lopsided.body.error === 'invalid_team_sizes' &&
      Array.isArray(lopsided.body.details?.team_counts),
    `status=${lopsided.status} error=${lopsided.body.error} counts=${JSON.stringify(lopsided.body.details?.team_counts)}`,
  )
  rec.check(
    'a refused lopsided start leaves the game in lobby',
    scalar(`select status from games where id='${g.gid}';`) === 'lobby',
    `status=${scalar(`select status from games where id='${g.gid}';`)}`,
  )
  rec.note(
    'switch-team enforces the 4-player cap but NOT balance; `start` is the sole balance gate (start/route.ts:101-104). A 3v1 lobby is therefore reachable and visible to players before it is refused.',
  )

  // A ready player may not switch — otherwise the roster could move under a
  // start that had already validated it.
  await post(`/api/games/${g.gid}/ready`, {
    player_id: g.west[1].player, device_id: g.west[1].device, ready: true,
  })
  const whileReady = await post(`/api/games/${g.gid}/switch-team`, {
    player_id: g.west[1].player, device_id: g.west[1].device,
  })
  rec.check(
    'switch-team while READY → 409 player_ready',
    whileReady.status === 409 && whileReady.body.error === 'player_ready',
    `status=${whileReady.status} error=${whileReady.body.error}`,
  )

  // Someone else's device must not be able to move you.
  const spoofed = await post(`/api/games/${g.gid}/switch-team`, {
    player_id: g.east[0].player, device_id: `${RUN}-not-your-device`,
  })
  rec.check(
    'switch-team with a foreign device_id → 403 forbidden',
    spoofed.status === 403 && spoofed.body.error === 'forbidden',
    `status=${spoofed.status} error=${spoofed.body.error}`,
  )
})

await strictStep(rec, 'switch-team / join into a full team', async () => {
  const g = await makeLobby(4, 1, 'full')
  rec.check('west filled to the 4-player cap', teamCounts(g.gid) === 'east=1 west=4', teamCounts(g.gid))
  const intoFull = await post(`/api/games/${g.gid}/switch-team`, {
    player_id: g.east[0].player, device_id: g.east[0].device,
  })
  rec.check(
    'switch-team into a full (4) team → 409 team_full',
    intoFull.status === 409 && intoFull.body.error === 'team_full',
    `status=${intoFull.status} error=${intoFull.body.error}`,
  )
  const joinFull = await post(`/api/games/${g.gid}/join`, {
    display_name: 'Ninth', device_id: `${RUN}-full-x`, preferred_side: 'west',
  })
  rec.check(
    'join a full side with preferred_side → 409 team_full',
    joinFull.status === 409 && joinFull.body.error === 'team_full',
    `status=${joinFull.status} error=${joinFull.body.error}`,
  )
  const auto = await post(`/api/games/${g.gid}/join`, {
    display_name: 'Auto', device_id: `${RUN}-full-auto`,
  })
  rec.check(
    'join with NO preferred_side auto-assigns to the smaller side → 201 east',
    auto.status === 201 && auto.body.me?.team_id === g.eTeam,
    `status=${auto.status} team=${auto.body.me?.team_id === g.eTeam ? 'east' : 'west'}`,
  )
  rec.check(
    'the cap held: west is still exactly 4',
    teamCounts(g.gid) === 'east=2 west=4',
    teamCounts(g.gid),
  )
})

// ---------------------------------------------------------------------------
// 5. ready → un-ready, and the start gate that follows
// ---------------------------------------------------------------------------
await strictStep(rec, 'ready then un-ready blocks start', async () => {
  const g = await makeLobby(1, 1, 'unready')
  await readyAll(g)
  const allReady = await post(`/api/games/${g.gid}/ready`, {
    player_id: g.west[0].player, device_id: g.west[0].device, ready: true,
  })
  rec.check(
    'both ready in a valid 1v1 → all_ready true',
    allReady.status === 200 && allReady.body.all_ready === true,
    `status=${allReady.status} all_ready=${allReady.body.all_ready}`,
  )

  const un = await post(`/api/games/${g.gid}/ready`, {
    player_id: g.east[0].player, device_id: g.east[0].device, ready: false,
  })
  rec.check(
    'un-ready → 200, player.ready false, all_ready false',
    un.status === 200 && un.body.player?.ready === false && un.body.all_ready === false,
    `status=${un.status} ready=${un.body.player?.ready} all_ready=${un.body.all_ready}`,
  )
  const blocked = await post(`/api/games/${g.gid}/start`, { device_id: g.west[0].device })
  rec.check(
    'start after one player un-readies → 409 not_all_ready',
    blocked.status === 409 && blocked.body.error === 'not_all_ready',
    `status=${blocked.status} error=${blocked.body.error}`,
  )
  rec.check(
    'a refused start appends no game_started event',
    count(`select count(*) from events where game_id='${g.gid}' and type='game_started';`) === 0 &&
      scalar(`select status from games where id='${g.gid}';`) === 'lobby',
    `events=${count(`select count(*) from events where game_id='${g.gid}' and type='game_started';`)} status=${scalar(`select status from games where id='${g.gid}';`)}`,
  )

  // Re-readying restores startability, so the un-ready is genuinely reversible
  // rather than a one-way door.
  await post(`/api/games/${g.gid}/ready`, {
    player_id: g.east[0].player, device_id: g.east[0].device, ready: true,
  })
  const ok = await post(`/api/games/${g.gid}/start`, { device_id: g.west[0].device })
  rec.check(
    're-ready then start → 200 setup (un-ready is reversible)',
    ok.status === 200 && ok.body.game?.status === 'setup',
    `status=${ok.status} game=${ok.body.game?.status}`,
  )
})

// ---------------------------------------------------------------------------
// 6. start with a 1-player roster, and unequal 2v1
// ---------------------------------------------------------------------------
// start/route.ts:101-105 requires exactly 2 teams, each 1..4, and equal. A solo
// creator is `[1, 0]`, which fails the equality leg, so the error is
// invalid_team_sizes rather than a dedicated "need more players".
await strictStep(rec, 'start roster validation', async () => {
  const solo = await apiPost('/api/games', {
    display_name: 'Solo', device_id: `${RUN}-solo`, preferred_side: 'west',
  })
  await post(`/api/games/${solo.game.id}/ready`, {
    player_id: solo.me.id, device_id: `${RUN}-solo`, ready: true,
  })
  const one = await post(`/api/games/${solo.game.id}/start`, { device_id: `${RUN}-solo` })
  rec.check(
    'start with 1 player total → 409 invalid_team_sizes [1,0]',
    one.status === 409 && one.body.error === 'invalid_team_sizes' &&
      JSON.stringify(one.body.details?.team_counts) === JSON.stringify([1, 0]),
    `status=${one.status} error=${one.body.error} counts=${JSON.stringify(one.body.details?.team_counts)}`,
  )
  rec.note(
    'a solo lobby fails on the equality leg, so the error is invalid_team_sizes ([1,0]) — there is no distinct "not enough players" code.',
  )

  const g = await makeLobby(2, 1, 'uneven')
  await readyAll(g)
  const uneven = await post(`/api/games/${g.gid}/start`, { device_id: g.west[0].device })
  rec.check(
    'start at 2v1 → 409 invalid_team_sizes [2,1]',
    uneven.status === 409 && uneven.body.error === 'invalid_team_sizes' &&
      JSON.stringify(uneven.body.details?.team_counts) === JSON.stringify([2, 1]),
    `status=${uneven.status} error=${uneven.body.error} counts=${JSON.stringify(uneven.body.details?.team_counts)}`,
  )
})

// ---------------------------------------------------------------------------
// 7. remove-player: host authority, self-removal, host transfer, double-remove
// ---------------------------------------------------------------------------
// 0032's remove_lobby_player_atomic is the authority: a non-host may remove only
// THEMSELVES (0032:48-50), host removal transfers the crown to the oldest
// remaining player, and emptying the lobby deletes the game.
await strictStep(rec, 'remove-player authority and host transfer', async () => {
  const g = await makeLobby(2, 2, 'remove')
  rec.check(
    'the creator is the lobby host; nobody else is',
    scalar(`select count(*) from players p join teams t on t.id=p.team_id where t.game_id='${g.gid}' and p.is_host;`) === '1' &&
      scalar(`select is_host from players where id='${g.west[0].player}';`) === 't',
    `hosts=${scalar(`select count(*) from players p join teams t on t.id=p.team_id where t.game_id='${g.gid}' and p.is_host;`)}`,
  )

  const byNonHost = await post(`/api/games/${g.gid}/remove-player`, {
    device_id: g.west[1].device, target_player_id: g.east[0].player,
  })
  rec.check(
    'NON-host removing someone else → 403 forbidden',
    byNonHost.status === 403 && byNonHost.body.error === 'forbidden',
    `status=${byNonHost.status} error=${byNonHost.body.error}`,
  )
  rec.check(
    'the refused kick removed nobody',
    rosterSize(g.gid) === 4,
    `roster=${rosterSize(g.gid)}`,
  )

  const byHost = await post(`/api/games/${g.gid}/remove-player`, {
    device_id: g.west[0].device, target_player_id: g.east[1].player,
  })
  rec.check(
    'host removes another player → 200',
    byHost.status === 200 && byHost.body.removed_player_id === g.east[1].player &&
      byHost.body.game_deleted === false,
    `status=${byHost.status} removed=${byHost.body.removed_player_id === g.east[1].player}`,
  )
  rec.check(
    'host kick appends exactly one player_left event attributed to the host',
    count(`select count(*) from events where game_id='${g.gid}' and type='player_left';`) === 1 &&
      scalar(`select actor_player_id from events where game_id='${g.gid}' and type='player_left';`) === g.west[0].player,
    `events=${count(`select count(*) from events where game_id='${g.gid}' and type='player_left';`)}`,
  )

  const twice = await post(`/api/games/${g.gid}/remove-player`, {
    device_id: g.west[0].device, target_player_id: g.east[1].player,
  })
  rec.check(
    'removing a player who already left → 404 target_not_found',
    twice.status === 404 && twice.body.error === 'target_not_found',
    `status=${twice.status} error=${twice.body.error}`,
  )
  rec.check(
    'the repeat kick appends no second player_left event',
    count(`select count(*) from events where game_id='${g.gid}' and type='player_left';`) === 1,
    `events=${count(`select count(*) from events where game_id='${g.gid}' and type='player_left';`)}`,
  )

  const selfKick = await post(`/api/games/${g.gid}/remove-player`, {
    device_id: g.west[1].device, target_player_id: g.west[1].player,
  })
  rec.check(
    'a NON-host may remove THEMSELVES → 200 (leave, not kick)',
    selfKick.status === 200 && selfKick.body.removed_player_id === g.west[1].player,
    `status=${selfKick.status} error=${selfKick.body.error ?? 'none'}`,
  )
  const selfPayload = JSON.parse(
    scalar(
      `select payload::text from events where game_id='${g.gid}' and type='player_left' order by created_at desc, id desc limit 1;`,
    ) || '{}',
  )
  rec.check(
    'self-removal is logged as self:true with a null actor',
    selfPayload.self === true &&
      scalar(`select coalesce(actor_player_id::text,'null') from events where game_id='${g.gid}' and type='player_left' order by created_at desc, id desc limit 1;`) === 'null',
    `payload.self=${selfPayload.self}`,
  )

  // The host removing themselves must hand the crown on, or the lobby would be
  // left with nobody able to start or kick.
  const hostLeaves = await post(`/api/games/${g.gid}/remove-player`, {
    device_id: g.west[0].device, target_player_id: g.west[0].player,
  })
  rec.check(
    'host removes THEMSELVES → 200 and host transfers to the oldest remaining player',
    hostLeaves.status === 200 && hostLeaves.body.new_host_id === g.east[0].player,
    `status=${hostLeaves.status} new_host=${hostLeaves.body.new_host_id === g.east[0].player}`,
  )
  rec.check(
    'exactly one host remains after the transfer',
    scalar(`select count(*) from players p join teams t on t.id=p.team_id where t.game_id='${g.gid}' and p.is_host;`) === '1' &&
      scalar(`select is_host from players where id='${g.east[0].player}';`) === 't',
    `hosts=${scalar(`select count(*) from players p join teams t on t.id=p.team_id where t.game_id='${g.gid}' and p.is_host;`)}`,
  )

  // Last player out: 0032:70-77 deletes the game rather than leaving an
  // unreachable empty lobby behind.
  const lastOut = await post(`/api/games/${g.gid}/remove-player`, {
    device_id: g.east[0].device, target_player_id: g.east[0].player,
  })
  rec.check(
    'the LAST player leaving deletes the game (no orphan lobby)',
    lastOut.status === 200 && lastOut.body.game_deleted === true &&
      count(`select count(*) from games where id='${g.gid}';`) === 0,
    `status=${lastOut.status} deleted=${lastOut.body.game_deleted} rows=${count(`select count(*) from games where id='${g.gid}';`)}`,
  )
})

// ---------------------------------------------------------------------------
// 8. Rejoining with the same device_id (second browser tab / reconnect)
// ---------------------------------------------------------------------------
// join/route.ts:102-111 short-circuits on a known device_id and returns the
// existing snapshot with 200 (not 201). The RPC repeats the check under the game
// lock (0028), so a reconnect burst cannot mint duplicates either.
await strictStep(rec, 'rejoin with the same device_id', async () => {
  const g = await makeLobby(1, 1, 'rejoin')
  const before = rosterSize(g.gid)
  const rejoin = await post(`/api/games/${g.gid}/join`, {
    // Different name AND different side: neither may take effect.
    display_name: 'Renamed On Reconnect',
    device_id: g.west[0].device,
    preferred_side: 'east',
  })
  rec.check(
    'rejoin same device → 200 (not 201) and the SAME player id',
    rejoin.status === 200 && rejoin.body.me?.id === g.west[0].player,
    `status=${rejoin.status} same_player=${rejoin.body.me?.id === g.west[0].player}`,
  )
  rec.check(
    'rejoin creates no duplicate player row',
    rosterSize(g.gid) === before,
    `roster=${rosterSize(g.gid)} (was ${before})`,
  )
  rec.check(
    'rejoin does not rename or re-side the existing player',
    scalar(`select display_name from players where id='${g.west[0].player}';`) === 'W1' &&
      scalar(`select team_id from players where id='${g.west[0].player}';`) === g.wTeam,
    `name=${scalar(`select display_name from players where id='${g.west[0].player}';`)} on_west=${scalar(`select team_id from players where id='${g.west[0].player}';`) === g.wTeam}`,
  )
  rec.check(
    'rejoin appends no second player_joined event',
    count(`select count(*) from events where game_id='${g.gid}' and type='player_joined' and payload->>'player_id'='${g.west[0].player}';`) === 1,
    `events=${count(`select count(*) from events where game_id='${g.gid}' and type='player_joined' and payload->>'player_id'='${g.west[0].player}';`)}`,
  )

  // A concurrent reconnect burst (all tabs waking at once) must also be safe.
  const burst = await Promise.all(
    Array.from({ length: 8 }, () =>
      post(`/api/games/${g.gid}/join`, {
        display_name: 'W1', device_id: g.west[0].device, preferred_side: 'west',
      }),
    ),
  )
  rec.check(
    '8 concurrent rejoins all return the existing player, roster unchanged',
    burst.every((r) => r.status === 200 && r.body.me?.id === g.west[0].player) &&
      rosterSize(g.gid) === before,
    `statuses=${[...new Set(burst.map((r) => r.status))].join(',')} roster=${rosterSize(g.gid)}`,
  )
})

// ---------------------------------------------------------------------------
// 9. Non-host attempts start — ALLOWED. Documented, not asserted as a bug.
// ---------------------------------------------------------------------------
// start/route.ts only requires that the caller be IN the game (line 84-87); it
// never checks is_host. The Lobby UI shows the button to everyone too
// (Lobby.tsx:122 canStart has no host term), so this is consistent client and
// server: any player may start a fully-ready, balanced lobby. Pinned so a later
// "only the host may start" change is deliberate.
await strictStep(rec, 'non-host may start (documented)', async () => {
  const g = await makeLobby(1, 1, 'nonhost')
  await readyAll(g)
  rec.check(
    'the east player is NOT the host',
    scalar(`select is_host from players where id='${g.east[0].player}';`) === 'f',
    `is_host=${scalar(`select is_host from players where id='${g.east[0].player}';`)}`,
  )
  const byNonHost = await post(`/api/games/${g.gid}/start`, { device_id: g.east[0].device })
  rec.check(
    'start by a NON-host → 200 (host authority is NOT required to start)',
    byNonHost.status === 200 && byNonHost.body.game?.status === 'setup',
    `status=${byNonHost.status} game=${byNonHost.body.game?.status}`,
  )
  const stranger = await post(`/api/games/${g.gid}/start`, { device_id: `${RUN}-stranger` })
  rec.check(
    'start by a device that is not in the game at all → 403 forbidden',
    stranger.status === 403 && stranger.body.error === 'forbidden',
    `status=${stranger.status} error=${stranger.body.error}`,
  )
  rec.note(
    'start requires game membership but NOT host (start/route.ts:84-87; Lobby.tsx canStart has no host term). Any player can start a ready, balanced lobby — consistent between client and server, so documented rather than flagged.',
  )
})

// ===========================================================================
// SETUP
// ===========================================================================

/** Lobby -> setup with a 2v2 roster, ready for flag-setup probes. */
async function makeSetupGame(label) {
  const g = await makeLobby(2, 2, label)
  await readyAll(g)
  const started = await post(`/api/games/${g.gid}/start`, { device_id: g.west[0].device })
  if (started.status !== 200) throw new Error(`setup fixture start failed: ${started.status}`)
  return g
}

// ---------------------------------------------------------------------------
// 11-13. flag-setup input validation
// ---------------------------------------------------------------------------
await strictStep(rec, 'flag-setup rejects malformed assignments', async () => {
  const g = await makeSetupGame('badsetup')
  rec.note(`setup validation game ${g.code}`)
  const photo = await uploadSurroundingsPhoto(g.gid, g.wTeam, `${RUN}-bad`)
  const submit = (assignments, device = g.west[0].device, path = photo) =>
    post(`/api/games/${g.gid}/flag-setup`, {
      device_id: device, assignments, surroundings_photo_path: path,
    })

  // 11. a landmark from the OTHER team's pool
  const wrongPool = await submit(EAST_ASSIGN)
  rec.check(
    'flag-setup with enemy-pool landmarks → 400 landmark_not_in_pool (all 5 named)',
    wrongPool.status === 400 && wrongPool.body.error === 'landmark_not_in_pool' &&
      (wrongPool.body.details?.offending ?? []).length === 5,
    `status=${wrongPool.status} error=${wrongPool.body.error} offending=${(wrongPool.body.details?.offending ?? []).length}`,
  )

  // 12. the same landmark listed twice
  const dupRefs = [
    WEST_ASSIGN[0],
    { landmark_ref: WEST_ASSIGN[0].landmark_ref, role: 'decoy' },
    WEST_ASSIGN[2], WEST_ASSIGN[3], WEST_ASSIGN[4],
  ]
  const duplicate = await submit(dupRefs)
  rec.check(
    'flag-setup listing one landmark twice → 400 duplicate_landmark',
    duplicate.status === 400 && duplicate.body.error === 'duplicate_landmark',
    `status=${duplicate.status} error=${duplicate.body.error}`,
  )

  // 13a/b. wrong count — caught by Zod's .length(5), so the code is
  // invalid_body, not a domain error.
  const four = await submit(WEST_ASSIGN.slice(0, 4))
  const six = await submit([...WEST_ASSIGN, { landmark_ref: 'landmark.camara-municipal', role: 'empty' }])
  rec.check(
    'flag-setup with 4 refs → 400 invalid_body (Zod .length(5))',
    four.status === 400 && four.body.error === 'invalid_body',
    `status=${four.status} error=${four.body.error}`,
  )
  rec.check(
    'flag-setup with 6 refs → 400 invalid_body',
    six.status === 400 && six.body.error === 'invalid_body',
    `status=${six.status} error=${six.body.error}`,
  )

  // 13c. wrong role distribution — 1 real / 2 decoy / 2 empty is the rule.
  const twoReal = WEST_ASSIGN.map((a, i) => (i === 1 ? { ...a, role: 'real' } : a))
  const badRoles = await submit(twoReal)
  rec.check(
    'flag-setup with TWO real flags → 400 invalid_role_counts with the tally',
    badRoles.status === 400 && badRoles.body.error === 'invalid_role_counts' &&
      badRoles.body.details?.real === 2 && badRoles.body.details?.decoy === 1 &&
      badRoles.body.details?.empty === 2,
    `status=${badRoles.status} error=${badRoles.body.error} details=${JSON.stringify(badRoles.body.details)}`,
  )
  const noReal = WEST_ASSIGN.map((a, i) => (i === 0 ? { ...a, role: 'empty' } : a))
  const zeroReal = await submit(noReal)
  rec.check(
    'flag-setup with ZERO real flags → 400 invalid_role_counts',
    zeroReal.status === 400 && zeroReal.body.error === 'invalid_role_counts' &&
      zeroReal.body.details?.real === 0,
    `status=${zeroReal.status} error=${zeroReal.body.error} real=${zeroReal.body.details?.real}`,
  )

  rec.check(
    'not one rejected submission wrote a landmark row or a flags_assigned event',
    count(`select count(*) from landmarks where game_id='${g.gid}';`) === 0 &&
      count(`select count(*) from events where game_id='${g.gid}' and type='flags_assigned';`) === 0,
    `landmarks=${count(`select count(*) from landmarks where game_id='${g.gid}';`)} events=${count(`select count(*) from events where game_id='${g.gid}' and type='flags_assigned';`)}`,
  )

  // The surroundings photo must live under this game+team prefix
  // (flag-setup/route.ts:142-152), so one team cannot submit another's object.
  const crossTeam = await submit(EAST_ASSIGN, g.east[0].device, photo)
  rec.check(
    'east submitting a WEST-prefixed photo path → 400 invalid_surroundings_photo_path',
    crossTeam.status === 400 && crossTeam.body.error === 'invalid_surroundings_photo_path',
    `status=${crossTeam.status} error=${crossTeam.body.error}`,
  )
})

// ---------------------------------------------------------------------------
// 10 + 14. duplicate team submission, and the one-team-done phase gate
// ---------------------------------------------------------------------------
await strictStep(rec, 'flag-setup is once per team; one team alone does not go live', async () => {
  const g = await makeSetupGame('oncepersetup')
  const first = await post(`/api/games/${g.gid}/flag-setup`, {
    device_id: g.west[0].device,
    assignments: WEST_ASSIGN,
    surroundings_photo_path: await uploadSurroundingsPhoto(g.gid, g.wTeam, `${RUN}-w1`),
  })
  rec.check(
    'west submits its 5 candidates → 200, both_teams_done false',
    first.status === 200 && first.body.both_teams_done === false &&
      (first.body.my_landmarks ?? []).length === 5,
    `status=${first.status} done=${first.body.both_teams_done} rows=${(first.body.my_landmarks ?? []).length}`,
  )

  // 14. THE phase invariant: one team finished is not enough.
  rec.check(
    'with only ONE team done the game stays in setup (does NOT go live)',
    scalar(`select status from games where id='${g.gid}';`) === 'setup' &&
      scalar(`select coalesce(started_at::text,'null') from games where id='${g.gid}';`) === 'null' &&
      count(`select count(*) from events where game_id='${g.gid}' and type='game_live';`) === 0,
    `status=${scalar(`select status from games where id='${g.gid}';`)} game_live_events=${count(`select count(*) from events where game_id='${g.gid}' and type='game_live';`)}`,
  )

  // 10. the same team submitting again — refused, not idempotent, and refused
  // for a TEAMMATE too (the guard is per team, not per device).
  const again = await post(`/api/games/${g.gid}/flag-setup`, {
    device_id: g.west[0].device,
    assignments: WEST_ASSIGN,
    surroundings_photo_path: await uploadSurroundingsPhoto(g.gid, g.wTeam, `${RUN}-w2`),
  })
  rec.check(
    'same team submitting flag-setup TWICE → 409 already_submitted (refused, not idempotent)',
    again.status === 409 && again.body.error === 'already_submitted',
    `status=${again.status} error=${again.body.error}`,
  )
  const byTeammate = await post(`/api/games/${g.gid}/flag-setup`, {
    device_id: g.west[1].device,
    assignments: WEST_ASSIGN,
    surroundings_photo_path: await uploadSurroundingsPhoto(g.gid, g.wTeam, `${RUN}-w3`),
  })
  rec.check(
    'a TEAMMATE re-submitting is refused the same way → 409 already_submitted',
    byTeammate.status === 409 && byTeammate.body.error === 'already_submitted',
    `status=${byTeammate.status} error=${byTeammate.body.error}`,
  )
  rec.check(
    'west still has exactly 5 landmarks and one flags_assigned event',
    count(`select count(*) from landmarks where game_id='${g.gid}' and team_id='${g.wTeam}';`) === 5 &&
      count(`select count(*) from events where game_id='${g.gid}' and type='flags_assigned';`) === 1,
    `landmarks=${count(`select count(*) from landmarks where game_id='${g.gid}' and team_id='${g.wTeam}';`)} events=${count(`select count(*) from events where game_id='${g.gid}' and type='flags_assigned';`)}`,
  )

  // The second team closes the phase.
  const second = await post(`/api/games/${g.gid}/flag-setup`, {
    device_id: g.east[0].device,
    assignments: EAST_ASSIGN,
    surroundings_photo_path: await uploadSurroundingsPhoto(g.gid, g.eTeam, `${RUN}-e1`),
  })
  rec.check(
    'the SECOND team completing setup flips the game live and stamps started_at',
    second.status === 200 && second.body.both_teams_done === true &&
      scalar(`select status from games where id='${g.gid}';`) === 'live' &&
      scalar(`select coalesce(started_at::text,'null') from games where id='${g.gid}';`) !== 'null',
    `status=${second.status} done=${second.body.both_teams_done} game=${scalar(`select status from games where id='${g.gid}';`)}`,
  )
})

// ---------------------------------------------------------------------------
// 15. setup-state — the enemy-hiding boundary
// ---------------------------------------------------------------------------
// CLAUDE.md decision 5: enemy flag kind is hidden by the CURATED API, not by
// RLS. /setup-state is one of the two curated endpoints, so it must never carry
// an enemy landmark row. The structural reason it holds is stronger than a
// filter: the route only ever SELECTs its own team's rows
// (setup-state/route.ts:121-127), and asks the other team's rows a single
// question — "are there >= 5?" — collapsed to a boolean (line 136-153).
await strictStep(rec, 'setup-state hides the enemy team completely', async () => {
  const g = await makeSetupGame('leak')
  await post(`/api/games/${g.gid}/flag-setup`, {
    device_id: g.west[0].device,
    assignments: WEST_ASSIGN,
    surroundings_photo_path: await uploadSurroundingsPhoto(g.gid, g.wTeam, `${RUN}-leakw`),
  })
  // Harden too, so the response is probed with BOTH hidden bits set.
  db(`update teams set coins = 500 where id='${g.wTeam}';`)
  const hardened = await post(`/api/games/${g.gid}/harden-flag`, {
    device_id: g.west[0].device, player_id: g.west[0].player,
    landmark_ref: WEST_ASSIGN[0].landmark_ref,
  })
  rec.check(
    'west hardened its real flag, so kind AND hardened are both set in the DB',
    hardened.status === 200 &&
      scalar(`select hardened from landmarks where game_id='${g.gid}' and ref='${WEST_ASSIGN[0].landmark_ref}';`) === 't',
    `status=${hardened.status} hardened=${scalar(`select hardened from landmarks where game_id='${g.gid}' and ref='${WEST_ASSIGN[0].landmark_ref}';`)}`,
  )

  const enemyView = await get(`/api/games/${g.gid}/setup-state?device_id=${g.east[0].device}`)
  rec.check(
    'setup-state returns exactly the documented keys (no extra enemy surface)',
    enemyView.status === 200 &&
      JSON.stringify(Object.keys(enemyView.body).sort()) ===
        JSON.stringify(['game', 'my_landmarks', 'my_pool', 'my_team', 'other_team_done', 'other_team_id'].sort()),
    `status=${enemyView.status} keys=${Object.keys(enemyView.body).sort().join(',')}`,
  )
  const enemyText = JSON.stringify(enemyView.body)
  rec.check(
    'enemy view leaks NO flag kind: no flag_real / flag_decoy / flag_empty anywhere in the payload',
    !enemyText.includes('flag_real') && !enemyText.includes('flag_decoy') &&
      !enemyText.includes('flag_empty'),
    `payload_bytes=${enemyText.length}`,
  )
  rec.check(
    'enemy view leaks NO hardened flag (the substring does not even occur)',
    !enemyText.includes('hardened'),
    'no `hardened` key or value in the east response',
  )
  rec.check(
    "east's my_landmarks is empty (it has not submitted) and carries none of west's rows",
    Array.isArray(enemyView.body.my_landmarks) && enemyView.body.my_landmarks.length === 0,
    `my_landmarks=${JSON.stringify(enemyView.body.my_landmarks)}`,
  )
  rec.check(
    'enemy progress is reduced to the opaque boolean other_team_done=true',
    enemyView.body.other_team_done === true && typeof enemyView.body.other_team_id === 'string',
    `other_team_done=${enemyView.body.other_team_done}`,
  )
  rec.check(
    "east's own pool carries only seed-catalog kinds (church/park/...), never flag kinds",
    (enemyView.body.my_pool ?? []).every(
      (item) => !['flag_real', 'flag_decoy', 'flag_empty'].includes(item.kind),
    ) && (enemyView.body.my_pool ?? []).length >= 5,
    `pool=${(enemyView.body.my_pool ?? []).length} kinds=${[...new Set((enemyView.body.my_pool ?? []).map((i) => i.kind))].join('/')}`,
  )

  // The owning team must still see its own truth, or the hiding would be
  // indistinguishable from the data simply being absent.
  const ownView = await get(`/api/games/${g.gid}/setup-state?device_id=${g.west[0].device}`)
  const ownReal = (ownView.body.my_landmarks ?? []).find((l) => l.kind === 'flag_real')
  rec.check(
    'west DOES see its own kind + hardened (the hiding is directional, not blanket)',
    ownView.status === 200 && !!ownReal && ownReal.hardened === true &&
      (ownView.body.my_landmarks ?? []).length === 5,
    `rows=${(ownView.body.my_landmarks ?? []).length} own_real_hardened=${ownReal?.hardened}`,
  )
  rec.check(
    "west's own other_team_done is false (east has not submitted)",
    ownView.body.other_team_done === false,
    `other_team_done=${ownView.body.other_team_done}`,
  )
  rec.check(
    "setup-state's pool is ordered home-base first (the setup map anchors on it)",
    (ownView.body.my_pool ?? [])[0]?.id === scalar(`select home_landmark_id from teams where id='${g.wTeam}';`),
    `first=${(ownView.body.my_pool ?? [])[0]?.id}`,
  )

  // Identity is by device: an unknown device is not a spectator.
  const stranger = await get(`/api/games/${g.gid}/setup-state?device_id=${RUN}-nobody`)
  rec.check(
    'setup-state for a device that is not in the game → 403 forbidden',
    stranger.status === 403 && stranger.body.error === 'forbidden',
    `status=${stranger.status} error=${stranger.body.error}`,
  )
  const noDevice = await get(`/api/games/${g.gid}/setup-state`)
  rec.check(
    'setup-state with no device_id at all → 400 invalid_body',
    noDevice.status === 400 && noDevice.body.error === 'invalid_body',
    `status=${noDevice.status} error=${noDevice.body.error}`,
  )

  // The flag_hardened event is broadcast to both teams, so its payload is part
  // of the same boundary: it must name the team and nothing else.
  const hardenPayload = JSON.parse(
    scalar(`select payload::text from events where game_id='${g.gid}' and type='flag_hardened' order by created_at desc, id desc limit 1;`) || '{}',
  )
  rec.check(
    'the broadcast flag_hardened event carries ONLY team_id — no landmark_ref',
    JSON.stringify(Object.keys(hardenPayload).sort()) === JSON.stringify(['team_id']) &&
      hardenPayload.team_id === g.wTeam,
    `payload=${JSON.stringify(hardenPayload)}`,
  )
})

// ---------------------------------------------------------------------------
// 16. harden-flag during SETUP (newly allowed by migration 0054)
// ---------------------------------------------------------------------------
// 0054 P9 widened the phase gate from array['live'] to array['setup','live'],
// because a team could not harden the very flag it was deciding where to hide.
// The guards it kept are what make that safe: only the real flag, only once.
await strictStep(rec, 'harden-flag during setup (migration 0054 P9)', async () => {
  const g = await makeSetupGame('harden')

  // Before any landmark exists there is nothing to harden — proves the route
  // resolves a real row rather than trusting the ref.
  const tooEarly = await post(`/api/games/${g.gid}/harden-flag`, {
    device_id: g.west[0].device, player_id: g.west[0].player,
    landmark_ref: WEST_ASSIGN[0].landmark_ref,
  })
  rec.check(
    'harden before flag-setup (no landmark rows yet) → 404 landmark_not_in_game',
    tooEarly.status === 404 && tooEarly.body.error === 'landmark_not_in_game',
    `status=${tooEarly.status} error=${tooEarly.body.error}`,
  )

  await post(`/api/games/${g.gid}/flag-setup`, {
    device_id: g.west[0].device,
    assignments: WEST_ASSIGN,
    surroundings_photo_path: await uploadSurroundingsPhoto(g.gid, g.wTeam, `${RUN}-hard`),
  })
  rec.check(
    'game is still in SETUP for the harden probes',
    scalar(`select status from games where id='${g.gid}';`) === 'setup',
    `status=${scalar(`select status from games where id='${g.gid}';`)}`,
  )

  // Affordability is a real gate: teams start on STARTING_COINS (100) and
  // hardening costs HARDEN_COST (150), which is exactly why 0054 argues that
  // allowing setup does not make hardening free.
  rec.check(
    'a freshly-created team cannot afford to harden at T+0 → 409 insufficient_coins',
    await (async () => {
      const broke = await post(`/api/games/${g.gid}/harden-flag`, {
        device_id: g.west[0].device, player_id: g.west[0].player,
        landmark_ref: WEST_ASSIGN[0].landmark_ref,
      })
      rec.note(`unfunded harden in setup: ${broke.status} ${broke.body.error} coins=${broke.body.details?.coins}`)
      return broke.status === 409 && broke.body.error === 'insufficient_coins'
    })(),
    `starting coins ${scalar(`select coins from teams where id='${g.wTeam}';`)} < HARDEN_COST 150`,
  )

  db(`update teams set coins = 500 where id='${g.wTeam}';`)
  // Cannot harden a DECOY — this is the guard that stops hardening from
  // becoming a way to protect a bluff.
  const decoyRef = WEST_ASSIGN.find((a) => a.role === 'decoy').landmark_ref
  const decoy = await post(`/api/games/${g.gid}/harden-flag`, {
    device_id: g.west[0].device, player_id: g.west[0].player, landmark_ref: decoyRef,
  })
  rec.check(
    'harden a DECOY during setup → 409 not_real_flag',
    decoy.status === 409 && decoy.body.error === 'not_real_flag',
    `status=${decoy.status} error=${decoy.body.error}`,
  )
  const emptyRef = WEST_ASSIGN.find((a) => a.role === 'empty').landmark_ref
  const empty = await post(`/api/games/${g.gid}/harden-flag`, {
    device_id: g.west[0].device, player_id: g.west[0].player, landmark_ref: emptyRef,
  })
  rec.check(
    'harden an EMPTY candidate during setup → 409 not_real_flag',
    empty.status === 409 && empty.body.error === 'not_real_flag',
    `status=${empty.status} error=${empty.body.error}`,
  )
  rec.check(
    'neither refused harden debited coins or hardened a row',
    count(`select coins from teams where id='${g.wTeam}';`) === 500 &&
      count(`select count(*) from landmarks where game_id='${g.gid}' and hardened;`) === 0,
    `coins=${count(`select coins from teams where id='${g.wTeam}';`)} hardened_rows=${count(`select count(*) from landmarks where game_id='${g.gid}' and hardened;`)}`,
  )

  const realRef = WEST_ASSIGN.find((a) => a.role === 'real').landmark_ref
  const ok = await post(`/api/games/${g.gid}/harden-flag`, {
    device_id: g.west[0].device, player_id: g.west[0].player, landmark_ref: realRef,
  })
  rec.check(
    'harden the REAL flag during setup → 200, 150 coins debited',
    ok.status === 200 && ok.body.team_coins === 350 && ok.body.landmark_ref === realRef,
    `status=${ok.status} coins=${ok.body.team_coins}`,
  )
  rec.check(
    'exactly the real-flag row is hardened, and the ledger pair is written once',
    count(`select count(*) from landmarks where game_id='${g.gid}' and hardened;`) === 1 &&
      scalar(`select kind from landmarks where game_id='${g.gid}' and hardened;`) === 'flag_real' &&
      count(`select count(*) from events where game_id='${g.gid}' and type='flag_hardened';`) === 1 &&
      count(`select count(*) from events where game_id='${g.gid}' and type='coins_deducted' and payload->>'reason'='harden_flag';`) === 1,
    `hardened=${count(`select count(*) from landmarks where game_id='${g.gid}' and hardened;`)} kind=${scalar(`select kind from landmarks where game_id='${g.gid}' and hardened;`)}`,
  )

  const twice = await post(`/api/games/${g.gid}/harden-flag`, {
    device_id: g.west[0].device, player_id: g.west[0].player, landmark_ref: realRef,
  })
  rec.check(
    'harden a second time → 409 already_hardened, no second debit',
    twice.status === 409 && twice.body.error === 'already_hardened' &&
      count(`select coins from teams where id='${g.wTeam}';`) === 350,
    `status=${twice.status} error=${twice.body.error} coins=${count(`select coins from teams where id='${g.wTeam}';`)}`,
  )

  // Concurrent team-mate taps must still spend once — the whole reason the
  // guard lives inside harden_flag_atomic rather than the route.
  const g2 = await makeSetupGame('hardenrace')
  await post(`/api/games/${g2.gid}/flag-setup`, {
    device_id: g2.west[0].device,
    assignments: WEST_ASSIGN,
    surroundings_photo_path: await uploadSurroundingsPhoto(g2.gid, g2.wTeam, `${RUN}-hr`),
  })
  db(`update teams set coins = 500 where id='${g2.wTeam}';`)
  const taps = await Promise.all(
    [g2.west[0], g2.west[1], g2.west[0]].map((p) =>
      post(`/api/games/${g2.gid}/harden-flag`, {
        device_id: p.device, player_id: p.player, landmark_ref: realRef,
      }),
    ),
  )
  rec.check(
    'three simultaneous team-mate harden taps in SETUP debit exactly once',
    taps.filter((r) => r.status === 200).length === 1 &&
      count(`select coins from teams where id='${g2.wTeam}';`) === 350 &&
      count(`select count(*) from events where game_id='${g2.gid}' and type='flag_hardened';`) === 1,
    `ok=${taps.filter((r) => r.status === 200).length} coins=${count(`select coins from teams where id='${g2.wTeam}';`)}`,
  )

  // The enemy must not be able to tell hardening happened at all, let alone
  // where — hardening only tightens the attempt geofence.
  const enemy = await get(`/api/games/${g2.gid}/setup-state?device_id=${g2.east[0].device}`)
  rec.check(
    'after a setup-phase harden the enemy setup-state still mentions neither hardened nor any flag kind',
    !JSON.stringify(enemy.body).includes('hardened') &&
      !JSON.stringify(enemy.body).includes('flag_real'),
    'no leak in the east response',
  )
  const enemyHarden = await post(`/api/games/${g2.gid}/harden-flag`, {
    device_id: g2.east[0].device, player_id: g2.east[0].player, landmark_ref: realRef,
  })
  rec.check(
    "hardening a WEST landmark from an EAST device → 409 not_own_landmark (no kind oracle)",
    enemyHarden.status === 409 && enemyHarden.body.error === 'not_own_landmark',
    `status=${enemyHarden.status} error=${enemyHarden.body.error}`,
  )
  rec.note(
    'not_own_landmark is returned BEFORE the kind check (harden-flag/route.ts:153-158), so an enemy probing every west ref learns only "not yours" and never which one is real.',
  )
})

// ---------------------------------------------------------------------------
// 17. Arming a placed curse on an ENEMY candidate
// ---------------------------------------------------------------------------
// place-curse is legal in setup (route.ts:77), so the ownership guard matters
// during this phase too — and the same error covers "enemy candidate", "not a
// candidate at all" and "no rows yet", which is what makes it non-probeable.
await strictStep(rec, 'place-curse ownership during setup', async () => {
  const g = await makeSetupGame('placed')
  db(`update teams set coins = 600 where game_id='${g.gid}';`)

  const preSetup = await post(`/api/games/${g.gid}/place-curse`, {
    device_id: g.west[0].device, player_id: g.west[0].player,
    landmark_ref: 'landmark.biblioteca-municipal', placed_ref: 'placed.snare',
  })
  rec.check(
    'arm on an enemy landmark before any rows exist → 409 not_own_candidate',
    preSetup.status === 409 && preSetup.body.error === 'not_own_candidate',
    `status=${preSetup.status} error=${preSetup.body.error}`,
  )

  for (const [device, assignments, team, label] of [
    [g.west[0].device, WEST_ASSIGN, g.wTeam, 'w'],
    [g.east[0].device, EAST_ASSIGN, g.eTeam, 'e'],
  ]) {
    await post(`/api/games/${g.gid}/flag-setup`, {
      device_id: device, assignments,
      surroundings_photo_path: await uploadSurroundingsPhoto(g.gid, team, `${RUN}-pc-${label}`),
    })
  }
  db(`update teams set coins = 600 where game_id='${g.gid}';`)

  const onEnemy = await post(`/api/games/${g.gid}/place-curse`, {
    device_id: g.east[0].device, player_id: g.east[0].player,
    landmark_ref: WEST_ASSIGN[0].landmark_ref, // west's real flag
    placed_ref: 'placed.slow-trap',
  })
  rec.check(
    "arm on the ENEMY's candidate → 409 not_own_candidate",
    onEnemy.status === 409 && onEnemy.body.error === 'not_own_candidate',
    `status=${onEnemy.status} error=${onEnemy.body.error}`,
  )
  rec.check(
    'the refused enemy placement created no placed_curses row and no debit',
    count(`select count(*) from placed_curses where game_id='${g.gid}';`) === 0 &&
      count(`select coins from teams where id='${g.eTeam}';`) === 600,
    `rows=${count(`select count(*) from placed_curses where game_id='${g.gid}';`)} coins=${count(`select coins from teams where id='${g.eTeam}';`)}`,
  )
  rec.note(
    'not_own_candidate covers enemy-owned, unchosen-pool and not-yet-created refs alike (place-curse/route.ts:151-157), so an enemy cannot use placement as a probe for which refs a team picked.',
  )

  const unchosen = await post(`/api/games/${g.gid}/place-curse`, {
    device_id: g.west[0].device, player_id: g.west[0].player,
    // In west's pool but not among its 5 picks.
    landmark_ref: 'landmark.camara-municipal', placed_ref: 'placed.slow-trap',
  })
  rec.check(
    'arm on an own-POOL landmark the team did NOT pick → 409 not_own_candidate',
    unchosen.status === 409 && unchosen.body.error === 'not_own_candidate',
    `status=${unchosen.status} error=${unchosen.body.error}`,
  )

  const own = await post(`/api/games/${g.gid}/place-curse`, {
    device_id: g.west[0].device, player_id: g.west[0].player,
    landmark_ref: WEST_ASSIGN[1].landmark_ref, placed_ref: 'placed.slow-trap',
  })
  rec.check(
    'arm on the team\'s OWN candidate → 200 armed (the refusals above are the guard, not a broken route)',
    own.status === 200 && own.body.placed?.armed === true &&
      own.body.placed?.owner_team_id === g.wTeam,
    `status=${own.status} armed=${own.body.placed?.armed}`,
  )
})

// ===========================================================================
// host-clear-respawn (migration 0055, finding P7)
// ===========================================================================
await strictStep(rec, 'host-clear-respawn authority', async () => {
  const g = await makeGameN(2, 2, `${RUN}-hcr`)
  const host = g.west[0]
  const mate = g.west[1]
  const target = g.east[0]
  rec.note(`host-clear-respawn game ${g.code}`)
  rec.check(
    'the game creator holds is_host; the others do not',
    scalar(`select is_host from players where id='${host.player}';`) === 't' &&
      scalar(`select is_host from players where id='${mate.player}';`) === 'f',
    `host=${scalar(`select is_host from players where id='${host.player}';`)}`,
  )

  const stick = (playerId, minutesAgo = 1) =>
    db(
      `update players set respawning=true, respawn_arrived=false, respawn_target_ref='landmark.jardim-botanico', respawning_since=now() - interval '${minutesAgo} minutes' where id='${playerId}';`,
    )

  // The real thing this route exists for: a player whose GPS will not confirm.
  // Reproduce it through a genuine tag so respawning_since is stamped the
  // production way, not just by fiat.
  const WEST_REAL = coord(WEST_ASSIGN[0].landmark_ref)
  await post(`/api/games/${g.gid}/camping-heartbeat`, {
    device_id: host.device, player_id: host.player, pos: freshPos(WEST_REAL),
  })
  const tagged = await post(`/api/games/${g.gid}/tag`, {
    device_id: host.device, tagger_player_id: host.player, tagger_pos: freshPos(WEST_REAL),
    targets: [{
      player_id: target.player,
      pos: freshPos({ lat: WEST_REAL.lat + 0.00001, lng: WEST_REAL.lng }),
    }],
  })
  rec.check(
    'a real tag puts the raider into respawning WITH respawning_since stamped (0055)',
    (tagged.body.tagged_player_ids ?? []).includes(target.player) &&
      scalar(`select respawning from players where id='${target.player}';`) === 't' &&
      scalar(`select coalesce(respawning_since::text,'null') from players where id='${target.player}';`) !== 'null',
    `tagged=${(tagged.body.tagged_player_ids ?? []).length} since=${scalar(`select coalesce(respawning_since::text,'null') from players where id='${target.player}';`) !== 'null'}`,
  )

  const byNonHost = await post(`/api/games/${g.gid}/host-clear-respawn`, {
    device_id: mate.device, host_player_id: mate.player, target_player_id: target.player,
  })
  rec.check(
    'a NON-host calling host-clear-respawn → 403 not_host',
    byNonHost.status === 403 && byNonHost.body.error === 'not_host',
    `status=${byNonHost.status} error=${byNonHost.body.error}`,
  )

  // The interesting spoof: a valid host_player_id sent from the wrong device.
  // Bound at route.ts:50-63 BEFORE the RPC is trusted.
  const spoofed = await post(`/api/games/${g.gid}/host-clear-respawn`, {
    device_id: mate.device, host_player_id: host.player, target_player_id: target.player,
  })
  rec.check(
    'a SPOOFED call (real host_player_id, wrong device_id) → 403 forbidden',
    spoofed.status === 403 && spoofed.body.error === 'forbidden',
    `status=${spoofed.status} error=${spoofed.body.error}`,
  )
  const unknownHost = await post(`/api/games/${g.gid}/host-clear-respawn`, {
    device_id: host.device, host_player_id: '22222222-2222-2222-2222-222222222222',
    target_player_id: target.player,
  })
  rec.check(
    'an unknown host_player_id → 403 forbidden (device binding fails first)',
    unknownHost.status === 403 && unknownHost.body.error === 'forbidden',
    `status=${unknownHost.status} error=${unknownHost.body.error}`,
  )

  // A host of ANOTHER game must not reach in — 0055:228-231 joins through teams
  // on this game_id, so the host row is simply not found here.
  const other = await apiPost('/api/games', {
    display_name: 'Other host', device_id: `${RUN}-otherhost`, preferred_side: 'west',
  })
  const crossGame = await post(`/api/games/${g.gid}/host-clear-respawn`, {
    device_id: `${RUN}-otherhost`, host_player_id: other.me.id, target_player_id: target.player,
  })
  rec.check(
    'a host of a DIFFERENT game cannot reach in → 404 not_found',
    crossGame.status === 404 && crossGame.body.error === 'not_found',
    `status=${crossGame.status} error=${crossGame.body.error}`,
  )
  rec.check(
    'after every refused call the target is STILL respawning',
    scalar(`select respawning from players where id='${target.player}';`) === 't' &&
      count(`select count(*) from events where game_id='${g.gid}' and type='player_respawn_host_cleared';`) === 0,
    `respawning=${scalar(`select respawning from players where id='${target.player}';`)}`,
  )

  const cleared = await post(`/api/games/${g.gid}/host-clear-respawn`, {
    device_id: host.device, host_player_id: host.player, target_player_id: target.player,
  })
  rec.check(
    'the HOST releases the stuck player → 200 with the updated player row',
    cleared.status === 200 && cleared.body.player?.id === target.player &&
      cleared.body.player?.respawning === false,
    `status=${cleared.status} respawning=${cleared.body.player?.respawning}`,
  )
  rec.check(
    'the whole respawn state is reset: respawning, respawn_arrived, target_ref, respawning_since',
    scalar(
      `select respawning || '|' || respawn_arrived || '|' || coalesce(respawn_target_ref,'-') || '|' || coalesce(respawning_since::text,'-') from players where id='${target.player}';`,
    ) === 'false|false|-|-',
    scalar(
      `select respawning || '|' || respawn_arrived || '|' || coalesce(respawn_target_ref,'-') || '|' || coalesce(respawning_since::text,'-') from players where id='${target.player}';`,
    ),
  )
  const clearedPayload = JSON.parse(
    scalar(`select payload::text from events where game_id='${g.gid}' and type='player_respawn_host_cleared' order by created_at desc, id desc limit 1;`) || '{}',
  )
  rec.check(
    'a DISTINCT player_respawn_host_cleared event is appended (not the normal cleared event)',
    count(`select count(*) from events where game_id='${g.gid}' and type='player_respawn_host_cleared';`) === 1 &&
      count(`select count(*) from events where game_id='${g.gid}' and type='player_respawning_cleared';`) === 0 &&
      clearedPayload.player_id === target.player && clearedPayload.host_player_id === host.player,
    `host_cleared=1 normal_cleared=${count(`select count(*) from events where game_id='${g.gid}' and type='player_respawning_cleared';`)} payload=${JSON.stringify(clearedPayload)}`,
  )
  rec.check(
    'the released player can act again immediately (the action lock is lifted)',
    await (async () => {
      db(`update teams set coins = 900 where id='${g.eTeam}';`)
      const spend = await post(`/api/games/${g.gid}/buy-intel`, {
        device_id: target.device, player_id: target.player, intel_ref: 'intel.north-south',
      })
      return spend.status === 200
    })(),
    'buy-intel succeeds post-release',
  )

  const notRespawning = await post(`/api/games/${g.gid}/host-clear-respawn`, {
    device_id: host.device, host_player_id: host.player, target_player_id: target.player,
  })
  rec.check(
    'clearing a player who is NOT respawning → 409 target_not_respawning',
    notRespawning.status === 409 && notRespawning.body.error === 'target_not_respawning',
    `status=${notRespawning.status} error=${notRespawning.body.error}`,
  )
  rec.check(
    'the no-op clear appends no second event',
    count(`select count(*) from events where game_id='${g.gid}' and type='player_respawn_host_cleared';`) === 1,
    `events=${count(`select count(*) from events where game_id='${g.gid}' and type='player_respawn_host_cleared';`)}`,
  )

  const unknownTarget = await post(`/api/games/${g.gid}/host-clear-respawn`, {
    device_id: host.device, host_player_id: host.player,
    target_player_id: '11111111-1111-1111-1111-111111111111',
  })
  rec.check(
    'an unknown target_player_id → 404 target_not_found',
    unknownTarget.status === 404 && unknownTarget.body.error === 'target_not_found',
    `status=${unknownTarget.status} error=${unknownTarget.body.error}`,
  )
  const badBody = await post(`/api/games/${g.gid}/host-clear-respawn`, {
    device_id: host.device, host_player_id: 'not-a-uuid', target_player_id: target.player,
  })
  rec.check(
    'a non-uuid host_player_id → 400 invalid_body (Zod, before any DB work)',
    badBody.status === 400 && badBody.body.error === 'invalid_body',
    `status=${badBody.status} error=${badBody.body.error}`,
  )

  // The grace-period sweep is the other exit 0055 ships. Asserted here because
  // it and the override share a failure surface: if the sweep is what a player
  // actually relies on, it must fire at the documented 10 minutes and must NOT
  // fire while the game is paused (nobody is walking).
  stick(mate.player, 11)
  rec.check(
    'sweep_stuck_respawns(10) clears a respawn older than 10 minutes and logs a timeout event',
    count(`select public.sweep_stuck_respawns(10);`) === 1 &&
      scalar(`select respawning from players where id='${mate.player}';`) === 'f' &&
      count(`select count(*) from events where game_id='${g.gid}' and type='player_respawn_timed_out';`) === 1,
    `timeout_events=${count(`select count(*) from events where game_id='${g.gid}' and type='player_respawn_timed_out';`)}`,
  )
  stick(mate.player, 3)
  rec.check(
    'a 3-minute-old respawn is NOT swept (the grace period is a period, not a trigger)',
    count(`select public.sweep_stuck_respawns(10);`) === 0 &&
      scalar(`select respawning from players where id='${mate.player}';`) === 't',
    `still_respawning=${scalar(`select respawning from players where id='${mate.player}';`)}`,
  )
  db(`update players set respawning_since = null where id='${mate.player}';`)
  rec.check(
    'a NULL respawning_since (pre-0055 row) is never swept',
    count(`select public.sweep_stuck_respawns(10);`) === 0 &&
      scalar(`select respawning from players where id='${mate.player}';`) === 't',
    'null respawning_since skipped as documented',
  )

  stick(mate.player, 30)
  await post(`/api/games/${g.gid}/pause`, {
    device_id: g.west[0].device, player_id: g.west[0].player, action: 'pause',
  })
  await post(`/api/games/${g.gid}/pause`, {
    device_id: g.east[0].device, player_id: g.east[0].player, action: 'pause',
  })
  rec.check(
    'a 30-minute-old respawn is NOT swept while the game is PAUSED',
    scalar(`select status from games where id='${g.gid}';`) === 'paused' &&
      count(`select public.sweep_stuck_respawns(10);`) === 0 &&
      scalar(`select respawning from players where id='${mate.player}';`) === 't',
    `game=${scalar(`select status from games where id='${g.gid}';`)}`,
  )
  const whilePaused = await post(`/api/games/${g.gid}/host-clear-respawn`, {
    device_id: host.device, host_player_id: host.player, target_player_id: mate.player,
  })
  // `mate` is on the HOST's own team, which migration 0057 now refuses outright
  // (finding L1) — so this case no longer measures the pause behaviour at all,
  // it measures the own-team rule. Assert that, and assert it is a clean 403
  // rather than a 500: a rule refusal is not a server fault (the same defect
  // class as the complete-run 500 fixed earlier).
  rec.check(
    'L1 FIXED (0057): the host cannot release their OWN teammate, paused or not',
    whilePaused.status === 403 &&
      whilePaused.body?.error === 'cannot_clear_own_team' &&
      scalar(`select respawning from players where id='${mate.player}';`) === 't',
    `status=${whilePaused.status} error=${whilePaused.body?.error} still_respawning=${scalar(`select respawning from players where id='${mate.player}';`)}`,
  )
  rec.note(
    'The two exits still differ on purpose: the sweep skips paused/finished games (0055:187-189) while the override has no phase gate. What 0057 changed is WHO may be released — never the host\'s own side — so the pause dimension of this case is now untestable through a teammate. The enemy-target path is covered above.',
  )
})

// ---------------------------------------------------------------------------
// FINDINGS — recorded, NOT fixed. See the report.
// ---------------------------------------------------------------------------
await strictStep(rec, 'FINDINGS: host-clear-respawn scope', async () => {
  const g = await makeGameN(2, 2, `${RUN}-find`)
  const westHost = g.west[0]
  const raider = g.east[0]
  const WEST_REAL = coord(WEST_ASSIGN[0].landmark_ref)

  // Make the RAIDER's own team hold the host, which is the ordinary case half
  // the time: the host is whoever created the game, and they are as likely to
  // be the one getting tagged as anyone.
  db(`update players set is_host=false where id='${westHost.player}';`)
  db(`update players set is_host=true where id='${raider.player}';`)

  let selfCleared = 0
  for (let cycle = 1; cycle <= 3; cycle += 1) {
    await post(`/api/games/${g.gid}/camping-heartbeat`, {
      device_id: westHost.device, player_id: westHost.player, pos: freshPos(WEST_REAL),
    })
    await post(`/api/games/${g.gid}/tag`, {
      device_id: westHost.device, tagger_player_id: westHost.player,
      tagger_pos: freshPos(WEST_REAL),
      targets: [{
        player_id: raider.player,
        pos: freshPos({ lat: WEST_REAL.lat + 0.00001, lng: WEST_REAL.lng }),
      }],
    })
    const self = await post(`/api/games/${g.gid}/host-clear-respawn`, {
      device_id: raider.device, host_player_id: raider.player, target_player_id: raider.player,
    })
    if (self.status === 200 && scalar(`select respawning from players where id='${raider.player}';`) === 'f') {
      selfCleared += 1
    }
  }
  // L1 FIXED (0057): self-release is refused, so a tagged host must walk like
  // everyone else. This check was written the other way round and PASSED on the
  // exploit — keeping it inverted here is deliberate, so that re-opening the hole
  // fails the suite loudly rather than silently restoring a 200.
  rec.check(
    'L1 FIXED (0057): a tagged host can NOT clear their own respawn, in any cycle',
    selfCleared === 0 &&
      scalar(`select respawning from players where id='${raider.player}';`) === 't',
    `${selfCleared}/3 self-release cycles succeeded (0 = fixed); still_respawning=${scalar(`select respawning from players where id='${raider.player}';`)}`,
  )
  rec.note(
    'L1 (FIXED, migration 0057): host-clear-respawn had NO target restriction, so a tagged host could release THEMSELVES — measured at 3/3 cycles going tag → 200 → free, with no walk and no cooldown. Since whoever created the game is an ordinary raider in a 1v1 or 2v2, that made exactly one player immune to the only physical mechanic in the game, contradicting both RULEBOOK §6 ("the escape hatch exists for a broken phone, not as a shortcut") and 0055\'s own safety argument that "waiting is strictly worse than walking". 0057 excludes the host\'s whole TEAM, not just the host row: excluding only self would leave a 2v2 host able to free their teammate on demand, the same exploit one step removed. The refusal is 403 cannot_clear_own_team, and the UI filters own-team players out so it never offers a button that is guaranteed to fail. A tagged player on the host\'s side is still covered by the 10-minute grace sweep.',
  )
  rec.note(
    'L2 (PARTLY FIXED): /host-clear-respawn now HAS a client — components/game/HostRespawnOverride.tsx, surfaced in the status tab to the host only and only while an opposing player is respawning. RespawnBanner\'s false "This does not time out… nothing else clears it" copy is gone, replaced by respawn.timeout_hint which names both exits (10-minute sweep, host override) in EN and PT-PT; the test that pinned the old string was pinning a lie to the player and now asserts the new copy. flag_carrier_stripped likewise reached no UI and now raises a toast for both teams (lib/hooks/useGameToasts.ts). STILL OPEN: player_respawn_host_cleared and player_respawn_timed_out are not in the Live.tsx timeline label map, so the timeline renders raw snake_case for them, untranslated in PT.',
  )
})

const { failed } = rec.finish()
process.exitCode = failed > 0 ? 1 : 0
