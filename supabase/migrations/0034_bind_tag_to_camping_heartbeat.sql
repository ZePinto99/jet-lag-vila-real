-- Migration 0034: bind a Tag transaction to the exact camping heartbeat that
-- the route derived from its tagger GPS. A second tab cannot replace the row
-- between the route refresh and mutation with a different fresh state.

create or replace function public.apply_tags_atomic(
  p_game_id uuid,
  p_raider_player_ids uuid[],
  p_defender_player_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_respawn_target_ref text,
  p_expected_camping_heartbeat_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guard text;
  v_defender_team_id uuid;
  v_camping public.player_camping_state%rowtype;
  v_raider_id uuid;
  v_locked_count integer;
  v_distinct_count integer;
  v_applied boolean;
begin
  if p_raider_player_ids is null
     or cardinality(p_raider_player_ids) < 1
     or cardinality(p_raider_player_ids) > 8
     or nullif(p_respawn_target_ref, '') is null
     or p_expected_camping_heartbeat_at is null then
    return jsonb_build_object('error', 'invalid_tag_batch');
  end if;
  select count(distinct id) into v_distinct_count
  from unnest(p_raider_player_ids) as ids(id);
  if v_distinct_count <> cardinality(p_raider_player_ids) then
    return jsonb_build_object('error', 'duplicate_target');
  end if;

  perform 1 from public.games where id = p_game_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;

  select p.team_id into v_defender_team_id
  from public.players p
  join public.teams t on t.id = p.team_id
  where p.id = p_defender_player_id and t.game_id = p_game_id;
  if not found then return jsonb_build_object('error', 'forbidden'); end if;

  v_guard := public.gameplay_action_guard_locked(
    p_game_id, p_defender_player_id, v_defender_team_id,
    array['live','flag_found']);
  if v_guard is not null then
    return jsonb_build_object('error', v_guard);
  end if;

  select * into v_camping
  from public.player_camping_state
  where player_id = p_defender_player_id
    and game_id = p_game_id
    and team_id = v_defender_team_id
  for update;
  if not found then
    return jsonb_build_object('error', 'camping_state_missing');
  end if;
  if v_camping.last_heartbeat_at is distinct from p_expected_camping_heartbeat_at then
    return jsonb_build_object('error', 'camping_state_changed');
  end if;
  if v_camping.locked then
    return jsonb_build_object('error', 'camping_locked');
  end if;
  if v_camping.last_heartbeat_at < clock_timestamp() - interval '15 seconds' then
    return jsonb_build_object('error', 'camping_state_stale');
  end if;

  perform p.id
  from public.players p
  join public.teams t on t.id = p.team_id
  where t.game_id = p_game_id and p.id = any(p_raider_player_ids)
  order by p.id
  for update of p;
  get diagnostics v_locked_count = row_count;
  if v_locked_count <> cardinality(p_raider_player_ids) then
    return jsonb_build_object('error', 'target_state_changed');
  end if;

  select p.id into v_raider_id
  from public.players p
  where p.id = any(p_raider_player_ids)
    and (p.team_id = v_defender_team_id or p.respawning)
  order by p.id
  limit 1;
  if found then
    return jsonb_build_object(
      'error', 'target_state_changed',
      'player_id', v_raider_id
    );
  end if;

  foreach v_raider_id in array p_raider_player_ids loop
    select public.apply_tag_atomic_unchecked(
      p_game_id, v_raider_id, p_defender_player_id,
      p_lat, p_lng, p_respawn_target_ref
    ) into v_applied;
    if not v_applied then
      raise exception using
        errcode = 'P0001',
        message = 'tag_batch_invariant_failed';
    end if;
  end loop;

  return jsonb_build_object('tagged_player_ids', to_jsonb(p_raider_player_ids));
end;
$$;

revoke all on function public.apply_tags_atomic(uuid, uuid[], uuid, double precision, double precision, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_tags_atomic(uuid, uuid[], uuid, double precision, double precision, text, timestamptz)
  to service_role;
