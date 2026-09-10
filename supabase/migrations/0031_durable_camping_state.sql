-- Migration 0031: server-authoritative, reload-safe camping enforcement.
-- No GPS coordinates are stored. The API derives only whether a player is
-- inside a 50 m candidate circle, then this function advances consecutive
-- gameplay seconds. Weather-paused time never advances the game clock.

create table if not exists public.player_camping_state (
  player_id                  uuid primary key references public.players(id) on delete cascade,
  game_id                    uuid not null references public.games(id) on delete cascade,
  team_id                    uuid not null references public.teams(id) on delete cascade,
  inside_zone                boolean not null default false,
  accumulated_inside_seconds integer not null default 0 check (accumulated_inside_seconds >= 0),
  accumulated_outside_seconds integer not null default 0 check (accumulated_outside_seconds >= 0),
  locked                     boolean not null default false,
  last_game_second           bigint not null,
  last_heartbeat_at          timestamptz not null default now()
);

create index if not exists player_camping_state_game_idx
  on public.player_camping_state(game_id, team_id);

alter table public.player_camping_state enable row level security;
-- Intentionally no client policies. The heartbeat/tag routes use service role
-- and return only the calling player's derived timer state.

create or replace function public.update_player_camping_state(
  p_game_id uuid,
  p_player_id uuid,
  p_inside_zone boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_player public.players%rowtype;
  v_state public.player_camping_state%rowtype;
  v_clock_at timestamptz;
  v_game_second bigint;
  v_delta integer;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if v_game.status not in ('live', 'flag_found', 'paused') or v_game.started_at is null then
    return jsonb_build_object('error', 'game_not_in_play');
  end if;

  select p.* into v_player
  from public.players p
  join public.teams t on t.id = p.team_id
  where p.id = p_player_id and t.game_id = p_game_id;
  if not found then return jsonb_build_object('error', 'forbidden'); end if;

  if v_game.status = 'paused' then
    begin
      v_clock_at := nullif(v_game.config->'weather_pause'->>'paused_at', '')::timestamptz;
    exception when others then
      v_clock_at := null;
    end;
    v_clock_at := coalesce(v_clock_at, clock_timestamp());
  else
    v_clock_at := clock_timestamp();
  end if;
  v_game_second := greatest(0, floor(extract(epoch from (v_clock_at - v_game.started_at)))::bigint);

  select * into v_state from public.player_camping_state
  where player_id = p_player_id for update;

  if not found then
    insert into public.player_camping_state(
      player_id, game_id, team_id, inside_zone, last_game_second
    ) values (
      p_player_id, p_game_id, v_player.team_id, p_inside_zone, v_game_second
    ) returning * into v_state;
  else
    if v_state.game_id <> p_game_id or v_state.team_id <> v_player.team_id then
      return jsonb_build_object('error', 'forbidden');
    end if;

    -- Heartbeats normally arrive every five seconds. Never infer more than 15
    -- seconds across a connectivity gap because no position was observed.
    v_delta := case when v_game.status = 'paused' then 0 else
      greatest(0, least(15, (v_game_second - v_state.last_game_second)::integer)) end;

    if p_inside_zone then
      if v_state.inside_zone then
        v_state.accumulated_inside_seconds := v_state.accumulated_inside_seconds + v_delta;
      elsif not v_state.locked then
        v_state.accumulated_inside_seconds := 0;
      end if;
      v_state.accumulated_outside_seconds := 0;
      if v_state.accumulated_inside_seconds >= 120 then v_state.locked := true; end if;
    else
      if v_state.inside_zone then
        v_state.accumulated_outside_seconds := 0;
      else
        v_state.accumulated_outside_seconds := v_state.accumulated_outside_seconds + v_delta;
      end if;
      if not v_state.locked then v_state.accumulated_inside_seconds := 0; end if;
      if v_state.locked and v_state.accumulated_outside_seconds >= 60 then
        v_state.locked := false;
        v_state.accumulated_inside_seconds := 0;
        v_state.accumulated_outside_seconds := 0;
      end if;
    end if;

    update public.player_camping_state set
      inside_zone = p_inside_zone,
      accumulated_inside_seconds = v_state.accumulated_inside_seconds,
      accumulated_outside_seconds = v_state.accumulated_outside_seconds,
      locked = v_state.locked,
      last_game_second = v_game_second,
      last_heartbeat_at = clock_timestamp()
    where player_id = p_player_id
    returning * into v_state;
  end if;

  return jsonb_build_object(
    'inside_zone', v_state.inside_zone,
    'seconds_in_zone', v_state.accumulated_inside_seconds,
    'seconds_outside', v_state.accumulated_outside_seconds,
    'locked', v_state.locked,
    'last_heartbeat_at', v_state.last_heartbeat_at
  );
end;
$$;

revoke all on function public.update_player_camping_state(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.update_player_camping_state(uuid, uuid, boolean)
  to service_role;
