-- Migration 0040: serialize flag-attempt reaction signals and rate-limit
-- feints. The route performs the fresh 28 m GPS check; this transaction binds
-- the event to live player/candidate state and makes cooldowns race-safe.

create or replace function public.record_flag_attempt_start_atomic(
  p_game_id uuid,
  p_player_id uuid,
  p_attacking_team_id uuid,
  p_defending_team_id uuid,
  p_landmark_ref text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_player public.players%rowtype;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_game_id::text || ':attempt-start:' || p_attacking_team_id::text, 0)
  );

  select * into v_game from public.games where id = p_game_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if v_game.status <> 'live' then
    return jsonb_build_object('error', 'game_not_in_live');
  end if;

  select p.* into v_player
  from public.players p
  join public.teams t on t.id = p.team_id
  where p.id = p_player_id
    and p.team_id = p_attacking_team_id
    and t.game_id = p_game_id
  for update of p;
  if not found then return jsonb_build_object('error', 'forbidden'); end if;
  if v_player.respawning then
    return jsonb_build_object('error', 'player_respawning');
  end if;
  if not exists (
    select 1 from public.landmarks
    where game_id = p_game_id
      and team_id = p_defending_team_id
      and ref = p_landmark_ref
      and kind in ('flag_real', 'flag_decoy', 'flag_empty')
  ) then
    return jsonb_build_object('error', 'invalid_landmark');
  end if;

  if exists (
    select 1 from public.events
    where game_id = p_game_id
      and type = 'flag_attempt_started'
      and payload->>'team_id' = p_attacking_team_id::text
      and payload->>'landmark_ref' = p_landmark_ref
      and created_at >= now() - interval '60 seconds'
  ) then
    return jsonb_build_object('error', 'landmark_attempt_cooldown');
  end if;
  if exists (
    select 1 from public.events
    where game_id = p_game_id
      and type = 'flag_attempt_started'
      and payload->>'team_id' = p_attacking_team_id::text
      and created_at >= now() - interval '15 seconds'
  ) then
    return jsonb_build_object('error', 'team_attempt_cooldown');
  end if;

  insert into public.events(game_id, type, actor_player_id, payload)
  values (
    p_game_id,
    'flag_attempt_started',
    p_player_id,
    jsonb_build_object(
      'landmark_ref', p_landmark_ref,
      'team_id', p_attacking_team_id,
      'defending_team_id', p_defending_team_id,
      'player_id', p_player_id
    )
  );
  return jsonb_build_object('recorded', true);
end;
$$;

revoke all on function public.record_flag_attempt_start_atomic(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_flag_attempt_start_atomic(uuid, uuid, uuid, uuid, text)
  to service_role;
