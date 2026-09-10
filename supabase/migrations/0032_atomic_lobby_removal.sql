-- Migration 0032: serialize lobby removals with setup start.
--
-- Deleting a player, transferring host, and appending player_left used to be
-- separate requests after a route-level lobby read. A simultaneous start
-- could therefore remove a player from setup, or a process failure could
-- leave no host/event. Locking the game first matches start_game_setup_atomic
-- and makes the winner of the race authoritative.

create or replace function public.remove_lobby_player_atomic(
  p_game_id uuid,
  p_requester_device_id text,
  p_target_player_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_requester public.players%rowtype;
  v_target public.players%rowtype;
  v_heir public.players%rowtype;
  v_remaining int;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if v_game.status <> 'lobby' then
    return jsonb_build_object('error', 'game_not_in_lobby');
  end if;

  -- Lock the game roster in stable UUID order before resolving requester and
  -- target. Concurrent removals cannot both transfer host or emit duplicates.
  perform p.id from public.players p
  join public.teams t on t.id = p.team_id
  where t.game_id = p_game_id
  order by p.id
  for update of p;

  select p.* into v_requester from public.players p
  join public.teams t on t.id = p.team_id
  where t.game_id = p_game_id and p.device_id = p_requester_device_id;
  if not found then return jsonb_build_object('error', 'forbidden'); end if;

  select p.* into v_target from public.players p
  join public.teams t on t.id = p.team_id
  where t.game_id = p_game_id and p.id = p_target_player_id;
  if not found then return jsonb_build_object('error', 'target_not_found'); end if;
  if v_requester.id <> v_target.id and not v_requester.is_host then
    return jsonb_build_object('error', 'forbidden');
  end if;

  delete from public.players where id = v_target.id;

  if v_target.is_host then
    select p.* into v_heir from public.players p
    join public.teams t on t.id = p.team_id
    where t.game_id = p_game_id
    order by p.created_at, p.id
    limit 1
    for update of p;
    if found then
      update public.players set is_host = true where id = v_heir.id;
    end if;
  end if;

  select count(*) into v_remaining from public.players p
  join public.teams t on t.id = p.team_id
  where t.game_id = p_game_id;

  if v_remaining = 0 then
    delete from public.games where id = p_game_id;
    return jsonb_build_object(
      'removed_player_id', v_target.id,
      'game_deleted', true,
      'new_host_id', null
    );
  end if;

  insert into public.events(game_id, type, actor_player_id, payload)
  values (
    p_game_id,
    'player_left',
    case when v_requester.id = v_target.id then null else v_requester.id end,
    jsonb_build_object(
      'player_id', v_target.id,
      'team_id', v_target.team_id,
      'self', v_requester.id = v_target.id,
      'was_host', v_target.is_host,
      'new_host_id', case when v_target.is_host then v_heir.id else null end
    )
  );

  return jsonb_build_object(
    'removed_player_id', v_target.id,
    'game_deleted', false,
    'new_host_id', case when v_target.is_host then v_heir.id else null end
  );
end;
$$;

revoke all on function public.remove_lobby_player_atomic(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.remove_lobby_player_atomic(uuid, text, uuid)
  to service_role;
