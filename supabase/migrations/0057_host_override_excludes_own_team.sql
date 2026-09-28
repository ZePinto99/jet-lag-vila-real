-- Migration 0057 (finding L1): the host cannot release themselves, or their own
-- team, from a respawn.
--
-- 0055 added the host override with no restriction on the target, so a host who
-- was tagged could clear their OWN respawn — instantly, repeatably, with no walk
-- and no cooldown. Measured before this fix: three consecutive tag → self-release
-- cycles all returned HTTP 200 and freed the player, and `buy-intel` succeeded
-- immediately afterwards.
--
-- Why that is serious rather than cosmetic: the host is simply whoever created
-- the game, so in a 1v1 or 2v2 they are an ordinary raider. The override made
-- exactly one player immune to the only physical mechanic in the game. It also
-- contradicted both stated intents — RULEBOOK §6 ("the escape hatch exists for a
-- broken phone, not as a shortcut") and 0055's own safety argument that "waiting
-- is strictly worse than walking", which self-release makes false.
--
-- The fix excludes the host's whole TEAM, not merely the host's own row.
-- Excluding just `p_target_player_id = p_host_player_id` would leave a 2v2 host
-- able to free their teammate on demand, which is the same exploit one step
-- removed: the pair could raid recklessly and cancel every tag between them.
--
-- A tagged player on the host's own team is not left stranded — the 10-minute
-- grace sweep (sweep_stuck_respawns, 0055) still covers them, and 0056 makes sure
-- a weather pause is not charged against it. What they lose is only the instant
-- exit, which is what made it an exploit.
--
-- Deliberately NOT done: no restriction based on how long the player has been
-- respawning. A "host may only release after N minutes" rule would make the
-- override useless for its actual purpose (a phone that will not get a fix at
-- all) while still permitting the exploit after the wait.

create or replace function public.host_clear_respawn_atomic(
  p_game_id uuid,
  p_host_player_id uuid,
  p_target_player_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_host public.players%rowtype; v_target public.players%rowtype;
begin
  -- The host must belong to THIS game; is_host alone is not sufficient
  -- authority, since a host of another game must not reach in here.
  select p.* into v_host from public.players p
  join public.teams t on t.id = p.team_id
  where p.id = p_host_player_id and t.game_id = p_game_id;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if not coalesce(v_host.is_host, false) then
    return jsonb_build_object('error', 'not_host');
  end if;

  select p.* into v_target from public.players p
  join public.teams t on t.id = p.team_id
  where p.id = p_target_player_id and t.game_id = p_game_id
  for update of p;
  if not found then return jsonb_build_object('error', 'target_not_found'); end if;

  -- L1: the override is a favour you do for the OTHER side, never for yourself.
  -- Checked before `target_not_respawning` so the refusal reason is the honest
  -- one whatever state the target is in.
  if v_target.team_id = v_host.team_id then
    return jsonb_build_object('error', 'cannot_clear_own_team');
  end if;

  if not v_target.respawning then
    return jsonb_build_object('error', 'target_not_respawning');
  end if;

  update public.players set
    respawning = false, respawn_arrived = false,
    respawn_target_ref = null, respawning_since = null
  where id = p_target_player_id returning * into v_target;

  insert into public.events(game_id, type, actor_player_id, payload)
  values (p_game_id, 'player_respawn_host_cleared', p_host_player_id,
    jsonb_build_object(
      'player_id', p_target_player_id,
      'team_id', v_target.team_id,
      'host_player_id', p_host_player_id
    ));

  return jsonb_build_object('player', to_jsonb(v_target));
end;
$$;

revoke all on function public.host_clear_respawn_atomic(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.host_clear_respawn_atomic(uuid, uuid, uuid) to service_role;
