-- Migration 0025: two-team weather pause/resume voting.
-- A proposal is durable in games.config for five minutes. The second team's
-- confirmation atomically changes status and appends the phase event. Resume
-- shifts started_at and all timed curse expiries by the exact paused duration.

create or replace function public.weather_pause_vote_atomic(
  p_game_id uuid,
  p_team_id uuid,
  p_actor_player_id uuid,
  p_action text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_state jsonb;
  v_requested_by uuid;
  v_requested_at timestamptz;
  v_prior_status text;
  v_paused_at timestamptz;
  v_pause_seconds int;
begin
  if p_action not in ('pause', 'resume') then
    return jsonb_build_object('error', 'invalid_pause_action');
  end if;
  select * into v_game from public.games where id = p_game_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if not exists (
    select 1 from public.teams where id = p_team_id and game_id = p_game_id
  ) then return jsonb_build_object('error', 'forbidden'); end if;

  v_state := coalesce(v_game.config->'weather_pause', '{}'::jsonb);

  if p_action = 'pause' then
    if v_game.status = 'paused' then
      return jsonb_build_object(
        'game', to_jsonb(v_game), 'action', p_action,
        'pending', false, 'applied', false, 'already_applied', true
      );
    end if;
    if v_game.status not in ('live', 'flag_found') then
      return jsonb_build_object('error', 'game_not_in_play');
    end if;
  else
    if v_game.status <> 'paused' then
      if nullif(v_state->>'last_resumed_at', '') is not null then
        return jsonb_build_object(
          'game', to_jsonb(v_game), 'action', p_action,
          'pending', false, 'applied', false, 'already_applied', true
        );
      end if;
      return jsonb_build_object('error', 'game_not_paused');
    end if;
  end if;

  if v_state->>'proposal_action' = p_action then
    begin v_requested_by := nullif(v_state->>'requested_by_team_id', '')::uuid;
    exception when others then v_requested_by := null; end;
    begin v_requested_at := nullif(v_state->>'requested_at', '')::timestamptz;
    exception when others then v_requested_at := null; end;
  end if;

  if v_requested_by is not null
     and v_requested_by <> p_team_id
     and v_requested_at > now() - interval '5 minutes' then
    if p_action = 'pause' then
      v_state := jsonb_build_object(
        'prior_status', v_game.status,
        'paused_at', now(),
        'requested_by_team_id', v_requested_by,
        'confirmed_by_team_id', p_team_id
      );
      update public.games
      set status = 'paused', config = jsonb_set(config, '{weather_pause}', v_state, true)
      where id = p_game_id returning * into v_game;
      insert into public.events(game_id, type, actor_player_id, payload)
      values (
        p_game_id, 'game_paused', p_actor_player_id,
        jsonb_build_object(
          'requested_by_team_id', v_requested_by,
          'confirmed_by_team_id', p_team_id,
          'prior_status', v_state->>'prior_status'
        )
      );
    else
      v_prior_status := coalesce(nullif(v_state->>'prior_status', ''), 'live');
      if v_prior_status not in ('live', 'flag_found') then v_prior_status := 'live'; end if;
      v_paused_at := nullif(v_state->>'paused_at', '')::timestamptz;
      v_pause_seconds := greatest(0, floor(extract(epoch from (now() - v_paused_at)))::int);

      update public.active_curses
      set expires_at = case
            when expires_at is null then null
            else expires_at + make_interval(secs => v_pause_seconds)
          end,
          params = jsonb_set(
            coalesce(params, '{}'::jsonb),
            '{weather_pause_seconds}',
            to_jsonb(coalesce((params->>'weather_pause_seconds')::int, 0) + v_pause_seconds),
            true
          )
      where game_id = p_game_id;

      v_state := jsonb_build_object(
        'last_resumed_at', now(),
        'last_pause_seconds', v_pause_seconds,
        'requested_by_team_id', v_requested_by,
        'confirmed_by_team_id', p_team_id
      );
      update public.games
      set status = v_prior_status,
          started_at = case
            when started_at is null then null
            else started_at + make_interval(secs => v_pause_seconds)
          end,
          config = jsonb_set(config, '{weather_pause}', v_state, true)
      where id = p_game_id returning * into v_game;
      insert into public.events(game_id, type, actor_player_id, payload)
      values (
        p_game_id, 'game_resumed', p_actor_player_id,
        jsonb_build_object(
          'requested_by_team_id', v_requested_by,
          'confirmed_by_team_id', p_team_id,
          'restored_status', v_prior_status,
          'pause_seconds', v_pause_seconds
        )
      );
    end if;

    return jsonb_build_object(
      'game', to_jsonb(v_game), 'action', p_action,
      'pending', false, 'applied', true, 'already_applied', false
    );
  end if;

  -- No valid opposite-team proposal: create/replace one. Repeating from the
  -- same team is idempotent and preserves the original five-minute deadline.
  if v_requested_by is null or v_requested_by <> p_team_id or
     v_requested_at <= now() - interval '5 minutes' then
    v_requested_by := p_team_id;
    v_requested_at := now();
    v_state := v_state || jsonb_build_object(
      'proposal_action', p_action,
      'requested_by_team_id', p_team_id,
      'requested_at', v_requested_at
    );
    update public.games
    set config = jsonb_set(config, '{weather_pause}', v_state, true)
    where id = p_game_id returning * into v_game;
  end if;

  return jsonb_build_object(
    'game', to_jsonb(v_game), 'action', p_action,
    'pending', true, 'applied', false, 'already_applied', false,
    'requested_by_team_id', v_requested_by,
    'proposal_expires_at', v_requested_at + interval '5 minutes'
  );
end;
$$;

-- Frozen expiry calculation must retain accumulated weather-pause time when a
-- later movement report recomputes its bounded extension.
create or replace function public.report_frozen_state(
  p_game_id uuid,
  p_curse_id uuid,
  p_player_id uuid,
  p_anchor_lat double precision,
  p_anchor_lng double precision,
  p_violation_start timestamptz,
  p_violation_end timestamptz,
  p_nominal_duration_seconds int,
  p_max_extension_factor int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_curse public.active_curses%rowtype;
  v_anchor public.frozen_player_anchors%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_added int := 0;
  v_total int := 0;
  v_pause_seconds int := 0;
  v_expires_at timestamptz;
begin
  if p_nominal_duration_seconds < 1 or p_max_extension_factor < 1 then
    raise exception 'invalid_frozen_duration';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_curse_id::text || ':frozen', 0));
  select * into v_curse from public.active_curses
  where id = p_curse_id and game_id = p_game_id and curse_ref = 'curse.frozen'
  for update;
  if not found then raise exception 'frozen_curse_not_found'; end if;
  if not exists (
    select 1 from public.players p join public.teams t on t.id = p.team_id
    where p.id = p_player_id and t.game_id = p_game_id
      and p.team_id = v_curse.target_team_id
  ) then raise exception 'frozen_player_forbidden'; end if;
  if p_anchor_lat is not null and p_anchor_lng is not null then
    insert into public.frozen_player_anchors(curse_id, player_id, lat, lng)
    values (p_curse_id, p_player_id, p_anchor_lat, p_anchor_lng)
    on conflict (curse_id, player_id) do nothing;
  end if;
  select * into v_anchor from public.frozen_player_anchors
  where curse_id = p_curse_id and player_id = p_player_id;
  if not found then raise exception 'frozen_anchor_required'; end if;
  if p_violation_start is not null or p_violation_end is not null then
    if p_violation_start is null or p_violation_end is null then
      raise exception 'invalid_frozen_interval';
    end if;
    v_start := greatest(p_violation_start, v_curse.started_at);
    v_end := least(p_violation_end, clock_timestamp());
    if v_end > v_start then
      insert into public.frozen_violation_seconds(curse_id, second_at)
      select p_curse_id, tick from generate_series(
        date_trunc('second', v_start),
        date_trunc('second', v_end - interval '1 millisecond'),
        interval '1 second'
      ) tick on conflict (curse_id, second_at) do nothing;
      get diagnostics v_added = row_count;
    end if;
  end if;
  select count(*) into v_total from public.frozen_violation_seconds
  where curse_id = p_curse_id;
  begin v_pause_seconds := coalesce((v_curse.params->>'weather_pause_seconds')::int, 0);
  exception when others then v_pause_seconds := 0; end;
  v_expires_at := least(
    v_curse.started_at + make_interval(secs => v_pause_seconds + p_nominal_duration_seconds * p_max_extension_factor),
    v_curse.started_at + make_interval(secs => v_pause_seconds + p_nominal_duration_seconds + v_total)
  );
  update public.active_curses set expires_at = v_expires_at where id = p_curse_id;
  return jsonb_build_object(
    'anchor', jsonb_build_object('lat', v_anchor.lat, 'lng', v_anchor.lng),
    'added_seconds', v_added,
    'total_violation_seconds', v_total,
    'expires_at', v_expires_at
  );
end;
$$;

revoke all on function public.weather_pause_vote_atomic(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.weather_pause_vote_atomic(uuid, uuid, uuid, text) to service_role;
