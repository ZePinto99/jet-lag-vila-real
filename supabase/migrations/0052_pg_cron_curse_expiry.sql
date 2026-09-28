-- Migration 0052 — finding P13 (partial): with every client offline, nothing
-- polled /expire-curses, so timed curses sat in `active_curses` indefinitely.
--
-- Measured: a 10-minute Full Stop stayed in the table for a full 60 minutes of
-- offline time with ZERO `curse_expired` events, and `/live-state` kept
-- reporting it to the cursed team, so `ActiveCursesBanner` showed an expired
-- curse forever. It never actually locked anything (the `expires_at <= now()`
-- filter in the lock checks holds), but the caster had paid 150 coins for 10
-- minutes of effect plus an indefinite bluff, and the victim played around a
-- curse that was doing nothing. Neither team could tell.
--
-- This is ARCHITECTURE.md §9 backlog item 12: replace the 20-s client poll
-- (lib/hooks/useCurseExpiryPoll.ts) with server-side expiry so the ledger
-- advances whether or not anyone has the app open. pg_cron 1.6.4 is present in
-- this image's shared_preload_libraries and accepts sub-minute schedules
-- (verified: a '30 seconds' probe job fired 4/4 times on the dot).
--
-- The client poll is deliberately LEFT IN PLACE: it is the low-latency path that
-- makes expiry feel immediate to a player who is watching the banner, while cron
-- is the floor that guarantees expiry happens at all. Both funnel into the same
-- `expire_curses_atomic`, which is idempotent (it only ever selects rows already
-- past `expires_at`) and takes the game-row lock first, so the two cannot race.
--
-- Two guards the bulk RPC does not apply itself, and which this sweep must:
--   * Only games with status live/flag_found are swept. `expire_curses_atomic`
--     has no status check — the route supplies the pause gate
--     (expire-curses/route.ts:63). Expiring during a pause would be WRONG:
--     0027/0050 shift every `expires_at` forward by the paused duration on
--     resume, so a curse whose deadline passed mid-pause still has time owed.
--   * Per-game failures are contained, so one stuck game cannot abort the sweep
--     for every other game on the instance.

-- pg_cron creates its own `cron` schema for the job tables regardless of where
-- the extension's functions land (here: pg_catalog), so `cron.schedule` is the
-- stable entry point. Guarded so that an environment without pg_cron preloaded
-- still applies the rest of the migration set instead of failing `db reset`; in
-- that case the client poll remains the only expiry path and P13 stands.
do $$
begin
  execute 'create extension if not exists pg_cron';
exception when others then
  raise notice 'pg_cron unavailable (%), skipping scheduled curse expiry; the client poll remains the only path', sqlerrm;
end;
$$;

-- Bulk sweep across every in-play game. Returns per-run counters for
-- observability via cron.job_run_details / a manual service_role call.
create or replace function public.sweep_expired_curses()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game_id uuid;
  v_expired uuid[];
  v_games int := 0;
  v_curses int := 0;
  v_skipped int := 0;
begin
  -- A game row locked by an in-flight cast is skipped rather than waited on, so
  -- the sweep cannot stall behind gameplay; the next run 30 s later picks it up.
  set local lock_timeout = '2s';

  for v_game_id in
    select g.id
    from public.games g
    where g.status in ('live', 'flag_found')
      and exists (
        select 1
        from public.active_curses ac
        where ac.game_id = g.id
          and ac.expires_at is not null
          and ac.expires_at <= now()
      )
    order by g.id
  loop
    begin
      -- No actor: this is housekeeping, not a player action. events.actor_player_id
      -- is nullable and no `curse_expired` consumer reads it (they read payload).
      v_expired := public.expire_curses_atomic(v_game_id, null);
      v_games := v_games + 1;
      v_curses := v_curses + coalesce(cardinality(v_expired), 0);
    exception when others then
      -- lock_not_available, or anything else this one game manages to raise.
      v_skipped := v_skipped + 1;
      raise notice 'sweep_expired_curses: skipped game % (%)', v_game_id, sqlerrm;
    end;
  end loop;

  return jsonb_build_object(
    'games_swept', v_games,
    'curses_expired', v_curses,
    'games_skipped', v_skipped
  );
end;
$$;

revoke all on function public.sweep_expired_curses() from public, anon, authenticated;
grant execute on function public.sweep_expired_curses() to service_role;

-- Schedule at the same 30-s cadence the offline gap needs closing at. Keyed by
-- job name, so re-running this migration replaces the schedule rather than
-- stacking duplicate jobs (verified: two calls, one row in cron.job).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule(
      'expire-curses-sweep',
      '30 seconds',
      'select public.sweep_expired_curses()'
    );
  end if;
end;
$$;
