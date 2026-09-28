// Clock control for the simulation harness.
//
// WHY REBASE BACKWARD RATHER THAN FAKE A CLOCK FORWARD
// ---------------------------------------------------------------------------
// Every deadline in this app is `<live clock> vs <stored timestamp>`; nothing
// compares against an absolute epoch constant. Verified across all three
// layers:
//
//   browser   Live.tsx:159 ticks Date.now() into `now`, which feeds pure
//             functions (radarPingVisible, getCurseProofWindow, isPositionFresh).
//   Next      attempt-flag:119, attempt-start:96, end-by-timeout:69,
//             time-tick:117 all read a stored timestamp and add a constant.
//   Postgres  0030:50 (game_expired), 0045:153 (timeout), 0026:107 (lockout),
//             0040:57/66 (attempt cooldowns), 0046:43 (curse expiry),
//             0048:45 (review auto-accept), 0031 (camping), 0033/0034:71
//             (tag heartbeat freshness).
//
// So shifting the STORED timestamps backward by D is observationally identical
// to advancing all three clocks forward by D — with two decisive advantages
// that a forward fake clock does not have:
//
//  1. GPS freshness keeps working. isPositionFresh (positionFreshness.ts:8)
//     rejects a fix older than 30 s or more than 10 s in the future, and it is
//     applied in 12 server routes against the BROWSER's Date.now() stamp
//     (useGPS.ts:80). Advancing only the server clock would 409 every tag,
//     attempt and proof; advancing only the browser's would do the same from
//     the other side. Under rebase both clocks stay real, so the band holds.
//
//  2. Curse timestamps stay coherent despite being split-brain.
//     active_curses.started_at is stamped by Postgres now() (0046:180) while
//     expires_at is minted by the Next server from Date.now()
//     (buy-curse/route.ts:284-288). Rebase shifts both stored columns by the
//     same delta, preserving the interval. Advancing one clock alone makes
//     every timed curse either born-expired or effectively permanent.
//
// KNOWN LIMITS (documented rather than papered over)
// ---------------------------------------------------------------------------
//  * events.created_at is immutable in production: migration 0005's
//    events_block_mutation trigger raises 'events.created_at is immutable'.
//    We bypass it with `set session_replication_role = replica`, which is
//    SESSION-scoped (so concurrent scenarios are unaffected) and is reverted in
//    the same transaction. This is harness-only; no app code does this.
//  * Camping cannot be advanced by any clock move alone. 0031:82 credits at
//    most 15 s per heartbeat call (`least(15, ...)`), deliberately, so a
//    connectivity gap cannot be inferred as time-in-zone. Use campingSet().
//  * Radar phase is `nowMs % 20000` off the raw wall clock (radar.ts:24) and
//    the E16 check-in ack is local React state (ActiveCursesBanner.tsx:157).
//    Neither is reachable from the DB; use the browser clock override.

// db/dbScript come from harness.mjs so there is exactly one place that knows
// how to reach the container (and one place to fix if that changes).
import { db as dbRows, dbScript } from './harness.mjs'

export { dbRows, dbScript }
export const dbOne = (sql) => dbRows(sql)[0]

/**
 * Shift every stored timestamp for one game backward by `seconds`, so that all
 * three layers agree that `seconds` of game time have elapsed.
 *
 * Returns a manifest of what was shifted, for the run artifact.
 */
export function advanceClock(gameId, seconds, { shiftEvents = true } = {}) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`advanceClock: seconds must be positive, got ${seconds}`)
  }
  const iv = `make_interval(secs => ${Math.round(seconds)})`

  // One transaction so a scenario can never observe a half-shifted game.
  //
  // session_replication_role is set INSIDE the transaction and reset before
  // COMMIT: it is session-scoped (never global), so a scenario running in
  // parallel against another game keeps the append-only guard fully armed.
  const sql = `
begin;
set local session_replication_role = replica;

-- games.started_at is the spine: game timeout (0045:153), the game_expired
-- guard on every gameplay RPC (0030:50), time-bonus intervals (0045:40),
-- the 30-min protection window (attempt-flag:119) and camping's game-second
-- space (0031:64) all derive from it.
update games set
  started_at = started_at - ${iv},
  ended_at   = case when ended_at is null then null else ended_at - ${iv} end
where id = '${gameId}';

-- Curses: shift BOTH endpoints. started_at came from Postgres now(),
-- expires_at was minted by the Next server. Shifting both by the same delta
-- keeps the duration intact (see split-brain note in the header).
update active_curses set
  started_at = started_at - ${iv},
  expires_at = case when expires_at is null then null else expires_at - ${iv} end,
  created_at = created_at - ${iv}
where game_id = '${gameId}';

-- Frozen accounting: per-second violation buckets (0017:18) and anchors.
--
-- frozen_violation_seconds has a non-deferrable PK on (curse_id, second_at)
-- (0017:19-23). A contiguous block of 1-second rows shifted backward by a delta
-- SMALLER than the block's own span would collide with itself mid-statement and
-- abort the whole rebase. What the Frozen formula actually reads is count(*)
-- (0027:143) — the individual timestamps are never compared to anything — so we
-- preserve the COUNT and re-park the buckets sparsely from the shifted curse
-- start, one second apart, which can never collide.
with ordered as (
  select curse_id, second_at,
         row_number() over (partition by curse_id order by second_at) - 1 as n
  from frozen_violation_seconds
  where curse_id in (select id from active_curses where game_id = '${gameId}')
)
update frozen_violation_seconds f
set second_at = c.started_at + make_interval(secs => o.n)
from ordered o
join active_curses c on c.id = o.curse_id
where f.curse_id = o.curse_id and f.second_at = o.second_at;

update frozen_player_anchors set created_at = created_at - ${iv}
where curse_id in (select id from active_curses where game_id = '${gameId}');

-- Challenge review auto-accept reads payload->>'submitted_at' first
-- (0048:40) and falls back to cards.updated_at only for legacy rows, so both
-- must move or a pending review will not age.
update cards set
  created_at = created_at - ${iv},
  updated_at = updated_at - ${iv},
  payload = case
    when payload ? 'submitted_at'
      then jsonb_set(payload, '{submitted_at}',
             to_jsonb(((payload->>'submitted_at')::timestamptz - ${iv})::text))
    else payload
  end
where game_id = '${gameId}';

update curse_proofs set submitted_at = submitted_at - ${iv}
where game_id = '${gameId}';
update placed_curses set
  created_at = created_at - ${iv},
  triggered_at = case when triggered_at is null then null else triggered_at - ${iv} end
where game_id = '${gameId}';
update photos set
  created_at = created_at - ${iv},
  taken_at = case when taken_at is null then null else taken_at - ${iv} end
where game_id = '${gameId}';
update tags set created_at = created_at - ${iv} where game_id = '${gameId}';

-- Weather-pause bookkeeping lives in games.config JSONB and is read as a
-- timestamptz at 0027:52/67 and 0031:56. Resume already rebases started_at and
-- every curse timestamp itself (0027:70-81); we only shift the recorded
-- instants so the 5-min proposal window ages consistently. We do NOT add a
-- second pause offset, which would double-count.
update games set config = jsonb_set(
  config, '{weather_pause,paused_at}',
  to_jsonb(((config->'weather_pause'->>'paused_at')::timestamptz - ${iv})::text))
where id = '${gameId}'
  and coalesce(config->'weather_pause'->>'paused_at', '') <> '';
update games set config = jsonb_set(
  config, '{weather_pause,requested_at}',
  to_jsonb(((config->'weather_pause'->>'requested_at')::timestamptz - ${iv})::text))
where id = '${gameId}'
  and coalesce(config->'weather_pause'->>'requested_at', '') <> '';

${
  shiftEvents
    ? `-- events.created_at is immutable in production (0005). It is the authority
-- for the 15-min landmark lockout (0026:107), the attempt-start 60 s/15 s
-- cooldowns (0040:57,66) and time-bonus dedupe (0045:50), so a harness that
-- could not move it would leave those three deadlines untestable.
update events set created_at = created_at - ${iv} where game_id = '${gameId}';`
    : '-- events left untouched (shiftEvents: false)'
}

-- Camping is in game-second space relative to games.started_at, which we just
-- moved. Re-base last_game_second by the same delta so the next heartbeat sees
-- a normal ~5 s step instead of a huge jump the 15 s cap would swallow.
update player_camping_state set
  last_game_second = greatest(0, last_game_second + ${Math.round(seconds)})
where game_id = '${gameId}';

set local session_replication_role = default;
commit;
`
  dbScript(sql)
  return { gameId, seconds, shiftedEvents: shiftEvents }
}

export const advanceClockMinutes = (gameId, minutes, opts) =>
  advanceClock(gameId, Math.round(minutes * 60), opts)

/**
 * Write camping state directly. Camping is the one deadline no clock move can
 * fast-forward: update_player_camping_state credits at most 15 s per call
 * (0031:82). The production route derives `inside_zone` from GPS and this RPC
 * owns the accumulator, so seeding the accumulator is the only way to reach the
 * 90 s warn / 120 s lock boundaries in a test.
 */
export function campingSet(gameId, playerId, teamId, fields = {}) {
  const {
    insideZone = true,
    insideSeconds = 0,
    outsideSeconds = 0,
    locked = false,
    // How far in the past to place last_game_second. The RPC credits
    // `v_game_second - last_game_second` capped at 15 (0031:82), so a lag of 0
    // means the next heartbeat credits nothing. Default 5 mirrors the real
    // CAMPING_HEARTBEAT_MS cadence (useCamping.ts:21).
    lagSeconds = 5,
  } = fields
  dbScript(`
insert into player_camping_state (
  player_id, game_id, team_id, inside_zone,
  accumulated_inside_seconds, accumulated_outside_seconds, locked,
  last_game_second, last_heartbeat_at
)
select '${playerId}', '${gameId}', '${teamId}', ${insideZone},
       ${insideSeconds}, ${outsideSeconds}, ${locked},
       greatest(0, floor(extract(epoch from (clock_timestamp() - started_at)))::bigint - ${Math.round(lagSeconds)}),
       clock_timestamp()
from games where id = '${gameId}'
on conflict (player_id) do update set
  inside_zone = excluded.inside_zone,
  accumulated_inside_seconds = excluded.accumulated_inside_seconds,
  accumulated_outside_seconds = excluded.accumulated_outside_seconds,
  locked = excluded.locked,
  last_game_second = excluded.last_game_second,
  last_heartbeat_at = excluded.last_heartbeat_at;
`)
}

export function campingGet(playerId) {
  const row = dbOne(
    `select inside_zone, accumulated_inside_seconds, accumulated_outside_seconds, locked from player_camping_state where player_id = '${playerId}';`,
  )
  if (!row) return null
  const [insideZone, insideSeconds, outsideSeconds, locked] = row.split('|')
  return {
    insideZone: insideZone === 't',
    insideSeconds: Number(insideSeconds),
    outsideSeconds: Number(outsideSeconds),
    locked: locked === 't',
  }
}

/** Snapshot every clock-bearing value for one game (artifact + assertions). */
export function clockSnapshot(gameId) {
  // Single-line SQL: db() passes the statement through JSON.stringify, which
  // turns a real newline into a literal \n that psql then rejects.
  const game = dbOne(
    `select status, coalesce(round(extract(epoch from (now() - started_at)))::text,'null'), coalesce((config->>'duration_minutes'),'180') from games where id = '${gameId}';`,
  )
  const [status, elapsedS, durationMin] = (game ?? '||').split('|')
  const curses = dbRows(
    `select curse_ref, round(extract(epoch from (now() - started_at)))::text, coalesce(round(extract(epoch from (expires_at - now())))::text,'null') from active_curses where game_id = '${gameId}' order by curse_ref;`,
  ).map((r) => {
    const [ref, ageS, remainingS] = r.split('|')
    return { ref, ageS: Number(ageS), remainingS: remainingS === 'null' ? null : Number(remainingS) }
  })
  return {
    status,
    elapsedSeconds: elapsedS === 'null' ? null : Number(elapsedS),
    durationMinutes: Number(durationMin),
    activeCurses: curses,
  }
}
