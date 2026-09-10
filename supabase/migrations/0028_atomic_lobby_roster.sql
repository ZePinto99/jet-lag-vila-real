-- Serialize lobby joins/switches on the game row. Trigger-level counts share
-- each INSERT statement snapshot and cannot enforce capacity under a burst.
create or replace function public.join_player_atomic(
  p_game_id uuid, p_team_id uuid, p_display_name text, p_device_id text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_game public.games%rowtype; v_count int; v_existing public.players%rowtype;
  v_player public.players%rowtype;
begin
  select * into v_game from public.games where id=p_game_id for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if v_game.status<>'lobby' then return jsonb_build_object('error','game_not_in_lobby'); end if;
  if not exists(select 1 from public.teams where id=p_team_id and game_id=p_game_id) then
    return jsonb_build_object('error','team_lookup_failed'); end if;
  select p.* into v_existing from public.players p join public.teams t on t.id=p.team_id
  where t.game_id=p_game_id and p.device_id=p_device_id limit 1;
  if found then return jsonb_build_object('player',to_jsonb(v_existing),'existing',true); end if;
  select count(*) into v_count from public.players where team_id=p_team_id;
  if v_count>=4 then return jsonb_build_object('error','team_full'); end if;
  insert into public.players(team_id,display_name,device_id,role,ready,flag_carrier)
  values(p_team_id,p_display_name,p_device_id,'player',false,false) returning * into v_player;
  insert into public.events(game_id,type,actor_player_id,payload)
  values(p_game_id,'player_joined',v_player.id,
    jsonb_build_object('player_id',v_player.id,'team_id',p_team_id));
  return jsonb_build_object('player',to_jsonb(v_player),'existing',false);
end; $$;

create or replace function public.switch_player_team_atomic(
  p_game_id uuid, p_player_id uuid, p_device_id text, p_target_team_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_game public.games%rowtype; v_player public.players%rowtype; v_count int;
begin
  select * into v_game from public.games where id=p_game_id for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if v_game.status<>'lobby' then return jsonb_build_object('error','game_not_in_lobby'); end if;
  select p.* into v_player from public.players p join public.teams t on t.id=p.team_id
  where p.id=p_player_id and t.game_id=p_game_id for update of p;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if v_player.device_id<>p_device_id then return jsonb_build_object('error','forbidden'); end if;
  if v_player.ready then return jsonb_build_object('error','player_ready'); end if;
  if not exists(select 1 from public.teams where id=p_target_team_id and game_id=p_game_id) then
    return jsonb_build_object('error','team_lookup_failed'); end if;
  if v_player.team_id=p_target_team_id then return jsonb_build_object('player',to_jsonb(v_player)); end if;
  select count(*) into v_count from public.players where team_id=p_target_team_id;
  if v_count>=4 then return jsonb_build_object('error','team_full'); end if;
  update public.players set team_id=p_target_team_id where id=p_player_id returning * into v_player;
  return jsonb_build_object('player',to_jsonb(v_player));
end; $$;

revoke all on function public.join_player_atomic(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.switch_player_team_atomic(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.join_player_atomic(uuid,uuid,text,text) to service_role;
grant execute on function public.switch_player_team_atomic(uuid,uuid,text,uuid) to service_role;
