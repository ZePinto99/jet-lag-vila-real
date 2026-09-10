-- Migration 0022: complete a Pilgrimage curse and append its audit event in
-- one serialized transaction. Multiple teammates may cross the target
-- geofence together; only one completion event is emitted.

create or replace function public.complete_pilgrimage_atomic(
  p_game_id uuid,
  p_curse_id uuid,
  p_player_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_curse public.active_curses%rowtype;
  v_existing public.events%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_curse_id::text || ':pilgrimage', 0));

  select * into v_curse
  from public.active_curses
  where id = p_curse_id
    and game_id = p_game_id
    and curse_ref = 'curse.pilgrimage'
  for update;

  if not found then
    select * into v_existing
    from public.events
    where game_id = p_game_id
      and type = 'curse_completed'
      and payload->>'curse_id' = p_curse_id::text
    order by created_at desc
    limit 1;
    if found then
      return jsonb_build_object('completed', true, 'already_completed', true);
    end if;
    return jsonb_build_object('error', 'pilgrimage_not_active');
  end if;

  if not exists (
    select 1
    from public.players p
    join public.teams t on t.id = p.team_id
    where p.id = p_player_id
      and p.team_id = v_curse.target_team_id
      and t.game_id = p_game_id
  ) then
    return jsonb_build_object('error', 'forbidden');
  end if;

  delete from public.active_curses where id = p_curse_id;
  insert into public.events(game_id, type, actor_player_id, payload)
  values (
    p_game_id,
    'curse_completed',
    p_player_id,
    jsonb_build_object(
      'curse_id', p_curse_id,
      'curse_ref', 'curse.pilgrimage',
      'target_team_id', v_curse.target_team_id,
      'target_landmark_ref', v_curse.params->>'target_landmark_ref'
    )
  );

  return jsonb_build_object('completed', true, 'already_completed', false);
end;
$$;

revoke all on function public.complete_pilgrimage_atomic(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.complete_pilgrimage_atomic(uuid, uuid, uuid)
  to service_role;
