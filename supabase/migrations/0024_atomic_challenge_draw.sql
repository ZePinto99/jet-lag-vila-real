-- Migration 0024: serialize lazy challenge dealing per team.
-- Concurrent first loads previously each observed zero cards and could deal
-- more than the three-card active cap (including duplicate refs).

create or replace function public.draw_challenges_atomic(
  p_game_id uuid,
  p_team_id uuid,
  p_catalog_refs text[],
  p_target_count int default 3
) returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active_count int;
  v_needed int;
  v_ref text;
  v_inserted text[] := array[]::text[];
begin
  if p_target_count < 0 or p_target_count > 20 then
    raise exception 'invalid_challenge_target';
  end if;

  -- All coin mutations already lock teams; using the same counter row avoids
  -- lost challenge draws while remaining compatible with those transactions.
  perform 1 from public.teams
  where id = p_team_id and game_id = p_game_id
  for update;
  if not found then raise exception 'team_not_found'; end if;

  select count(*) into v_active_count
  from public.cards
  where game_id = p_game_id and team_id = p_team_id and kind = 'challenge'
    and state in ('available', 'pending');
  v_needed := greatest(0, p_target_count - v_active_count);

  for v_ref in
    select candidate.ref
    from unnest(p_catalog_refs) candidate(ref)
    where not exists (
      select 1 from public.cards existing
      where existing.game_id = p_game_id
        and existing.team_id = p_team_id
        and existing.kind = 'challenge'
        and existing.ref = candidate.ref
    )
    order by random()
    limit v_needed
  loop
    insert into public.cards(game_id, team_id, kind, ref, state, payload)
    values (p_game_id, p_team_id, 'challenge', v_ref, 'available', '{}'::jsonb);
    v_inserted := array_append(v_inserted, v_ref);
  end loop;

  return v_inserted;
end;
$$;

revoke all on function public.draw_challenges_atomic(uuid, uuid, text[], int) from public, anon, authenticated;
grant execute on function public.draw_challenges_atomic(uuid, uuid, text[], int) to service_role;
