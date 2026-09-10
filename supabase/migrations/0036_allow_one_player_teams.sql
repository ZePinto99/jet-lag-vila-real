-- Migration 0036: allow equal 1v1 through 4v4 rosters.
--
-- Earlier application code supported 1v1, but the authoritative phase RPC
-- introduced in 0023 enforced the rulebook's former 2-player minimum. Keep
-- the phase transition serialized while restoring 1-player teams.

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
    if v_count < 1 or v_count > 4 or
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

revoke all on function public.start_game_setup_atomic(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.start_game_setup_atomic(uuid, uuid)
  to service_role;
