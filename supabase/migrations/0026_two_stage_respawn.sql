-- Migration 0026: tagged raiders must visit the neutral nearest the tag and
-- remain immune until they leave it. The target/stage live on players so every
-- teammate/reconnect sees the same server-authoritative instruction.

alter table public.players
  add column if not exists respawn_target_ref text,
  add column if not exists respawn_arrived boolean not null default false;

drop function if exists public.apply_tag_atomic(uuid, uuid, uuid, double precision, double precision);
create function public.apply_tag_atomic(
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
  v_victim public.cards%rowtype;
begin
  select * into v_raider from public.players
  where id = p_raider_player_id for update;
  if not found or v_raider.respawning then return false; end if;
  if nullif(p_respawn_target_ref, '') is null then
    raise exception 'respawn_target_required';
  end if;
  insert into public.tags(game_id, raider_player_id, defender_player_id, lat, lng)
  values (p_game_id, p_raider_player_id, p_defender_player_id, p_lat, p_lng);
  update public.players set
    respawning = true,
    respawn_target_ref = p_respawn_target_ref,
    respawn_arrived = false
  where id = p_raider_player_id;
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
      'lat', p_lat, 'lng', p_lng,
      'respawn_target_ref', p_respawn_target_ref
    ));
  insert into public.events(game_id, type, actor_player_id, payload)
  values (p_game_id, 'player_respawning_set', p_defender_player_id,
    jsonb_build_object(
      'player_id', p_raider_player_id,
      'team_id', v_raider.team_id,
      'respawn_target_ref', p_respawn_target_ref
    ));
  return true;
end;
$$;

drop function if exists public.attempt_flag_atomic(
  uuid, uuid, uuid, text, text, text, double precision, double precision,
  timestamptz, text
);
create function public.attempt_flag_atomic(
  p_game_id uuid,
  p_player_id uuid,
  p_team_id uuid,
  p_landmark_ref text,
  p_result text,
  p_photo_url text,
  p_lat double precision,
  p_lng double precision,
  p_taken_at timestamptz,
  p_answer text default null,
  p_respawn_target_ref text default null
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
  if v_game.status <> 'live' then return jsonb_build_object('error', 'game_not_in_live'); end if;
  select * into v_player from public.players where id = p_player_id for update;
  if not found or v_player.team_id <> p_team_id then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if v_player.respawning then return jsonb_build_object('error', 'player_respawning'); end if;
  if p_result in ('decoy', 'empty') then
    select * into v_lockout from public.events
    where game_id = p_game_id and type = 'flag_attempt'
      and payload->>'team_id' = p_team_id::text
      and payload->>'landmark_ref' = p_landmark_ref
      and payload->>'result' in ('decoy', 'empty')
      and created_at >= now() - interval '15 minutes'
    order by created_at desc limit 1;
    if found then return jsonb_build_object(
      'error', 'landmark_locked_out',
      'unlocks_at', v_lockout.created_at + interval '15 minutes'
    ); end if;
  end if;
  insert into public.photos(game_id, player_id, url, lat, lng, taken_at, kind)
  values (p_game_id, p_player_id, p_photo_url, p_lat, p_lng, p_taken_at, 'flag_attempt');
  v_payload := jsonb_build_object(
    'landmark_ref', p_landmark_ref, 'result', p_result,
    'team_id', p_team_id, 'photo_url', p_photo_url
  );
  if nullif(p_answer, '') is not null then
    v_payload := v_payload || jsonb_build_object('answer', p_answer);
  end if;
  if p_result = 'real' then
    update public.players set flag_carrier = true where id = p_player_id;
    update public.games set status = 'flag_found' where id = p_game_id returning * into v_game;
    insert into public.events(game_id, type, actor_player_id, payload)
    values (p_game_id, 'flag_attempt', p_player_id, v_payload);
    insert into public.events(game_id, type, actor_player_id, payload)
    values (p_game_id, 'flag_found', p_player_id,
      jsonb_build_object('player_id', p_player_id, 'landmark_ref', p_landmark_ref, 'team_id', p_team_id));
  elsif p_result = 'decoy' then
    if nullif(p_respawn_target_ref, '') is null then raise exception 'respawn_target_required'; end if;
    update public.cards set state = 'expired', updated_at = now()
    where game_id = p_game_id and team_id = p_team_id
      and kind = 'intel' and state = 'in_hand';
    insert into public.events(game_id, type, actor_player_id, payload)
    values (p_game_id, 'flag_attempt', p_player_id, v_payload);
    update public.players set
      respawning = true,
      respawn_target_ref = p_respawn_target_ref,
      respawn_arrived = false
    where id = p_player_id;
    insert into public.events(game_id, type, actor_player_id, payload)
    values (p_game_id, 'player_respawning_set', p_player_id,
      jsonb_build_object(
        'player_id', p_player_id, 'team_id', p_team_id,
        'reason', 'decoy', 'respawn_target_ref', p_respawn_target_ref
      ));
  elsif p_result = 'empty' then
    insert into public.events(game_id, type, actor_player_id, payload)
    values (p_game_id, 'flag_attempt', p_player_id, v_payload);
  else raise exception 'invalid_flag_result';
  end if;
  return jsonb_build_object('game', to_jsonb(v_game));
end;
$$;

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
      respawning = false, respawn_arrived = false, respawn_target_ref = null
    where id = p_player_id returning * into v_player;
    insert into public.events(game_id, type, actor_player_id, payload)
    values (p_game_id, 'player_respawning_cleared', p_player_id,
      jsonb_build_object('player_id', p_player_id, 'at_neutral_ref', p_expected_target_ref));
  else return jsonb_build_object('error', 'invalid_respawn_stage');
  end if;
  return jsonb_build_object('player', to_jsonb(v_player));
end;
$$;

revoke all on function public.apply_tag_atomic(uuid, uuid, uuid, double precision, double precision, text) from public, anon, authenticated;
revoke all on function public.attempt_flag_atomic(uuid, uuid, uuid, text, text, text, double precision, double precision, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.advance_respawn_atomic(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.apply_tag_atomic(uuid, uuid, uuid, double precision, double precision, text) to service_role;
grant execute on function public.attempt_flag_atomic(uuid, uuid, uuid, text, text, text, double precision, double precision, timestamptz, text, text) to service_role;
grant execute on function public.advance_respawn_atomic(uuid, uuid, text, text) to service_role;
