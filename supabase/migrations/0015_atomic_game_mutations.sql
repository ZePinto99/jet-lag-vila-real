-- Migration 0015: atomic, retry-safe game economy mutations.
--
-- Multiple phones on the same team legitimately call housekeeping and game
-- actions at the same time.  The original route-level read/insert/update
-- sequences were individually guarded, but they were not a transaction:
-- concurrent time ticks produced duplicate ledger markers, concurrent
-- challenge completions could both claim first blood, and losing intel-buy
-- races left phantom coins_deducted events.  These service-role-only RPCs keep
-- each ledger mutation and its materialized counter in one Postgres
-- transaction.

create or replace function public.apply_time_bonus_interval(
  p_game_id uuid,
  p_actor_player_id uuid,
  p_interval int,
  p_amount int,
  p_is_power_hour boolean
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team record;
begin
  if p_interval < 1 or p_amount < 0 then
    raise exception 'invalid_time_bonus';
  end if;

  -- Serialize time-bonus calls per game.  The event lookup is the durable
  -- idempotency key, so retries remain safe after the transaction commits.
  perform pg_advisory_xact_lock(hashtextextended(p_game_id::text || ':time_bonus', 0));

  if exists (
    select 1 from public.events
    where game_id = p_game_id
      and type = 'time_bonus'
      and (payload->>'interval')::int = p_interval
  ) then
    return false;
  end if;

  for v_team in
    select id from public.teams where game_id = p_game_id order by id for update
  loop
    insert into public.events(game_id, type, actor_player_id, payload)
    values (
      p_game_id,
      'coins_credited',
      p_actor_player_id,
      jsonb_build_object(
        'team_id', v_team.id,
        'amount', p_amount,
        'reason', 'time_bonus',
        'interval', p_interval
      )
    );

    update public.teams set coins = coins + p_amount where id = v_team.id;
  end loop;

  insert into public.events(game_id, type, actor_player_id, payload)
  values (
    p_game_id,
    'time_bonus',
    p_actor_player_id,
    jsonb_build_object(
      'interval', p_interval,
      'amount', p_amount,
      'is_power_hour', p_is_power_hour
    )
  );

  return true;
end;
$$;

create or replace function public.award_challenge_atomic(
  p_game_id uuid,
  p_team_id uuid,
  p_card_id uuid,
  p_expected_state text,
  p_reward_coins int,
  p_actor_player_id uuid,
  p_reviewed_by_team_id uuid default null,
  p_replacement_refs text[] default array[]::text[]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_card public.cards%rowtype;
  v_first_blood boolean;
  v_bonus int;
  v_total int;
  v_team_coins int;
  v_active_count int;
  v_replacement_ref text;
  v_completed_payload jsonb;
begin
  if p_reward_coins < 0 then
    raise exception 'invalid_challenge_reward';
  end if;

  -- First blood is game-wide, so serialize all challenge awards in this game.
  perform pg_advisory_xact_lock(hashtextextended(p_game_id::text || ':challenge_award', 0));

  update public.cards
  set state = 'consumed',
      payload = coalesce(payload, '{}'::jsonb) ||
        jsonb_build_object('completed_at', now()),
      updated_at = now()
  where id = p_card_id
    and game_id = p_game_id
    and team_id = p_team_id
    and kind = 'challenge'
    and state = p_expected_state
  returning * into v_card;

  if not found then
    return jsonb_build_object('error', 'challenge_not_available');
  end if;

  select not exists (
    select 1 from public.events
    where game_id = p_game_id and type = 'challenge_completed'
  ) into v_first_blood;
  v_bonus := case when v_first_blood then 30 else 0 end;
  v_total := p_reward_coins + v_bonus;

  -- Lock the counter row and increment it arithmetically so concurrent credits
  -- from other transaction-safe RPCs cannot overwrite one another.
  select coins into v_team_coins
  from public.teams
  where id = p_team_id and game_id = p_game_id
  for update;
  if not found then
    raise exception 'team_not_found';
  end if;

  insert into public.events(game_id, type, actor_player_id, payload)
  values (
    p_game_id,
    'coins_credited',
    p_actor_player_id,
    jsonb_build_object(
      'team_id', p_team_id,
      'amount', v_total,
      'reason', 'challenge_completed',
      'challenge_ref', v_card.ref,
      'breakdown', jsonb_build_object(
        'reward', p_reward_coins,
        'first_blood', v_bonus
      )
    )
  );

  update public.teams
  set coins = coins + v_total
  where id = p_team_id
  returning coins into v_team_coins;

  v_completed_payload := jsonb_build_object(
    'team_id', p_team_id,
    'challenge_ref', v_card.ref,
    'card_id', v_card.id,
    'reward_coins', p_reward_coins,
    'first_blood', v_first_blood,
    'bonus_coins', v_bonus,
    'actor_player_id', p_actor_player_id
  );
  if nullif(v_card.payload->>'photo_url', '') is not null then
    v_completed_payload := v_completed_payload ||
      jsonb_build_object('photo_url', v_card.payload->>'photo_url');
  end if;
  if p_reviewed_by_team_id is not null then
    v_completed_payload := v_completed_payload ||
      jsonb_build_object('reviewed_by_team_id', p_reviewed_by_team_id);
  end if;

  insert into public.events(game_id, type, actor_player_id, payload)
  values (p_game_id, 'challenge_completed', p_actor_player_id, v_completed_payload);

  select count(*) into v_active_count
  from public.cards
  where game_id = p_game_id
    and team_id = p_team_id
    and kind = 'challenge'
    and state in ('available', 'pending');

  if v_active_count < 3 then
    select candidate.ref into v_replacement_ref
    from unnest(p_replacement_refs) with ordinality as candidate(ref, ord)
    where not exists (
      select 1 from public.cards existing
      where existing.game_id = p_game_id
        and existing.team_id = p_team_id
        and existing.kind = 'challenge'
        and existing.ref = candidate.ref
    )
    order by random()
    limit 1;

    if v_replacement_ref is not null then
      insert into public.cards(game_id, team_id, kind, ref, state, payload)
      values (p_game_id, p_team_id, 'challenge', v_replacement_ref, 'available', '{}'::jsonb);
    end if;
  end if;

  return jsonb_build_object(
    'reward_coins', p_reward_coins,
    'first_blood', v_first_blood,
    'bonus_coins', v_bonus,
    'team_coins', v_team_coins,
    'replacement_ref', v_replacement_ref
  );
end;
$$;

create or replace function public.purchase_intel_atomic(
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

  select count(*) into v_count from public.cards
  where game_id = p_game_id and team_id = p_team_id and kind = 'intel';
  if v_count >= 4 then
    return jsonb_build_object('error', 'intel_cap_reached', 'coins', v_coins);
  end if;
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

revoke all on function public.apply_time_bonus_interval(uuid, uuid, int, int, boolean) from public, anon, authenticated;
revoke all on function public.award_challenge_atomic(uuid, uuid, uuid, text, int, uuid, uuid, text[]) from public, anon, authenticated;
revoke all on function public.purchase_intel_atomic(uuid, uuid, uuid, text, int, jsonb) from public, anon, authenticated;
grant execute on function public.apply_time_bonus_interval(uuid, uuid, int, int, boolean) to service_role;
grant execute on function public.award_challenge_atomic(uuid, uuid, uuid, text, int, uuid, uuid, text[]) to service_role;
grant execute on function public.purchase_intel_atomic(uuid, uuid, uuid, text, int, jsonb) to service_role;

-- Enforce the RULEBOOK roster invariant at the database boundary as well as
-- in the lobby routes. This closes simultaneous-join/switch races.
create or replace function public.players_enforce_roster_rules() returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_game_id uuid;
  v_team_count int;
  v_same_device_count int;
begin
  select game_id into v_game_id from public.teams where id = new.team_id;
  if v_game_id is null then return new; end if;

  if tg_op = 'INSERT' or new.team_id is distinct from old.team_id then
    select count(*) into v_team_count
    from public.players where team_id = new.team_id;
    if v_team_count >= 4 then
      raise exception using errcode = 'P0001', message = 'team_full';
    end if;
  end if;

  if new.device_id is not null and (
    tg_op = 'INSERT'
    or new.device_id is distinct from old.device_id
    or new.team_id is distinct from old.team_id
  ) then
    select count(*) into v_same_device_count
    from public.players p
    join public.teams t on t.id = p.team_id
    where t.game_id = v_game_id
      and p.device_id = new.device_id
      and (tg_op = 'INSERT' or p.id <> new.id);
    if v_same_device_count > 0 then
      raise exception using errcode = 'P0001', message = 'device_already_joined';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists players_roster_rules on public.players;
create trigger players_roster_rules
  before insert or update of team_id, device_id on public.players
  for each row execute function public.players_enforce_roster_rules();
