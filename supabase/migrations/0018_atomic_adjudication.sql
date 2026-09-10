-- Migration 0018: atomic flag attempts, tags, and placed-curse triggers.
-- These are proximity-driven and commonly arrive from multiple clients at
-- once. Each adjudication locks its authoritative row before mutating state.

create unique index if not exists landmarks_game_team_ref_unique
  on public.landmarks(game_id, team_id, ref)
  where team_id is not null;

create unique index if not exists active_curses_no_stack_unique
  on public.active_curses(game_id, target_team_id, curse_ref);

create or replace function public.attempt_flag_atomic(
  p_game_id uuid,
  p_player_id uuid,
  p_team_id uuid,
  p_landmark_ref text,
  p_result text,
  p_photo_url text,
  p_lat double precision,
  p_lng double precision,
  p_taken_at timestamptz,
  p_answer text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_player public.players%rowtype;
  v_payload jsonb;
  v_lockout public.events%rowtype;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found then raise exception 'game_not_found'; end if;
  if v_game.status <> 'live' then
    return jsonb_build_object('error', 'game_not_in_live');
  end if;

  select * into v_player from public.players where id = p_player_id for update;
  if not found or v_player.team_id <> p_team_id then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if v_player.respawning then
    return jsonb_build_object('error', 'player_respawning');
  end if;

  if p_result in ('decoy', 'empty') then
    select * into v_lockout from public.events
    where game_id = p_game_id and type = 'flag_attempt'
      and payload->>'team_id' = p_team_id::text
      and payload->>'landmark_ref' = p_landmark_ref
      and payload->>'result' in ('decoy', 'empty')
      and created_at >= now() - interval '15 minutes'
    order by created_at desc limit 1;
    if found then
      return jsonb_build_object(
        'error', 'landmark_locked_out',
        'unlocks_at', v_lockout.created_at + interval '15 minutes'
      );
    end if;
  end if;

  insert into public.photos(
    game_id, player_id, url, lat, lng, taken_at, kind
  ) values (
    p_game_id, p_player_id, p_photo_url, p_lat, p_lng, p_taken_at, 'flag_attempt'
  );

  v_payload := jsonb_build_object(
    'landmark_ref', p_landmark_ref,
    'result', p_result,
    'team_id', p_team_id,
    'photo_url', p_photo_url
  );
  if nullif(p_answer, '') is not null then
    v_payload := v_payload || jsonb_build_object('answer', p_answer);
  end if;

  if p_result = 'real' then
    update public.players set flag_carrier = true where id = p_player_id;
    update public.games set status = 'flag_found' where id = p_game_id
    returning * into v_game;
    insert into public.events(game_id, type, actor_player_id, payload)
    values (p_game_id, 'flag_attempt', p_player_id, v_payload);
    insert into public.events(game_id, type, actor_player_id, payload)
    values (p_game_id, 'flag_found', p_player_id,
      jsonb_build_object(
        'player_id', p_player_id,
        'landmark_ref', p_landmark_ref,
        'team_id', p_team_id
      ));
  elsif p_result = 'decoy' then
    update public.cards set state = 'expired', updated_at = now()
    where game_id = p_game_id and team_id = p_team_id
      and kind = 'intel' and state = 'in_hand';
    insert into public.events(game_id, type, actor_player_id, payload)
    values (p_game_id, 'flag_attempt', p_player_id, v_payload);
    update public.players set respawning = true where id = p_player_id;
    insert into public.events(game_id, type, actor_player_id, payload)
    values (p_game_id, 'player_respawning_set', p_player_id,
      jsonb_build_object(
        'player_id', p_player_id, 'team_id', p_team_id, 'reason', 'decoy'
      ));
  elsif p_result = 'empty' then
    insert into public.events(game_id, type, actor_player_id, payload)
    values (p_game_id, 'flag_attempt', p_player_id, v_payload);
  else
    raise exception 'invalid_flag_result';
  end if;

  return jsonb_build_object('game', to_jsonb(v_game));
end;
$$;

create or replace function public.apply_tag_atomic(
  p_game_id uuid,
  p_raider_player_id uuid,
  p_defender_player_id uuid,
  p_lat double precision,
  p_lng double precision
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raider public.players%rowtype;
  v_victim public.cards%rowtype;
begin
  select * into v_raider from public.players
  where id = p_raider_player_id for update;
  if not found then return false; end if;
  if v_raider.respawning then return false; end if;

  insert into public.tags(
    game_id, raider_player_id, defender_player_id, lat, lng
  ) values (
    p_game_id, p_raider_player_id, p_defender_player_id, p_lat, p_lng
  );
  update public.players set respawning = true where id = p_raider_player_id;

  select * into v_victim from public.cards
  where game_id = p_game_id and team_id = v_raider.team_id
    and kind = 'intel' and state = 'in_hand'
  order by random() limit 1 for update;
  if found then
    update public.cards set state = 'expired', updated_at = now()
    where id = v_victim.id;
  end if;

  insert into public.events(game_id, type, actor_player_id, payload)
  values (p_game_id, 'tag', p_defender_player_id,
    jsonb_build_object(
      'raider_player_id', p_raider_player_id,
      'defender_player_id', p_defender_player_id,
      'lat', p_lat, 'lng', p_lng
    ));
  insert into public.events(game_id, type, actor_player_id, payload)
  values (p_game_id, 'player_respawning_set', p_defender_player_id,
    jsonb_build_object(
      'player_id', p_raider_player_id, 'team_id', v_raider.team_id
    ));
  return true;
end;
$$;

create or replace function public.trigger_placed_curse_atomic(
  p_placement_id uuid,
  p_game_id uuid,
  p_intruder_player_id uuid,
  p_intruder_team_id uuid,
  p_curse_ref text,
  p_tier text,
  p_expires_at timestamptz,
  p_params jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_placement public.placed_curses%rowtype;
  v_cast boolean := false;
begin
  select * into v_placement from public.placed_curses
  where id = p_placement_id and game_id = p_game_id for update;
  if not found or not v_placement.armed then
    return jsonb_build_object('triggered', false);
  end if;

  update public.placed_curses set
    armed = false,
    triggered_at = now(),
    triggered_by_team_id = p_intruder_team_id
  where id = p_placement_id;

  if not exists (
    select 1 from public.active_curses
    where game_id = p_game_id and target_team_id = p_intruder_team_id
      and curse_ref = p_curse_ref
  ) then
    insert into public.active_curses(
      game_id, target_team_id, curse_ref, started_at, expires_at, params
    ) values (
      p_game_id, p_intruder_team_id, p_curse_ref, now(), p_expires_at, p_params
    );
    insert into public.events(game_id, type, actor_player_id, payload)
    values (p_game_id, 'curse_cast', p_intruder_player_id,
      jsonb_build_object(
        'buyer_team_id', v_placement.owner_team_id,
        'target_team_id', p_intruder_team_id,
        'curse_ref', p_curse_ref,
        'tier', p_tier,
        'dice_total', 0,
        'dice_rolls', '[]'::jsonb,
        'expires_at', p_expires_at,
        'source', 'placed_curse'
      ));
    v_cast := true;
  end if;

  insert into public.events(game_id, type, actor_player_id, payload)
  values (p_game_id, 'placed_curse_triggered', p_intruder_player_id,
    jsonb_build_object(
      'owner_team_id', v_placement.owner_team_id,
      'target_team_id', p_intruder_team_id,
      'curse_ref', p_curse_ref,
      'placed_ref', v_placement.placed_ref
    ));

  return jsonb_build_object('triggered', true, 'cast', v_cast);
end;
$$;

revoke all on function public.attempt_flag_atomic(uuid, uuid, uuid, text, text, text, double precision, double precision, timestamptz, text) from public, anon, authenticated;
revoke all on function public.apply_tag_atomic(uuid, uuid, uuid, double precision, double precision) from public, anon, authenticated;
revoke all on function public.trigger_placed_curse_atomic(uuid, uuid, uuid, uuid, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.attempt_flag_atomic(uuid, uuid, uuid, text, text, text, double precision, double precision, timestamptz, text) to service_role;
grant execute on function public.apply_tag_atomic(uuid, uuid, uuid, double precision, double precision) to service_role;
grant execute on function public.trigger_placed_curse_atomic(uuid, uuid, uuid, uuid, text, text, timestamptz, jsonb) to service_role;
