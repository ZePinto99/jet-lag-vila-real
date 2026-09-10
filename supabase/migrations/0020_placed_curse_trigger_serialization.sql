-- Migration 0020: serialize no-stack checks across distinct placements that
-- cast the same curse on the same target team.

create or replace function public.trigger_placed_curse_atomic(
  p_placement_id uuid,
  p_game_id uuid,
  p_intruder_player_id uuid,
  p_intruder_team_id uuid,
  p_curse_ref text,
  p_tier text,
  p_expires_at timestamptz,
  p_params jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_placement public.placed_curses%rowtype;
  v_cast boolean := false;
begin
  select * into v_placement from public.placed_curses
  where id = p_placement_id and game_id = p_game_id for update;
  if not found or not v_placement.armed then
    return jsonb_build_object('triggered', false);
  end if;

  -- A different armed landmark may cast the identical effect at the same
  -- instant. Serialize that team/effect pair before the no-stack check.
  perform pg_advisory_xact_lock(
    hashtextextended(
      p_game_id::text || ':' || p_intruder_team_id::text || ':' || p_curse_ref,
      0
    )
  );

  update public.placed_curses set
    armed = false,
    triggered_at = now(),
    triggered_by_team_id = p_intruder_team_id
  where id = p_placement_id;

  if not exists (
    select 1 from public.active_curses
    where game_id = p_game_id and target_team_id = p_intruder_team_id
      and curse_ref = p_curse_ref
  ) then
    insert into public.active_curses(
      game_id, target_team_id, curse_ref, started_at, expires_at, params
    ) values (
      p_game_id, p_intruder_team_id, p_curse_ref, now(), p_expires_at, p_params
    );
    insert into public.events(game_id, type, actor_player_id, payload)
    values (p_game_id, 'curse_cast', p_intruder_player_id,
      jsonb_build_object(
        'buyer_team_id', v_placement.owner_team_id,
        'target_team_id', p_intruder_team_id,
        'curse_ref', p_curse_ref,
        'tier', p_tier,
        'dice_total', 0,
        'dice_rolls', '[]'::jsonb,
        'expires_at', p_expires_at,
        'source', 'placed_curse'
      ));
    v_cast := true;
  end if;

  insert into public.events(game_id, type, actor_player_id, payload)
  values (p_game_id, 'placed_curse_triggered', p_intruder_player_id,
    jsonb_build_object(
      'owner_team_id', v_placement.owner_team_id,
      'target_team_id', p_intruder_team_id,
      'curse_ref', p_curse_ref,
      'placed_ref', v_placement.placed_ref
    ));

  return jsonb_build_object('triggered', true, 'cast', v_cast);
end;
$$;

revoke all on function public.trigger_placed_curse_atomic(uuid, uuid, uuid, uuid, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.trigger_placed_curse_atomic(uuid, uuid, uuid, uuid, text, text, timestamptz, jsonb) to service_role;
