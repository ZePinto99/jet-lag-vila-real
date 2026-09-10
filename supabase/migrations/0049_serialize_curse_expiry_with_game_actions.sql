-- Migration 0049: use the same game-row -> same-effect advisory-lock order
-- for background expiry and gameplay casts.
--
-- A normal or placed cast enters through an authoritative wrapper that locks
-- games first, then calls expire_active_curse_ref_locked. The 0046 bulk expiry
-- function entered the helper directly. Under a simultaneous same-ref recast,
-- that inverse order could deadlock while the expiry event's game foreign key
-- waited on the cast transaction. Lock the game before taking any effect lock.

create or replace function public.expire_curses_atomic(
  p_game_id uuid,
  p_actor_player_id uuid
) returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate record;
  v_expired uuid[];
  v_ids uuid[] := array[]::uuid[];
begin
  perform 1 from public.games where id = p_game_id for update;
  if not found then return v_ids; end if;

  -- Snapshot candidates after acquiring the same outer lock used by casts.
  -- Each helper call then serializes expiry/no-stack/insert for one effect.
  for v_candidate in
    select game_id, target_team_id, curse_ref
    from public.active_curses
    where game_id = p_game_id
      and expires_at is not null
      and expires_at <= now()
    order by target_team_id, curse_ref
  loop
    v_expired := public.expire_active_curse_ref_locked(
      v_candidate.game_id,
      v_candidate.target_team_id,
      v_candidate.curse_ref,
      p_actor_player_id
    );
    v_ids := v_ids || v_expired;
  end loop;
  return v_ids;
end;
$$;

revoke all on function public.expire_curses_atomic(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.expire_curses_atomic(uuid, uuid) to service_role;
