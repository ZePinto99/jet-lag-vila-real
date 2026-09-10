-- Migration 0030: transaction-authoritative gameplay guards.
--
-- Route handlers still perform fast validation for useful HTTP errors, but a
-- route-level read can race a weather pause, terminal transition, tag/decoy
-- respawn, Full Stop, or Pilgrimage cast. Every gameplay RPC below now takes
-- the game row first, then the acting player, before touching team/card rows.
-- This stable lock order makes the database recheck the authoritative state
-- in the same transaction as the mutation.

create or replace function public.gameplay_action_guard_locked(
  p_game_id uuid,
  p_actor_player_id uuid,
  p_expected_team_id uuid,
  p_allowed_statuses text[],
  p_check_respawning boolean default true,
  p_check_action_lock boolean default true
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_started_at timestamptz;
  v_duration_minutes int;
  v_player public.players%rowtype;
begin
  -- Callers acquire games FOR UPDATE before invoking this helper. Reading the
  -- row here documents and verifies that invariant without changing lock
  -- order when a wrapper is retried after waiting for pause/finish to commit.
  select
    status::text,
    started_at,
    case
      when coalesce(config->>'duration_minutes', '') ~ '^[0-9]+$'
        then greatest(1, (config->>'duration_minutes')::int)
      else 180
    end
  into v_status, v_started_at, v_duration_minutes
  from public.games where id = p_game_id;
  if not found then return 'not_found'; end if;
  if not (v_status = any(p_allowed_statuses)) then
    return 'game_not_in_play';
  end if;
  -- The nominal deadline is itself authoritative. A slow/offline client must
  -- call end-by-timeout, not squeeze in another mutation after the clock has
  -- expired but before the terminal transition has been persisted. Weather
  -- resume shifts started_at, so legitimate paused time remains excluded.
  if v_started_at is not null and
     clock_timestamp() >= v_started_at + make_interval(mins => v_duration_minutes) then
    return 'game_expired';
  end if;

  select p.* into v_player
  from public.players p
  join public.teams t on t.id = p.team_id
  where p.id = p_actor_player_id and t.game_id = p_game_id
  for update of p;
  if not found or (
    p_expected_team_id is not null and
    v_player.team_id is distinct from p_expected_team_id
  ) then
    return 'forbidden';
  end if;

  if p_check_respawning and v_player.respawning then
    return 'player_respawning';
  end if;
  if p_check_action_lock and exists (
    select 1 from public.active_curses
    where game_id = p_game_id
      and target_team_id = v_player.team_id
      and curse_ref in ('curse.full-stop', 'curse.pilgrimage')
      and (expires_at is null or expires_at > now())
  ) then
    return 'actions_locked';
  end if;
  return null;
end;
$$;

-- Preserve the already-tested mutation bodies behind private names. The new
-- public service-role entry points below own phase/actor serialization.
alter function public.purchase_intel_atomic(uuid, uuid, uuid, text, int, jsonb)
  rename to purchase_intel_atomic_unchecked;
alter function public.place_curse_atomic(uuid, uuid, text, text, text, uuid, int)
  rename to place_curse_atomic_unchecked;
alter function public.buy_curse_atomic(uuid, uuid, uuid, uuid, int, int, int, int[], text, text, timestamptz, jsonb)
  rename to buy_curse_atomic_unchecked;
alter function public.award_challenge_atomic(uuid, uuid, uuid, text, int, uuid, uuid, text[])
  rename to award_challenge_atomic_unchecked;
alter function public.submit_challenge_review_atomic(uuid, uuid, uuid, uuid, jsonb, jsonb)
  rename to submit_challenge_review_atomic_unchecked;
alter function public.reject_challenge_review_atomic(uuid, uuid, uuid, uuid)
  rename to reject_challenge_review_atomic_unchecked;
alter function public.attempt_flag_atomic(uuid, uuid, uuid, text, text, text, double precision, double precision, timestamptz, text, text)
  rename to attempt_flag_atomic_unchecked;
alter function public.apply_tag_atomic(uuid, uuid, uuid, double precision, double precision, text)
  rename to apply_tag_atomic_unchecked;
alter function public.complete_flag_run_atomic(uuid, uuid)
  rename to complete_flag_run_atomic_unchecked;
alter function public.trigger_placed_curse_atomic(uuid, uuid, uuid, uuid, text, text, timestamptz, jsonb)
  rename to trigger_placed_curse_atomic_unchecked;
alter function public.harden_flag_atomic(uuid, uuid, uuid, text, uuid, int)
  rename to harden_flag_atomic_leaky;

create function public.purchase_intel_atomic(
  p_game_id uuid, p_team_id uuid, p_actor_player_id uuid,
  p_intel_ref text, p_cost int, p_answer jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_guard text; v_result jsonb;
begin
  perform 1 from public.games where id = p_game_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  v_guard := public.gameplay_action_guard_locked(
    p_game_id, p_actor_player_id, p_team_id, array['live','flag_found']);
  if v_guard is not null then return jsonb_build_object('error', v_guard); end if;
  select public.purchase_intel_atomic_unchecked(
    p_game_id, p_team_id, p_actor_player_id, p_intel_ref, p_cost, p_answer
  ) into v_result;
  return v_result;
end;
$$;

create function public.place_curse_atomic(
  p_game_id uuid, p_team_id uuid, p_landmark_ref text, p_placed_ref text,
  p_curse_ref text, p_actor_player_id uuid, p_cost int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_guard text; v_result jsonb;
begin
  perform 1 from public.games where id = p_game_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  v_guard := public.gameplay_action_guard_locked(
    p_game_id, p_actor_player_id, p_team_id, array['setup','live']);
  if v_guard is not null then return jsonb_build_object('error', v_guard); end if;
  select public.place_curse_atomic_unchecked(
    p_game_id, p_team_id, p_landmark_ref, p_placed_ref, p_curse_ref,
    p_actor_player_id, p_cost
  ) into v_result;
  return v_result;
end;
$$;

create function public.buy_curse_atomic(
  p_game_id uuid, p_buyer_team_id uuid, p_target_team_id uuid,
  p_actor_player_id uuid, p_cost int, p_num_dice int, p_dice_total int,
  p_dice_rolls int[], p_curse_ref text, p_tier text,
  p_expires_at timestamptz, p_params jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_guard text; v_result jsonb;
begin
  perform 1 from public.games where id = p_game_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  v_guard := public.gameplay_action_guard_locked(
    p_game_id, p_actor_player_id, p_buyer_team_id, array['live','flag_found']);
  if v_guard is not null then return jsonb_build_object('error', v_guard); end if;
  select public.buy_curse_atomic_unchecked(
    p_game_id, p_buyer_team_id, p_target_team_id, p_actor_player_id, p_cost,
    p_num_dice, p_dice_total, p_dice_rolls, p_curse_ref, p_tier,
    p_expires_at, p_params
  ) into v_result;
  return v_result;
end;
$$;

-- Harden is reimplemented rather than delegated because the old append-only
-- event identified the real landmark. The public event now contains only the
-- owning team; that team's realtime hook re-fetches its scoped live-state.
create function public.harden_flag_atomic(
  p_game_id uuid, p_team_id uuid, p_landmark_id uuid,
  p_landmark_ref text, p_actor_player_id uuid, p_cost int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_guard text; v_coins int;
begin
  perform 1 from public.games where id = p_game_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  v_guard := public.gameplay_action_guard_locked(
    p_game_id, p_actor_player_id, p_team_id, array['live']);
  if v_guard is not null then return jsonb_build_object('error', v_guard); end if;

  select coins into v_coins from public.teams
  where id = p_team_id and game_id = p_game_id for update;
  if not found then return jsonb_build_object('error', 'team_not_found'); end if;
  if exists (
    select 1 from public.landmarks
    where game_id = p_game_id and team_id = p_team_id and hardened
  ) then
    return jsonb_build_object('error', 'already_hardened', 'coins', v_coins);
  end if;
  if not exists (
    select 1 from public.landmarks
    where id = p_landmark_id and game_id = p_game_id
      and team_id = p_team_id and kind = 'flag_real'
    for update
  ) then
    return jsonb_build_object('error', 'not_real_flag', 'coins', v_coins);
  end if;
  if v_coins < p_cost then
    return jsonb_build_object('error', 'insufficient_coins', 'coins', v_coins);
  end if;

  insert into public.events(game_id, type, actor_player_id, payload)
  values (p_game_id, 'coins_deducted', p_actor_player_id,
    jsonb_build_object('team_id', p_team_id, 'amount', p_cost, 'reason', 'harden_flag'));
  update public.teams set coins = coins - p_cost where id = p_team_id
  returning coins into v_coins;
  update public.landmarks set hardened = true where id = p_landmark_id;
  insert into public.events(game_id, type, actor_player_id, payload)
  values (p_game_id, 'flag_hardened', p_actor_player_id,
    jsonb_build_object('team_id', p_team_id));
  return jsonb_build_object('team_coins', v_coins);
end;
$$;

-- The completion actor recorded on a challenge may be the submitting player,
-- while the player making a peer-accept request belongs to the other team.
-- The guarded entry point therefore carries both identities explicitly.
create function public.award_challenge_atomic_guarded(
  p_game_id uuid, p_team_id uuid, p_card_id uuid, p_expected_state text,
  p_reward_coins int, p_actor_player_id uuid, p_requesting_player_id uuid,
  p_reviewed_by_team_id uuid default null,
  p_replacement_refs text[] default array[]::text[]
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_guard text; v_requesting_team_id uuid; v_result jsonb;
begin
  perform 1 from public.games where id = p_game_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  select p.team_id into v_requesting_team_id from public.players p
  join public.teams t on t.id = p.team_id
  where p.id = p_requesting_player_id and t.game_id = p_game_id;
  if not found then return jsonb_build_object('error', 'forbidden'); end if;
  v_guard := public.gameplay_action_guard_locked(
    p_game_id, p_requesting_player_id, v_requesting_team_id,
    array['live','flag_found']);
  if v_guard is not null then return jsonb_build_object('error', v_guard); end if;
  select public.award_challenge_atomic_unchecked(
    p_game_id, p_team_id, p_card_id, p_expected_state, p_reward_coins,
    p_actor_player_id, p_reviewed_by_team_id, p_replacement_refs
  ) into v_result;
  return v_result;
end;
$$;

create function public.submit_challenge_review_atomic(
  p_game_id uuid, p_team_id uuid, p_card_id uuid, p_actor_player_id uuid,
  p_card_payload jsonb, p_event_payload jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_guard text; v_result jsonb;
begin
  perform 1 from public.games where id = p_game_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  v_guard := public.gameplay_action_guard_locked(
    p_game_id, p_actor_player_id, p_team_id, array['live','flag_found']);
  if v_guard is not null then return jsonb_build_object('error', v_guard); end if;
  select public.submit_challenge_review_atomic_unchecked(
    p_game_id, p_team_id, p_card_id, p_actor_player_id,
    p_card_payload, p_event_payload
  ) into v_result;
  return v_result;
end;
$$;

create function public.reject_challenge_review_atomic(
  p_game_id uuid, p_card_id uuid, p_reviewer_player_id uuid,
  p_reviewer_team_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_guard text; v_result jsonb;
begin
  perform 1 from public.games where id = p_game_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  v_guard := public.gameplay_action_guard_locked(
    p_game_id, p_reviewer_player_id, p_reviewer_team_id,
    array['live','flag_found']);
  if v_guard is not null then return jsonb_build_object('error', v_guard); end if;
  select public.reject_challenge_review_atomic_unchecked(
    p_game_id, p_card_id, p_reviewer_player_id, p_reviewer_team_id
  ) into v_result;
  return v_result;
end;
$$;

create function public.attempt_flag_atomic(
  p_game_id uuid, p_player_id uuid, p_team_id uuid, p_landmark_ref text,
  p_result text, p_photo_url text, p_lat double precision,
  p_lng double precision, p_taken_at timestamptz, p_answer text default null,
  p_respawn_target_ref text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_guard text; v_result jsonb;
begin
  perform 1 from public.games where id = p_game_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  v_guard := public.gameplay_action_guard_locked(
    p_game_id, p_player_id, p_team_id, array['live']);
  if v_guard is not null then return jsonb_build_object('error', v_guard); end if;
  select public.attempt_flag_atomic_unchecked(
    p_game_id, p_player_id, p_team_id, p_landmark_ref, p_result,
    p_photo_url, p_lat, p_lng, p_taken_at, p_answer, p_respawn_target_ref
  ) into v_result;
  return v_result;
end;
$$;

-- Tag keeps its boolean wire contract. A false result is already handled as a
-- rejected target by the route; most importantly, no tag can commit after a
-- pause/finish/action-lock transaction wins the game-row race.
create function public.apply_tag_atomic(
  p_game_id uuid, p_raider_player_id uuid, p_defender_player_id uuid,
  p_lat double precision, p_lng double precision, p_respawn_target_ref text
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_guard text; v_defender_team_id uuid; v_result boolean;
begin
  perform 1 from public.games where id = p_game_id for update;
  if not found then return false; end if;
  select p.team_id into v_defender_team_id from public.players p
  join public.teams t on t.id = p.team_id
  where p.id = p_defender_player_id and t.game_id = p_game_id;
  if not found then return false; end if;
  v_guard := public.gameplay_action_guard_locked(
    p_game_id, p_defender_player_id, v_defender_team_id,
    array['live','flag_found']);
  if v_guard is not null then return false; end if;
  select public.apply_tag_atomic_unchecked(
    p_game_id, p_raider_player_id, p_defender_player_id,
    p_lat, p_lng, p_respawn_target_ref
  ) into v_result;
  return v_result;
end;
$$;

create function public.complete_flag_run_atomic(
  p_game_id uuid, p_carrier_player_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_status text; v_team_id uuid; v_guard text; v_result jsonb;
begin
  select status::text into v_status from public.games
  where id = p_game_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  -- Preserve retry/idempotency semantics: once terminal, the unchecked body
  -- returns the one persisted winner and never flips/re-infers it.
  if v_status = 'finished' then
    select public.complete_flag_run_atomic_unchecked(
      p_game_id, p_carrier_player_id) into v_result;
    return v_result;
  end if;
  select p.team_id into v_team_id from public.players p
  join public.teams t on t.id = p.team_id
  where p.id = p_carrier_player_id and t.game_id = p_game_id;
  if not found then return jsonb_build_object('error', 'forbidden'); end if;
  v_guard := public.gameplay_action_guard_locked(
    p_game_id, p_carrier_player_id, v_team_id, array['flag_found']);
  if v_guard is not null then
    if v_guard = 'game_not_in_play' then v_guard := 'game_not_in_flag_found'; end if;
    return jsonb_build_object('error', v_guard);
  end if;
  select public.complete_flag_run_atomic_unchecked(
    p_game_id, p_carrier_player_id) into v_result;
  return v_result;
end;
$$;

create function public.trigger_placed_curse_atomic(
  p_placement_id uuid, p_game_id uuid, p_intruder_player_id uuid,
  p_intruder_team_id uuid, p_curse_ref text, p_tier text,
  p_expires_at timestamptz, p_params jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_guard text; v_result jsonb;
begin
  perform 1 from public.games where id = p_game_id for update;
  if not found then return jsonb_build_object('triggered', false); end if;
  v_guard := public.gameplay_action_guard_locked(
    p_game_id, p_intruder_player_id, p_intruder_team_id,
    array['live','flag_found']);
  if v_guard is not null then
    return jsonb_build_object('triggered', false, 'error', v_guard);
  end if;
  select public.trigger_placed_curse_atomic_unchecked(
    p_placement_id, p_game_id, p_intruder_player_id, p_intruder_team_id,
    p_curse_ref, p_tier, p_expires_at, p_params
  ) into v_result;
  return v_result;
end;
$$;

-- The old implementations must only be reachable from the guarded wrappers.
revoke all on function public.gameplay_action_guard_locked(uuid, uuid, uuid, text[], boolean, boolean) from public, anon, authenticated;
revoke all on function public.purchase_intel_atomic_unchecked(uuid, uuid, uuid, text, int, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.place_curse_atomic_unchecked(uuid, uuid, text, text, text, uuid, int) from public, anon, authenticated, service_role;
revoke all on function public.buy_curse_atomic_unchecked(uuid, uuid, uuid, uuid, int, int, int, int[], text, text, timestamptz, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.award_challenge_atomic_unchecked(uuid, uuid, uuid, text, int, uuid, uuid, text[]) from public, anon, authenticated, service_role;
revoke all on function public.submit_challenge_review_atomic_unchecked(uuid, uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.reject_challenge_review_atomic_unchecked(uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.attempt_flag_atomic_unchecked(uuid, uuid, uuid, text, text, text, double precision, double precision, timestamptz, text, text) from public, anon, authenticated, service_role;
revoke all on function public.apply_tag_atomic_unchecked(uuid, uuid, uuid, double precision, double precision, text) from public, anon, authenticated, service_role;
revoke all on function public.complete_flag_run_atomic_unchecked(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.trigger_placed_curse_atomic_unchecked(uuid, uuid, uuid, uuid, text, text, timestamptz, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.harden_flag_atomic_leaky(uuid, uuid, uuid, text, uuid, int) from public, anon, authenticated, service_role;

revoke all on function public.purchase_intel_atomic(uuid, uuid, uuid, text, int, jsonb) from public, anon, authenticated;
revoke all on function public.place_curse_atomic(uuid, uuid, text, text, text, uuid, int) from public, anon, authenticated;
revoke all on function public.buy_curse_atomic(uuid, uuid, uuid, uuid, int, int, int, int[], text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.harden_flag_atomic(uuid, uuid, uuid, text, uuid, int) from public, anon, authenticated;
revoke all on function public.award_challenge_atomic_guarded(uuid, uuid, uuid, text, int, uuid, uuid, uuid, text[]) from public, anon, authenticated;
revoke all on function public.submit_challenge_review_atomic(uuid, uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.reject_challenge_review_atomic(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.attempt_flag_atomic(uuid, uuid, uuid, text, text, text, double precision, double precision, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.apply_tag_atomic(uuid, uuid, uuid, double precision, double precision, text) from public, anon, authenticated;
revoke all on function public.complete_flag_run_atomic(uuid, uuid) from public, anon, authenticated;
revoke all on function public.trigger_placed_curse_atomic(uuid, uuid, uuid, uuid, text, text, timestamptz, jsonb) from public, anon, authenticated;

grant execute on function public.purchase_intel_atomic(uuid, uuid, uuid, text, int, jsonb) to service_role;
grant execute on function public.place_curse_atomic(uuid, uuid, text, text, text, uuid, int) to service_role;
grant execute on function public.buy_curse_atomic(uuid, uuid, uuid, uuid, int, int, int, int[], text, text, timestamptz, jsonb) to service_role;
grant execute on function public.harden_flag_atomic(uuid, uuid, uuid, text, uuid, int) to service_role;
grant execute on function public.award_challenge_atomic_guarded(uuid, uuid, uuid, text, int, uuid, uuid, uuid, text[]) to service_role;
grant execute on function public.submit_challenge_review_atomic(uuid, uuid, uuid, uuid, jsonb, jsonb) to service_role;
grant execute on function public.reject_challenge_review_atomic(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.attempt_flag_atomic(uuid, uuid, uuid, text, text, text, double precision, double precision, timestamptz, text, text) to service_role;
grant execute on function public.apply_tag_atomic(uuid, uuid, uuid, double precision, double precision, text) to service_role;
grant execute on function public.complete_flag_run_atomic(uuid, uuid) to service_role;
grant execute on function public.trigger_placed_curse_atomic(uuid, uuid, uuid, uuid, text, text, timestamptz, jsonb) to service_role;

drop function public.harden_flag_atomic_leaky(uuid, uuid, uuid, text, uuid, int);
