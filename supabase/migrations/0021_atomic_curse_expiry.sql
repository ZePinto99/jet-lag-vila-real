-- Migration 0021: claim/delete expired curse rows and emit expiry events in
-- one transaction so concurrent client pollers cannot duplicate the log.

create or replace function public.expire_curses_atomic(
  p_game_id uuid,
  p_actor_player_id uuid
) returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.active_curses%rowtype;
  v_ids uuid[] := array[]::uuid[];
begin
  for v_row in
    delete from public.active_curses
    where game_id = p_game_id
      and expires_at is not null
      and expires_at < now()
    returning *
  loop
    insert into public.events(game_id, type, actor_player_id, payload)
    values (p_game_id, 'curse_expired', p_actor_player_id,
      jsonb_build_object(
        'curse_id', v_row.id,
        'target_team_id', v_row.target_team_id,
        'curse_ref', v_row.curse_ref
      ));
    v_ids := array_append(v_ids, v_row.id);
  end loop;
  return v_ids;
end;
$$;

revoke all on function public.expire_curses_atomic(uuid, uuid) from public, anon, authenticated;
grant execute on function public.expire_curses_atomic(uuid, uuid) to service_role;
