-- A decoy can no longer erase knowledge the team has already learned. Charge
-- the attacking team a fixed 50-coin fine instead, even if this puts its
-- balance below zero. The existing lockout and two-stage respawn still apply.
--
-- This replaces only the private mutation body from 0026. The guarded
-- attempt_flag_atomic entry point from 0030 continues to serialize the game
-- and acting player before invoking it. A retried decoy attempt is rejected by
-- the respawn/landmark lockout checks before another debit can be written.
create or replace function public.attempt_flag_atomic_unchecked(
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
  v_decoy_penalty constant integer := 50;
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
    insert into public.events(game_id, type, actor_player_id, payload)
    values (p_game_id, 'flag_attempt', p_player_id, v_payload);

    -- Event first, materialized balance second, both in this transaction.
    -- This is a penalty rather than a purchase: the full fine is owed even if
    -- the team cannot presently afford it. Future earnings repay the debt.
    insert into public.events(game_id, type, actor_player_id, payload)
    values (p_game_id, 'coins_deducted', p_player_id,
      jsonb_build_object(
        'team_id', p_team_id,
        'amount', v_decoy_penalty,
        'reason', 'decoy_penalty',
        'landmark_ref', p_landmark_ref
      ));
    update public.teams set coins = coins - v_decoy_penalty
    where id = p_team_id and game_id = p_game_id;
    if not found then raise exception 'team_not_found'; end if;

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

-- The private body must remain callable only through the guarded service-role
-- RPC. CREATE OR REPLACE preserves ACLs, and this reasserts its restriction.
revoke all on function public.attempt_flag_atomic_unchecked(
  uuid, uuid, uuid, text, text, text, double precision, double precision,
  timestamptz, text, text
) from public, anon, authenticated, service_role;
