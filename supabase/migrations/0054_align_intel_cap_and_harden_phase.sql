-- Migration 0054: align the two RPC authorities with the P1 and P9 route fixes.
--
-- Both changes were already made in the route layer (app/api/games/[id]/buy-intel
-- and .../harden-flag) but the RPCs are the authority, so the routes were being
-- overridden. Each override was proved against the live DB, not inferred:
--   P1: team at in_hand=4, one card expired by an enemy action -> route permits
--       the rebuy, RPC refuses intel_cap_reached.
--   P9: game in setup with flags placed and 500 coins -> route allows, RPC
--       returns game_not_in_play and zero landmarks are hardened.
--
-- ---------------------------------------------------------------------------
-- P1 (+ P16) — the intel cap counted cards destroyed by the enemy
-- ---------------------------------------------------------------------------
-- The cap counted intel in ANY state, making it a lifetime purchase budget
-- rather than a hand size. Measured consequence: a team holding 4 cards that
-- raided a decoy (0026:130 expires ALL in-hand intel) was locked out of intel
-- for the rest of the game with any balance — 0 usable, 0 purchases. A single
-- tag (0039:155) left a team at total=4 / in_hand=3 with 710 coins and no
-- rebuy, because narrowing.ts:58 ignores non-in_hand cards while the cap still
-- charged for them: the card contributed nothing and consumed everything.
--
-- The fix counts only `in_hand`, which is sound here because **intel is never
-- self-consumed**: the only writer of state='consumed' (0015:110) filters
-- `kind = 'challenge'` at 0015:117. So for intel, `expired` means exactly "the
-- enemy destroyed it" — tag, intel-loss curse, or decoy wipe. No new state or
-- payload marker is needed to tell enemy action apart from ordinary use.
--
-- The cap constant is also hardcoded here as 4 and does NOT read
-- lib/gameConstants.ts INTEL_CAP. That duplication is pre-existing; it is left
-- alone rather than silently re-homed, and the value still matches.
--
-- CRITICAL: the adjacent `intel_already_purchased` check stays deliberately
-- STATE-AGNOSTIC. Once expiry frees a cap slot, that duplicate guard is the
-- entire anti-farm mechanism — it stops a team re-buying the same ref to churn
-- intel. Narrowing the cap without keeping this broad would reopen the farming
-- hole the cap-on-purchases design existed to close.
--
-- P16 resolves as a consequence: curse.intel-loss now costs exactly the one
-- card its catalogue text promises, instead of also burning a purchase slot.

create or replace function public.purchase_intel_atomic_unchecked(
  p_game_id uuid,
  p_team_id uuid,
  p_actor_player_id uuid,
  p_intel_ref text,
  p_cost int,
  p_answer jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coins int;
  v_count int;
  v_card public.cards%rowtype;
begin
  if p_cost < 0 then raise exception 'invalid_intel_cost'; end if;

  select coins into v_coins
  from public.teams
  where id = p_team_id and game_id = p_game_id
  for update;
  if not found then raise exception 'team_not_found'; end if;

  -- P1: only cards the team still HOLDS count against the cap.
  select count(*) into v_count from public.cards
  where game_id = p_game_id and team_id = p_team_id
    and kind = 'intel' and state = 'in_hand';
  if v_count >= 4 then
    return jsonb_build_object('error', 'intel_cap_reached', 'coins', v_coins);
  end if;

  -- Intentionally state-agnostic: the anti-farm guard. See header.
  if exists (
    select 1 from public.cards
    where game_id = p_game_id and team_id = p_team_id
      and kind = 'intel' and ref = p_intel_ref
  ) then
    return jsonb_build_object('error', 'intel_already_purchased', 'coins', v_coins);
  end if;
  if v_coins < p_cost then
    return jsonb_build_object('error', 'insufficient_coins', 'coins', v_coins);
  end if;

  insert into public.events(game_id, type, actor_player_id, payload)
  values (
    p_game_id,
    'coins_deducted',
    p_actor_player_id,
    jsonb_build_object(
      'team_id', p_team_id,
      'amount', p_cost,
      'reason', 'buy_intel',
      'intel_ref', p_intel_ref
    )
  );
  update public.teams set coins = coins - p_cost where id = p_team_id
  returning coins into v_coins;

  insert into public.cards(game_id, team_id, kind, ref, state, payload)
  values (p_game_id, p_team_id, 'intel', p_intel_ref, 'in_hand', p_answer)
  returning * into v_card;

  insert into public.events(game_id, type, actor_player_id, payload)
  values (
    p_game_id,
    'intel_purchased',
    p_actor_player_id,
    jsonb_build_object(
      'team_id', p_team_id,
      'intel_ref', p_intel_ref,
      'cost', p_cost
    )
  );

  return jsonb_build_object(
    'card', to_jsonb(v_card),
    'team_coins', v_coins
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- P9 — hardening was unreachable when it mattered
-- ---------------------------------------------------------------------------
-- Harden costs 150, teams start with 100, and the phase gate was array['live'],
-- so a team could not harden during `setup` — the one phase where it is actually
-- deciding where to hide the flag it would be hardening. On time bonuses alone
-- 150 coins arrives at T+90 min.
--
-- The cost is deliberately NOT changed: the defect is sequencing, not price. A
-- team still cannot afford 150 at T+0, so allowing setup does not make hardening
-- free — it stops the phase gate blocking a team that later earns the coins from
-- applying them to the decision they already made.
--
-- No information leak: hardening only tightens the attempt geofence (28 m -> 12 m,
-- lib/gameConstants.ts) and never alters visible challenge text, which is why
-- only the real flag can be hardened without revealing which candidate it is.
-- The `not_real_flag` and `already_hardened` guards are unchanged, so a team
-- still cannot harden a decoy or harden twice.

create or replace function public.harden_flag_atomic(
  p_game_id uuid,
  p_team_id uuid,
  p_landmark_id uuid,
  p_landmark_ref text,
  p_actor_player_id uuid,
  p_cost int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_guard text; v_coins int;
begin
  perform 1 from public.games where id = p_game_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  -- P9: setup is now a legal phase for hardening.
  v_guard := public.gameplay_action_guard_locked(
    p_game_id, p_actor_player_id, p_team_id, array['setup', 'live']);
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

-- Grants must be restated: `create or replace` keeps existing ACLs, but 0030
-- revoked public/anon/authenticated and granted service_role only. Re-asserting
-- is harmless and makes the intent explicit if this file is ever replayed onto a
-- database where the function was created fresh.
revoke all on function public.purchase_intel_atomic_unchecked(uuid, uuid, uuid, text, int, jsonb) from public, anon, authenticated;
revoke all on function public.harden_flag_atomic(uuid, uuid, uuid, text, uuid, int) from public, anon, authenticated;
grant execute on function public.harden_flag_atomic(uuid, uuid, uuid, text, uuid, int) to service_role;
