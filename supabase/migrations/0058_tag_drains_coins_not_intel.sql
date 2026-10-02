-- Migration 0058: a tag costs the raiding team COINS, not an intel card.
--
-- WHY. The intel penalty was close to meaningless for information and real only
-- for money, which is the opposite of what the rules implied. `/live-state`
-- loads the team's cards with `select('*')` in ANY state, so an expired card's
-- `payload` — the actual answer — was still sent to the client; only
-- `narrowing.ts` stopped dimming candidates on the map. A player therefore kept
-- the fact and lost a map overlay, and could have screenshotted it regardless.
-- Memory is not something a referee app can confiscate.
--
-- So the old rule charged ~30-100 coins to re-buy plus some convenience, while
-- telling players they had "lost intel". This makes the real cost the stated
-- cost.
--
-- WHY 40 COINS. Deliberately between the two cheapest cards (30) and the
-- mid-tier ones (50-60), so a tag costs about one cheap card's worth of
-- progress without erasing a major purchase. It is also under the 50-coin
-- curse die, so being tagged never costs more than a full curse cast. Tune the
-- literal here; it is the only place the figure is enforced.
--
-- WHAT IS UNCHANGED. The per-ACTION rule (one fine per Tag tap, however many
-- raiders are caught), the walk to the neutral landmark, and the flag strip from
-- 0053. Intel cards are no longer touched by a tag at all, so the 0054 cap
-- interaction simply stops applying: nothing to free, nothing to burn.
--
-- BUILT FROM 0044, NOT 0039. An earlier draft of this migration was derived
-- from 0039 and silently reverted 0044's precondition (that every requested id
-- must still be a valid raider, not just one of them). tools/sim/scenario-races
-- caught it. When recreating an RPC, start from the LATEST definition —
-- `pg_get_functiondef` on the live function — not from the migration that first
-- introduced it.
--
-- NOTE on the decoy wipe: `0026:130` still expires ALL in-hand intel on a decoy
-- attempt. That is left alone on purpose — it is a different mechanic (you
-- photographed the wrong thing), and it has the same "you keep the knowledge"
-- caveat, which is now a known limitation rather than the main penalty.

create or replace function public.apply_tags_atomic(
  p_game_id uuid,
  p_raider_player_ids uuid[],
  p_defender_player_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_respawn_target_ref text,
  p_expected_camping_heartbeat_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guard text;
  v_defender_team_id uuid;
  v_raider_team_id uuid;
  v_camping public.player_camping_state%rowtype;
  v_raider_id uuid;
  v_raider_coins int;
  v_drain int;
  v_locked_count integer;
  v_distinct_count integer;
  v_valid_raider_count integer;
  v_raider_team_count integer;
  v_applied boolean;
begin
  if p_raider_player_ids is null
     or cardinality(p_raider_player_ids) < 1
     or cardinality(p_raider_player_ids) > 8
     or nullif(p_respawn_target_ref, '') is null
     or p_expected_camping_heartbeat_at is null then
    return jsonb_build_object('error', 'invalid_tag_batch');
  end if;
  select count(distinct id) into v_distinct_count
  from unnest(p_raider_player_ids) as ids(id);
  if v_distinct_count <> cardinality(p_raider_player_ids) then
    return jsonb_build_object('error', 'duplicate_target');
  end if;

  perform 1 from public.games where id = p_game_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;

  select p.team_id into v_defender_team_id
  from public.players p
  join public.teams t on t.id = p.team_id
  where p.id = p_defender_player_id and t.game_id = p_game_id;
  if not found then return jsonb_build_object('error', 'forbidden'); end if;

  v_guard := public.gameplay_action_guard_locked(
    p_game_id, p_defender_player_id, v_defender_team_id,
    array['live','flag_found']);
  if v_guard is not null then
    return jsonb_build_object('error', v_guard);
  end if;

  select * into v_camping
  from public.player_camping_state
  where player_id = p_defender_player_id
    and game_id = p_game_id
    and team_id = v_defender_team_id
  for update;
  if not found then return jsonb_build_object('error', 'camping_state_missing'); end if;
  if v_camping.last_heartbeat_at is distinct from p_expected_camping_heartbeat_at then
    return jsonb_build_object('error', 'camping_state_changed');
  end if;
  if v_camping.locked then return jsonb_build_object('error', 'camping_locked'); end if;
  if v_camping.last_heartbeat_at < clock_timestamp() - interval '15 seconds' then
    return jsonb_build_object('error', 'camping_state_stale');
  end if;

  perform p.id
  from public.players p
  join public.teams t on t.id = p.team_id
  where t.game_id = p_game_id and p.id = any(p_raider_player_ids)
  order by p.id
  for update of p;
  get diagnostics v_locked_count = row_count;
  if v_locked_count <> cardinality(p_raider_player_ids) then
    return jsonb_build_object('error', 'target_state_changed');
  end if;

  -- 0044's precondition, preserved: EVERY requested id must still be a valid
  -- raider, not merely one of them. Building 0058 from 0039 (which predates
  -- 0044) dropped this and the races scenario caught it — the batch raised
  -- tag_batch_invariant_failed from inside the loop instead of returning a
  -- clean target_state_changed.
  select count(*), count(distinct p.team_id), min(p.team_id::text)::uuid
    into v_valid_raider_count, v_raider_team_count, v_raider_team_id
  from public.players p
  where p.id = any(p_raider_player_ids)
    and p.team_id <> v_defender_team_id
    and not p.respawning;
  if v_valid_raider_count <> cardinality(p_raider_player_ids)
     or v_raider_team_count <> 1 then
    return jsonb_build_object('error', 'target_state_changed');
  end if;

  foreach v_raider_id in array p_raider_player_ids loop
    select public.apply_tag_atomic_unchecked(
      p_game_id, v_raider_id, p_defender_player_id,
      p_lat, p_lng, p_respawn_target_ref
    ) into v_applied;
    if not v_applied then
      raise exception using errcode = 'P0001', message = 'tag_batch_invariant_failed';
    end if;
  end loop;

  -- The penalty belongs to the single Tag action, not to every player caught by
  -- it: catching a bunched party costs the raiding team one fine, not four.
  --
  -- TAG_COIN_PENALTY coins, clamped at zero so a broke team can never go
  -- negative. Mirrors the coin-drain curse's `least(amount, balance)` at
  -- 0046:152. A team with 0 coins pays nothing — the walk and the lost flag are
  -- still real costs, so the tag is never a no-op.
  select coins into v_raider_coins from public.teams
  where id = v_raider_team_id for update;
  v_drain := least(40, greatest(0, coalesce(v_raider_coins, 0)));

  if v_drain > 0 then
    -- Event first, then the materialised counter, in one transaction (the
    -- project-wide rule for every coin mutation).
    insert into public.events(game_id, type, actor_player_id, payload)
    values (p_game_id, 'coins_deducted', p_defender_player_id,
      jsonb_build_object(
        'team_id', v_raider_team_id,
        'amount', v_drain,
        'reason', 'tag_penalty',
        'tagged_player_ids', to_jsonb(p_raider_player_ids)
      ));
    update public.teams set coins = coins - v_drain
    where id = v_raider_team_id;
  end if;

  return jsonb_build_object(
    'tagged_player_ids', to_jsonb(p_raider_player_ids),
    'coins_drained', v_drain
  );
end;
$$;

