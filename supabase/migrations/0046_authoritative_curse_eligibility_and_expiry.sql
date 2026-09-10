-- Migration 0046: make curse eligibility and same-effect expiry authoritative.
--
-- The route still rolls/selects a curse for presentation, but target coins,
-- target intel, and no-stack state can change before the RPC commits. Check
-- those conditions while holding the rows that the ledger effect will mutate,
-- and never charge the buyer when the selected curse is no longer available.
--
-- Timed rows remain in active_curses until housekeeping runs. Serialize expiry
-- with casts for the same game/team/ref so a stale row cannot permanently block
-- a recast or race the full unique index.

create or replace function public.expire_active_curse_ref_locked(
  p_game_id uuid,
  p_target_team_id uuid,
  p_curse_ref text,
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
  -- This transaction-level lock is deliberately shared by normal casts,
  -- placed casts, and bulk expiry. It remains held after this helper returns,
  -- covering the caller's subsequent no-stack check and insert.
  perform pg_advisory_xact_lock(
    hashtextextended(
      p_game_id::text || ':' || p_target_team_id::text || ':' || p_curse_ref,
      0
    )
  );

  for v_row in
    select *
    from public.active_curses
    where game_id = p_game_id
      and target_team_id = p_target_team_id
      and curse_ref = p_curse_ref
      and expires_at is not null
      and expires_at <= now()
    order by created_at, id
    for update
  loop
    -- Preserve the existing durable realtime signal. The event is written in
    -- the same transaction and before deletion; any failure rolls both back.
    insert into public.events(game_id, type, actor_player_id, payload)
    values (p_game_id, 'curse_expired', p_actor_player_id,
      jsonb_build_object(
        'curse_id', v_row.id,
        'target_team_id', v_row.target_team_id,
        'curse_ref', v_row.curse_ref
      ));
    delete from public.active_curses where id = v_row.id;
    v_ids := array_append(v_ids, v_row.id);
  end loop;

  return v_ids;
end;
$$;

create or replace function public.buy_curse_atomic_unchecked(
  p_game_id uuid,
  p_buyer_team_id uuid,
  p_target_team_id uuid,
  p_actor_player_id uuid,
  p_cost int,
  p_num_dice int,
  p_dice_total int,
  p_dice_rolls int[],
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
  v_buyer_coins int;
  v_target_coins int;
  v_drain int;
  v_victim public.cards%rowtype;
  v_ledger jsonb;
  v_one_shot boolean := p_curse_ref in ('curse.coin-drain', 'curse.intel-loss');
begin
  -- Stable UUID order serializes team-mate purchases and prevents cross-team
  -- coin-drain deadlocks.
  perform 1 from public.teams
  where id in (p_buyer_team_id, p_target_team_id)
    and game_id = p_game_id
  order by id for update;

  select coins into v_buyer_coins from public.teams where id = p_buyer_team_id;
  select coins into v_target_coins from public.teams where id = p_target_team_id;
  if v_buyer_coins is null or v_target_coins is null then
    raise exception 'team_not_found';
  end if;
  if v_buyer_coins < p_cost then
    return jsonb_build_object('error', 'insufficient_coins', 'coins', v_buyer_coins);
  end if;

  if p_curse_ref = 'curse.coin-drain' then
    -- The target counter is locked above, so this eligibility check and the
    -- later deduction observe the same balance.
    if v_target_coins <= 0 then
      return jsonb_build_object('error', 'no_available_curse', 'coins', v_buyer_coins);
    end if;
  elsif p_curse_ref = 'curse.intel-loss' then
    -- Claim the exact random victim before charging the buyer. Reuse this row
    -- after deduction rather than performing a second, racy lookup.
    select * into v_victim from public.cards
    where game_id = p_game_id
      and team_id = p_target_team_id
      and kind = 'intel'
      and state = 'in_hand'
    order by random()
    limit 1
    for update;
    if not found then
      return jsonb_build_object('error', 'no_available_curse', 'coins', v_buyer_coins);
    end if;
  elsif not v_one_shot then
    -- Delete/log only elapsed timed rows. A NULL expiry (for example an
    -- unfinished Pilgrimage) remains active and continues to block stacking.
    perform public.expire_active_curse_ref_locked(
      p_game_id, p_target_team_id, p_curse_ref, p_actor_player_id
    );
    if exists (
      select 1 from public.active_curses
      where game_id = p_game_id
        and target_team_id = p_target_team_id
        and curse_ref = p_curse_ref
    ) then
      return jsonb_build_object('error', 'curse_already_active', 'coins', v_buyer_coins);
    end if;
  end if;

  insert into public.events(game_id, type, actor_player_id, payload)
  values (p_game_id, 'coins_deducted', p_actor_player_id,
    jsonb_build_object(
      'team_id', p_buyer_team_id, 'amount', p_cost, 'reason', 'buy_curse',
      'num_dice', p_num_dice, 'dice_total', p_dice_total
    ));
  update public.teams set coins = coins - p_cost where id = p_buyer_team_id
  returning coins into v_buyer_coins;

  if p_curse_ref = 'curse.coin-drain' then
    v_drain := least(coalesce((p_params->>'amount')::int, 50), v_target_coins);
    insert into public.events(game_id, type, actor_player_id, payload)
    values (p_game_id, 'coins_deducted', p_actor_player_id,
      jsonb_build_object(
        'team_id', p_target_team_id, 'amount', v_drain,
        'reason', 'curse_coin_drain'
      ));
    update public.teams set coins = coins - v_drain where id = p_target_team_id
    returning coins into v_target_coins;
    v_ledger := jsonb_build_object(
      'kind', 'coin_drain', 'amount', v_drain,
      'target_team_coins', v_target_coins
    );
  elsif p_curse_ref = 'curse.intel-loss' then
    update public.cards set state = 'expired', updated_at = now()
    where id = v_victim.id;
    insert into public.events(game_id, type, actor_player_id, payload)
    values (p_game_id, 'intel_lost', p_actor_player_id,
      jsonb_build_object(
        'team_id', p_target_team_id, 'card_id', v_victim.id, 'ref', v_victim.ref
      ));
    v_ledger := jsonb_build_object(
      'kind', 'intel_loss', 'expired_card_ref', v_victim.ref
    );
  else
    insert into public.active_curses(
      game_id, target_team_id, curse_ref, started_at, expires_at, params
    ) values (
      p_game_id, p_target_team_id, p_curse_ref, now(), p_expires_at, p_params
    );
    if p_curse_ref = 'curse.full-stop' then
      v_ledger := jsonb_build_object('kind', 'full_stop');
    elsif p_curse_ref = 'curse.check-in' then
      v_ledger := jsonb_build_object('kind', 'check_in');
    end if;
  end if;

  insert into public.events(game_id, type, actor_player_id, payload)
  values (p_game_id, 'curse_cast', p_actor_player_id,
    jsonb_build_object(
      'buyer_team_id', p_buyer_team_id,
      'target_team_id', p_target_team_id,
      'curse_ref', p_curse_ref,
      'tier', p_tier,
      'dice_total', p_dice_total,
      'dice_rolls', to_jsonb(p_dice_rolls),
      'expires_at', p_expires_at
    ));

  return jsonb_strip_nulls(jsonb_build_object(
    'buyer_team_coins', v_buyer_coins,
    'ledger_effect', v_ledger
  ));
end;
$$;

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
  -- Snapshot candidates without row locks, then serialize each effect through
  -- the same helper used by casts. A concurrent cast may clean one first; in
  -- that case the helper returns an empty array and no duplicate event.
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

revoke all on function public.expire_active_curse_ref_locked(uuid, uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.buy_curse_atomic_unchecked(uuid, uuid, uuid, uuid, int, int, int, int[], text, text, timestamptz, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.expire_curses_atomic(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.expire_curses_atomic(uuid, uuid) to service_role;
