-- Migration 0023: make terminal/phase transitions and the peer-review
-- challenge lifecycle transaction-safe.
--
-- These operations previously updated their materialized row and appended the
-- corresponding event in separate requests. A process interruption or a
-- concurrent accept/reject could therefore leave state without its ledger
-- event. Each function below locks the authoritative row and commits state and
-- append-only events in one transaction. All functions are service-role only.

create or replace function public.complete_flag_run_atomic(
  p_game_id uuid,
  p_carrier_player_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_player public.players%rowtype;
  v_winner_team_id uuid;
begin
  select * into v_game
  from public.games
  where id = p_game_id
  for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;

  -- Successful retries and concurrent callers must return the winner already
  -- committed with the terminal event, never infer it from the current caller.
  if v_game.status = 'finished' then
    select nullif(payload->>'winner_team_id', '')::uuid
      into v_winner_team_id
    from public.events
    where game_id = p_game_id and type = 'game_won'
    order by created_at desc, id desc
    limit 1;
    if v_winner_team_id is null then
      return jsonb_build_object('error', 'terminal_result_missing');
    end if;
    return jsonb_build_object(
      'game', to_jsonb(v_game),
      'winner_team_id', v_winner_team_id
    );
  end if;

  if v_game.status <> 'flag_found' then
    return jsonb_build_object('error', 'game_not_in_flag_found');
  end if;

  select p.* into v_player
  from public.players p
  join public.teams t on t.id = p.team_id
  where p.id = p_carrier_player_id and t.game_id = p_game_id
  for update of p;
  if not found or not v_player.flag_carrier then
    return jsonb_build_object('error', 'not_flag_carrier');
  end if;
  if v_player.respawning then
    return jsonb_build_object('error', 'player_respawning');
  end if;

  update public.games
  set status = 'finished', ended_at = now()
  where id = p_game_id
  returning * into v_game;

  insert into public.events(game_id, type, actor_player_id, payload)
  values (
    p_game_id,
    'game_won',
    v_player.id,
    jsonb_build_object(
      'winner_team_id', v_player.team_id,
      'flag_carrier_player_id', v_player.id,
      'reason', 'flag_returned'
    )
  );

  return jsonb_build_object(
    'game', to_jsonb(v_game),
    'winner_team_id', v_player.team_id
  );
end;
$$;

create or replace function public.submit_challenge_review_atomic(
  p_game_id uuid,
  p_team_id uuid,
  p_card_id uuid,
  p_actor_player_id uuid,
  p_card_payload jsonb,
  p_event_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card public.cards%rowtype;
begin
  select * into v_card
  from public.cards
  where id = p_card_id
    and game_id = p_game_id
    and team_id = p_team_id
    and kind = 'challenge'
  for update;
  if not found or v_card.state <> 'available' then
    return jsonb_build_object('error', 'challenge_not_available');
  end if;

  update public.cards
  set state = 'pending', payload = p_card_payload, updated_at = now()
  where id = v_card.id
  returning * into v_card;

  insert into public.events(game_id, type, actor_player_id, payload)
  values (p_game_id, 'challenge_submitted', p_actor_player_id, p_event_payload);

  return jsonb_build_object('card', to_jsonb(v_card));
end;
$$;

create or replace function public.reject_challenge_review_atomic(
  p_game_id uuid,
  p_card_id uuid,
  p_reviewer_player_id uuid,
  p_reviewer_team_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card public.cards%rowtype;
begin
  select * into v_card
  from public.cards
  where id = p_card_id and game_id = p_game_id and kind = 'challenge'
  for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if v_card.state <> 'pending' then
    return jsonb_build_object('error', 'not_pending');
  end if;
  if v_card.team_id = p_reviewer_team_id then
    return jsonb_build_object('error', 'cannot_review_own');
  end if;

  update public.cards
  set state = 'available',
      payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
        'review_status', 'rejected',
        'rejected_at', now(),
        'rejected_by_team_id', p_reviewer_team_id
      ),
      updated_at = now()
  where id = v_card.id
  returning * into v_card;

  insert into public.events(game_id, type, actor_player_id, payload)
  values (
    p_game_id,
    'challenge_rejected',
    p_reviewer_player_id,
    jsonb_build_object(
      'team_id', v_card.team_id,
      'reviewing_team_id', p_reviewer_team_id,
      'challenge_ref', v_card.ref,
      'card_id', v_card.id
    )
  );

  return jsonb_build_object('card', to_jsonb(v_card));
end;
$$;

create or replace function public.start_game_setup_atomic(
  p_game_id uuid,
  p_actor_player_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_team record;
  v_team_total int;
  v_count int;
  v_first_count int := null;
  v_all_ready boolean;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if v_game.status <> 'lobby' then
    return jsonb_build_object('game', to_jsonb(v_game));
  end if;

  select count(*) into v_team_total from public.teams where game_id = p_game_id;
  if v_team_total <> 2 then
    return jsonb_build_object('error', 'invalid_team_sizes');
  end if;

  for v_team in select id from public.teams where game_id = p_game_id order by id
  loop
    select count(*), coalesce(bool_and(ready), false)
      into v_count, v_all_ready
    from public.players where team_id = v_team.id;
    if not v_all_ready then return jsonb_build_object('error', 'not_all_ready'); end if;
    if v_count < 2 or v_count > 4 or
       (v_first_count is not null and v_count <> v_first_count) then
      return jsonb_build_object('error', 'invalid_team_sizes');
    end if;
    v_first_count := v_count;
  end loop;

  update public.games set status = 'setup' where id = p_game_id
  returning * into v_game;
  insert into public.events(game_id, type, actor_player_id, payload)
  values (p_game_id, 'game_started', p_actor_player_id, '{}'::jsonb);
  return jsonb_build_object('game', to_jsonb(v_game));
end;
$$;

create or replace function public.submit_flag_setup_atomic(
  p_game_id uuid,
  p_team_id uuid,
  p_actor_player_id uuid,
  p_object_path text,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_real_landmark_id uuid;
  v_completed_teams int;
  v_both_done boolean := false;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if v_game.status <> 'setup' then
    return jsonb_build_object('error', 'game_not_in_setup');
  end if;
  if not exists (
    select 1 from public.teams where id = p_team_id and game_id = p_game_id
  ) then return jsonb_build_object('error', 'forbidden'); end if;
  if exists (
    select 1 from public.landmarks
    where game_id = p_game_id and team_id = p_team_id
      and kind in ('flag_real', 'flag_decoy', 'flag_empty')
  ) then return jsonb_build_object('error', 'already_submitted'); end if;

  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) <> 5 or
     (select count(distinct x.ref) from jsonb_to_recordset(p_rows)
       as x(ref text, lat double precision, lng double precision, kind text)) <> 5 or
     (select count(*) from jsonb_to_recordset(p_rows)
       as x(ref text, lat double precision, lng double precision, kind text)
       where kind = 'flag_real') <> 1 or
     (select count(*) from jsonb_to_recordset(p_rows)
       as x(ref text, lat double precision, lng double precision, kind text)
       where kind = 'flag_decoy') <> 2 or
     (select count(*) from jsonb_to_recordset(p_rows)
       as x(ref text, lat double precision, lng double precision, kind text)
       where kind = 'flag_empty') <> 2 then
    return jsonb_build_object('error', 'invalid_assignments');
  end if;

  insert into public.landmarks(game_id, ref, lat, lng, team_id, kind, hardened)
  select p_game_id, x.ref, x.lat, x.lng, p_team_id, x.kind, false
  from jsonb_to_recordset(p_rows)
    as x(ref text, lat double precision, lng double precision, kind text);

  select id into v_real_landmark_id
  from public.landmarks
  where game_id = p_game_id and team_id = p_team_id and kind = 'flag_real';

  insert into public.flag_surroundings(
    game_id, team_id, landmark_id, uploaded_by, object_path
  ) values (
    p_game_id, p_team_id, v_real_landmark_id, p_actor_player_id, p_object_path
  );

  insert into public.events(game_id, type, actor_player_id, payload)
  values (
    p_game_id, 'flags_assigned', p_actor_player_id,
    jsonb_build_object('team_id', p_team_id)
  );

  select count(*) into v_completed_teams
  from (
    select team_id
    from public.landmarks
    where game_id = p_game_id
      and kind in ('flag_real', 'flag_decoy', 'flag_empty')
    group by team_id
    having count(*) = 5
  ) completed;
  v_both_done := v_completed_teams = 2;

  if v_both_done then
    update public.games
    set status = 'live', started_at = now()
    where id = p_game_id
    returning * into v_game;
    insert into public.events(game_id, type, actor_player_id, payload)
    values (p_game_id, 'game_live', p_actor_player_id, '{}'::jsonb);
  end if;

  return jsonb_build_object(
    'game', to_jsonb(v_game),
    'both_teams_done', v_both_done
  );
end;
$$;

revoke all on function public.complete_flag_run_atomic(uuid, uuid) from public, anon, authenticated;
revoke all on function public.submit_challenge_review_atomic(uuid, uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.reject_challenge_review_atomic(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.start_game_setup_atomic(uuid, uuid) from public, anon, authenticated;
revoke all on function public.submit_flag_setup_atomic(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.complete_flag_run_atomic(uuid, uuid) to service_role;
grant execute on function public.submit_challenge_review_atomic(uuid, uuid, uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.reject_challenge_review_atomic(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.start_game_setup_atomic(uuid, uuid) to service_role;
grant execute on function public.submit_flag_setup_atomic(uuid, uuid, uuid, text, jsonb) to service_role;
