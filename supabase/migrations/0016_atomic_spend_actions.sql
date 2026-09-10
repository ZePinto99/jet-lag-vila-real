-- Migration 0016: transaction-safe curse placement/casting and flag hardening.
-- These actions can be initiated by every player, so two phones must never
-- spend the same team balance or leave phantom ledger entries.

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
declare
  v_coins int;
begin
  select coins into v_coins from public.teams
  where id = p_team_id and game_id = p_game_id for update;
  if not found then raise exception 'team_not_found'; end if;

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
    jsonb_build_object('team_id', p_team_id, 'landmark_ref', p_landmark_ref));

  return jsonb_build_object('team_coins', v_coins);
end;
$$;

create or replace function public.place_curse_atomic(
  p_game_id uuid,
  p_team_id uuid,
  p_landmark_ref text,
  p_placed_ref text,
  p_curse_ref text,
  p_actor_player_id uuid,
  p_cost int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_coins int;
  v_placed public.placed_curses%rowtype;
begin
  select coins into v_coins from public.teams
  where id = p_team_id and game_id = p_game_id for update;
  if not found then raise exception 'team_not_found'; end if;

  if exists (
    select 1 from public.placed_curses
    where game_id = p_game_id and owner_team_id = p_team_id
      and landmark_ref = p_landmark_ref and armed
  ) then
    return jsonb_build_object('error', 'already_placed_here', 'coins', v_coins);
  end if;
  if v_coins < p_cost then
    return jsonb_build_object('error', 'insufficient_coins', 'coins', v_coins);
  end if;

  insert into public.events(game_id, type, actor_player_id, payload)
  values (p_game_id, 'coins_deducted', p_actor_player_id,
    jsonb_build_object('team_id', p_team_id, 'amount', p_cost, 'reason', 'place_curse'));
  update public.teams set coins = coins - p_cost where id = p_team_id
  returning coins into v_coins;
  insert into public.placed_curses(
    game_id, owner_team_id, landmark_ref, placed_ref, curse_ref, armed
  ) values (
    p_game_id, p_team_id, p_landmark_ref, p_placed_ref, p_curse_ref, true
  ) returning * into v_placed;
  -- Public event intentionally omits the hidden landmark and curse identity.
  insert into public.events(game_id, type, actor_player_id, payload)
  values (p_game_id, 'placed_curse_armed', p_actor_player_id,
    jsonb_build_object('team_id', p_team_id));

  return jsonb_build_object('placed', to_jsonb(v_placed), 'team_coins', v_coins);
end;
$$;

create or replace function public.buy_curse_atomic(
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
  -- Lock both counters in stable UUID order. This also serializes purchases by
  -- team-mates and avoids cross-team coin-drain deadlocks.
  perform 1 from public.teams
  where id in (p_buyer_team_id, p_target_team_id)
    and game_id = p_game_id
  order by id for update;

  select coins into v_buyer_coins from public.teams where id = p_buyer_team_id;
  select coins into v_target_coins from public.teams where id = p_target_team_id;
  if v_buyer_coins is null or v_target_coins is null then raise exception 'team_not_found'; end if;
  if v_buyer_coins < p_cost then
    return jsonb_build_object('error', 'insufficient_coins', 'coins', v_buyer_coins);
  end if;
  if not v_one_shot and exists (
    select 1 from public.active_curses
    where game_id = p_game_id and target_team_id = p_target_team_id
      and curse_ref = p_curse_ref
  ) then
    return jsonb_build_object('error', 'curse_already_active', 'coins', v_buyer_coins);
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
    select * into v_victim from public.cards
    where game_id = p_game_id and team_id = p_target_team_id
      and kind = 'intel' and state = 'in_hand'
    order by random() limit 1 for update;
    if found then
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
      v_ledger := jsonb_build_object('kind', 'intel_loss', 'expired_card_ref', null);
    end if;
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

revoke all on function public.harden_flag_atomic(uuid, uuid, uuid, text, uuid, int) from public, anon, authenticated;
revoke all on function public.place_curse_atomic(uuid, uuid, text, text, text, uuid, int) from public, anon, authenticated;
revoke all on function public.buy_curse_atomic(uuid, uuid, uuid, uuid, int, int, int, int[], text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.harden_flag_atomic(uuid, uuid, uuid, text, uuid, int) to service_role;
grant execute on function public.place_curse_atomic(uuid, uuid, text, text, text, uuid, int) to service_role;
grant execute on function public.buy_curse_atomic(uuid, uuid, uuid, uuid, int, int, int, int[], text, text, timestamptz, jsonb) to service_role;
