-- Migration 0019: compute and persist timeout scoring/coin-flip atomically.
-- A terminal tie must be resolved exactly once and retries must return the
-- stored result rather than flipping again.

create or replace function public.finish_game_by_timeout_atomic(
  p_game_id uuid,
  p_actor_player_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_team public.teams%rowtype;
  v_scores jsonb := '[]'::jsonb;
  v_score jsonb;
  v_found boolean;
  v_challenges int;
  v_tags int;
  v_curses int;
  v_flag_pts int;
  v_coin_pts int;
  v_total numeric;
  v_index int := 0;
  v_first_team uuid;
  v_second_team uuid;
  v_first_total numeric;
  v_second_total numeric;
  v_first_challenges int;
  v_second_challenges int;
  v_first_coins int;
  v_second_coins int;
  v_winner uuid;
  v_reason text;
  v_existing public.events%rowtype;
  v_duration_min int;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if not found then raise exception 'game_not_found'; end if;

  if v_game.status = 'finished' then
    select * into v_existing from public.events
    where game_id = p_game_id and type = 'game_ended_by_timeout'
    order by created_at desc limit 1;
    if found then
      return jsonb_build_object(
        'game', to_jsonb(v_game),
        'winner_team_id', v_existing.payload->'winner_team_id',
        'reason', v_existing.payload->>'reason',
        'scores', v_existing.payload->'scores'
      );
    end if;
    return jsonb_build_object('error', 'already_finished');
  end if;
  if v_game.status not in ('live', 'flag_found') then
    return jsonb_build_object('error', 'game_not_in_play');
  end if;
  if v_game.started_at is null then
    return jsonb_build_object('error', 'game_not_started');
  end if;
  v_duration_min := coalesce((v_game.config->>'duration_minutes')::int, 180);
  if now() < v_game.started_at + make_interval(mins => v_duration_min) then
    return jsonb_build_object('error', 'not_yet_expired');
  end if;

  -- Freeze both balances before scoring. All transaction-safe spend/credit
  -- RPCs lock the same rows, so the timeout boundary gets one coherent state.
  perform 1 from public.teams where game_id = p_game_id order by id for update;

  for v_team in
    select * from public.teams where game_id = p_game_id order by side
  loop
    select exists (
      select 1 from public.events where game_id = p_game_id
        and type = 'flag_attempt'
        and payload->>'result' = 'real'
        and payload->>'team_id' = v_team.id::text
    ) into v_found;
    select count(*) into v_challenges from public.events
      where game_id = p_game_id and type = 'challenge_completed'
        and payload->>'team_id' = v_team.id::text;
    select count(*) into v_tags from public.events e
      join public.players p on p.id::text = e.payload->>'defender_player_id'
      where e.game_id = p_game_id and e.type = 'tag'
        and p.team_id = v_team.id;
    select count(*) into v_curses from public.events
      where game_id = p_game_id and type = 'curse_cast'
        and payload->>'buyer_team_id' = v_team.id::text;

    v_flag_pts := case when v_found then 10 else 0 end;
    v_coin_pts := floor(v_team.coins / 50.0);
    v_total := v_flag_pts + v_challenges + v_tags + (v_curses * 0.5) + v_coin_pts;
    v_score := jsonb_build_object(
      'team_id', v_team.id,
      'team_side', v_team.side,
      'found_real_flag', v_found,
      'challenges_completed', v_challenges,
      'tags_made', v_tags,
      'curses_cast', v_curses,
      'coins_remaining', v_team.coins,
      'flag_points', v_flag_pts,
      'challenge_points', v_challenges,
      'tag_points', v_tags,
      'curse_points', v_curses * 0.5,
      'coin_points', v_coin_pts,
      'total', v_total
    );
    v_scores := v_scores || jsonb_build_array(v_score);

    v_index := v_index + 1;
    if v_index = 1 then
      v_first_team := v_team.id;
      v_first_total := v_total;
      v_first_challenges := v_challenges;
      v_first_coins := v_team.coins;
    elsif v_index = 2 then
      v_second_team := v_team.id;
      v_second_total := v_total;
      v_second_challenges := v_challenges;
      v_second_coins := v_team.coins;
    end if;
  end loop;

  if v_index <> 2 then raise exception 'invalid_team_count'; end if;
  if v_first_total <> v_second_total then
    v_winner := case when v_first_total > v_second_total then v_first_team else v_second_team end;
    v_reason := 'timeout_points';
  elsif v_first_challenges <> v_second_challenges then
    v_winner := case when v_first_challenges > v_second_challenges then v_first_team else v_second_team end;
    v_reason := 'timeout_tiebreaker';
  elsif v_first_coins <> v_second_coins then
    v_winner := case when v_first_coins > v_second_coins then v_first_team else v_second_team end;
    v_reason := 'timeout_tiebreaker';
  else
    v_winner := case when random() < 0.5 then v_first_team else v_second_team end;
    v_reason := 'timeout_coin_flip';
  end if;

  update public.games set status = 'finished', ended_at = now()
  where id = p_game_id returning * into v_game;
  insert into public.events(game_id, type, actor_player_id, payload)
  values (p_game_id, 'game_ended_by_timeout', p_actor_player_id,
    jsonb_build_object(
      'winner_team_id', v_winner,
      'reason', v_reason,
      'scores', v_scores
    ));
  insert into public.events(game_id, type, actor_player_id, payload)
  values (p_game_id, 'game_won', p_actor_player_id,
    jsonb_build_object('winner_team_id', v_winner, 'reason', v_reason));

  return jsonb_build_object(
    'game', to_jsonb(v_game),
    'winner_team_id', v_winner,
    'reason', v_reason,
    'scores', v_scores
  );
end;
$$;

revoke all on function public.finish_game_by_timeout_atomic(uuid, uuid) from public, anon, authenticated;
grant execute on function public.finish_game_by_timeout_atomic(uuid, uuid) to service_role;
