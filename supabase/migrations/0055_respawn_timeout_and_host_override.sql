-- Migration 0055 (finding P7): give the respawn state a clock and two exits.
--
-- The problem: `players.respawning` had NO timestamp anywhere — no
-- respawning_since, no deadline, and nothing scheduled to clear it. A tagged
-- player whose GPS would not confirm arrival at the assigned neutral landmark
-- stayed `respawning` for the rest of the game: immune to further tags
-- (tag/route.ts:285-288, and 0044:87-96 aborts a whole bulk tag if any target is
-- respawning) but completely action-locked (lib/server/actionLock.ts:40
-- short-circuits before every other check). Self-harming rather than
-- exploitable, but it ends that person's evening with no recovery path — and a
-- bad GPS fix in Vila Real's narrow streets is not a hypothetical.
--
-- Two exits, per the user's decision ("timeout plus host override"):
--
--   1. A GRACE PERIOD. After RESPAWN_TIMEOUT_MINUTES the sweep clears the state
--      automatically. 10 minutes is chosen to be comfortably longer than any
--      real walk to a neutral landmark from anywhere in the play area — the
--      longest such walk measured in tools/sim is well under that — so the
--      timeout can never be used to skip the respawn penalty by simply waiting.
--      Waiting is strictly worse than walking.
--
--   2. A HOST OVERRIDE. The lobby host can release a stuck player immediately
--      rather than making them sit out the grace period. Hosts already have
--      player-management authority (they can remove players), so this adds no
--      new trust assumption.
--
-- Both exits emit a distinct event so the timeline shows WHY the state ended,
-- rather than a mystery clear. Neither reuses 'player_respawning_cleared',
-- which means "walked it off properly" and is what the scoring/timeline treats
-- as a normal respawn.
--
-- Deliberately NOT done: no retroactive backfill of respawning_since for rows
-- already mid-respawn when this deploys. They get `null`, and the sweep skips
-- nulls, so an in-flight respawn is never cleared out from under a player by
-- the deploy itself. The next tag stamps it.

alter table public.players
  add column if not exists respawning_since timestamptz;

comment on column public.players.respawning_since is
  'When the current respawn began. Set by apply_tag_atomic_unchecked, cleared with the respawn state. Null for rows that were already respawning before migration 0055, which the timeout sweep skips.';

-- ---------------------------------------------------------------------------
-- Stamp the clock on every tag. Recreated from 0053 (finding P2) with the one
-- added assignment; everything else is byte-identical.
-- ---------------------------------------------------------------------------

create or replace function public.apply_tag_atomic_unchecked(
  p_game_id uuid,
  p_raider_player_id uuid,
  p_defender_player_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_respawn_target_ref text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raider public.players%rowtype;
  v_was_carrier boolean;
begin
  select * into v_raider from public.players
  where id = p_raider_player_id for update;
  if not found or v_raider.respawning then return false; end if;
  if nullif(p_respawn_target_ref, '') is null then
    raise exception 'respawn_target_required';
  end if;

  v_was_carrier := coalesce(v_raider.flag_carrier, false);

  insert into public.tags(game_id, raider_player_id, defender_player_id, lat, lng)
  values (p_game_id, p_raider_player_id, p_defender_player_id, p_lat, p_lng);
  update public.players set
    respawning = true,
    respawn_target_ref = p_respawn_target_ref,
    respawn_arrived = false,
    respawning_since = clock_timestamp(),   -- P7
    flag_carrier = false                    -- P2
  where id = p_raider_player_id;

  insert into public.events(game_id, type, actor_player_id, payload)
  values (p_game_id, 'tag', p_defender_player_id,
    jsonb_build_object(
      'raider_player_id', p_raider_player_id,
      'defender_player_id', p_defender_player_id,
      'lat', p_lat, 'lng', p_lng,
      'respawn_target_ref', p_respawn_target_ref,
      'stripped_flag_carrier', v_was_carrier
    ));
  insert into public.events(game_id, type, actor_player_id, payload)
  values (p_game_id, 'player_respawning_set', p_defender_player_id,
    jsonb_build_object(
      'player_id', p_raider_player_id,
      'team_id', v_raider.team_id,
      'respawn_target_ref', p_respawn_target_ref
    ));

  if v_was_carrier then
    insert into public.events(game_id, type, actor_player_id, payload)
    values (p_game_id, 'flag_carrier_stripped', p_defender_player_id,
      jsonb_build_object(
        'player_id', p_raider_player_id,
        'team_id', v_raider.team_id,
        'defender_player_id', p_defender_player_id
      ));
  end if;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Clear the clock alongside the state. Recreated from 0026 with the added
-- respawning_since reset on the 'clear' stage.
-- ---------------------------------------------------------------------------

create or replace function public.advance_respawn_atomic(
  p_game_id uuid,
  p_player_id uuid,
  p_expected_target_ref text,
  p_stage text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_player public.players%rowtype;
begin
  select p.* into v_player from public.players p
  join public.teams t on t.id = p.team_id
  where p.id = p_player_id and t.game_id = p_game_id
  for update of p;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if not v_player.respawning then return jsonb_build_object('error', 'not_respawning'); end if;
  if v_player.respawn_target_ref is distinct from p_expected_target_ref then
    return jsonb_build_object('error', 'respawn_target_changed');
  end if;
  if p_stage = 'arrive' then
    if v_player.respawn_arrived then return jsonb_build_object('error', 'already_arrived'); end if;
    update public.players set respawn_arrived = true
    where id = p_player_id returning * into v_player;
    insert into public.events(game_id, type, actor_player_id, payload)
    values (p_game_id, 'player_respawn_arrived', p_player_id,
      jsonb_build_object('player_id', p_player_id, 'at_neutral_ref', p_expected_target_ref));
  elsif p_stage = 'clear' then
    if not v_player.respawn_arrived then return jsonb_build_object('error', 'neutral_not_reached'); end if;
    update public.players set
      respawning = false, respawn_arrived = false, respawn_target_ref = null,
      respawning_since = null
    where id = p_player_id returning * into v_player;
    insert into public.events(game_id, type, actor_player_id, payload)
    values (p_game_id, 'player_respawning_cleared', p_player_id,
      jsonb_build_object('player_id', p_player_id, 'at_neutral_ref', p_expected_target_ref));
  else return jsonb_build_object('error', 'invalid_respawn_stage');
  end if;
  return jsonb_build_object('player', to_jsonb(v_player));
end;
$$;

-- ---------------------------------------------------------------------------
-- Exit 1: the grace-period sweep, on the pg_cron job added by 0052.
-- ---------------------------------------------------------------------------

create or replace function public.sweep_stuck_respawns(
  p_timeout_minutes int default 10
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_row record; v_count int := 0;
begin
  for v_row in
    select p.id, p.team_id, p.respawn_target_ref, p.respawning_since, t.game_id
    from public.players p
    join public.teams t on t.id = p.team_id
    join public.games g on g.id = t.game_id
    where p.respawning
      -- Null means "already respawning before 0055 deployed": never swept, so a
      -- deploy cannot clear an in-flight respawn out from under a player.
      and p.respawning_since is not null
      and p.respawning_since < clock_timestamp()
                               - make_interval(mins => p_timeout_minutes)
      -- Only games actually being played. A paused game must not burn the grace
      -- period while nobody is walking (0027/0050 shift every other deadline
      -- forward on resume, so sweeping here would contradict that).
      and g.status in ('live', 'flag_found')
  loop
    update public.players set
      respawning = false, respawn_arrived = false,
      respawn_target_ref = null, respawning_since = null
    where id = v_row.id;

    insert into public.events(game_id, type, actor_player_id, payload)
    values (v_row.game_id, 'player_respawn_timed_out', null,
      jsonb_build_object(
        'player_id', v_row.id,
        'team_id', v_row.team_id,
        'respawn_target_ref', v_row.respawn_target_ref,
        'respawning_since', v_row.respawning_since,
        'timeout_minutes', p_timeout_minutes
      ));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Exit 2: the host override.
-- ---------------------------------------------------------------------------

create or replace function public.host_clear_respawn_atomic(
  p_game_id uuid,
  p_host_player_id uuid,
  p_target_player_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_host public.players%rowtype; v_target public.players%rowtype;
begin
  -- The host must belong to THIS game; is_host alone is not sufficient
  -- authority, since a host of another game must not reach in here.
  select p.* into v_host from public.players p
  join public.teams t on t.id = p.team_id
  where p.id = p_host_player_id and t.game_id = p_game_id;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if not coalesce(v_host.is_host, false) then
    return jsonb_build_object('error', 'not_host');
  end if;

  select p.* into v_target from public.players p
  join public.teams t on t.id = p.team_id
  where p.id = p_target_player_id and t.game_id = p_game_id
  for update of p;
  if not found then return jsonb_build_object('error', 'target_not_found'); end if;
  if not v_target.respawning then
    return jsonb_build_object('error', 'target_not_respawning');
  end if;

  update public.players set
    respawning = false, respawn_arrived = false,
    respawn_target_ref = null, respawning_since = null
  where id = p_target_player_id returning * into v_target;

  insert into public.events(game_id, type, actor_player_id, payload)
  values (p_game_id, 'player_respawn_host_cleared', p_host_player_id,
    jsonb_build_object(
      'player_id', p_target_player_id,
      'team_id', v_target.team_id,
      'host_player_id', p_host_player_id
    ));

  return jsonb_build_object('player', to_jsonb(v_target));
end;
$$;

revoke all on function public.sweep_stuck_respawns(int) from public, anon, authenticated;
revoke all on function public.host_clear_respawn_atomic(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.host_clear_respawn_atomic(uuid, uuid, uuid) to service_role;

-- Fold the sweep into the existing 30 s curse-expiry job (0052) rather than
-- adding a second schedule: one cadence, one failure surface.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('expire-curses-sweep');
    perform cron.schedule(
      'expire-curses-sweep', '30 seconds',
      $cron$select public.sweep_expired_curses(), public.sweep_stuck_respawns(10);$cron$
    );
  end if;
end $$;
