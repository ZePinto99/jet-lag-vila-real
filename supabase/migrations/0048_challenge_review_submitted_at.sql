-- Migration 0048: the review deadline starts at the server-authored
-- payload.submitted_at timestamp. Fall back to cards.updated_at only for
-- legacy/malformed payloads created before submitted_at was persisted.

create or replace function public.auto_accept_challenge_review_atomic(
  p_game_id uuid,
  p_card_id uuid,
  p_reward_coins int,
  p_replacement_refs text[] default array[]::text[]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_card public.cards%rowtype;
  v_actor_player_id uuid;
  v_submitted_at timestamptz;
  v_result jsonb;
begin
  if p_reward_coins < 0 then raise exception 'invalid_challenge_reward'; end if;

  select * into v_game from public.games where id = p_game_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if v_game.status not in ('live', 'flag_found') then
    return jsonb_build_object('error', 'game_not_in_play');
  end if;

  select * into v_card
  from public.cards
  where id = p_card_id and game_id = p_game_id and kind = 'challenge'
  for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if v_card.state <> 'pending' then
    return jsonb_build_object('error', 'not_pending');
  end if;

  begin
    v_submitted_at := nullif(v_card.payload->>'submitted_at', '')::timestamptz;
  exception when others then
    v_submitted_at := null;
  end;
  v_submitted_at := coalesce(v_submitted_at, v_card.updated_at);
  if v_submitted_at > now() - interval '120 seconds' then
    return jsonb_build_object('error', 'review_window_open');
  end if;

  begin
    v_actor_player_id := nullif(v_card.payload->>'submitted_by', '')::uuid;
  exception when others then
    v_actor_player_id := null;
  end;

  select public.award_challenge_atomic_unchecked(
    p_game_id,
    v_card.team_id,
    v_card.id,
    'pending',
    p_reward_coins,
    v_actor_player_id,
    null,
    p_replacement_refs
  ) into v_result;
  if v_result ? 'error' then return v_result; end if;

  insert into public.events(game_id, type, actor_player_id, payload)
  values (
    p_game_id,
    'challenge_auto_accepted',
    v_actor_player_id,
    jsonb_build_object(
      'team_id', v_card.team_id,
      'challenge_ref', v_card.ref,
      'card_id', v_card.id,
      'review_seconds', 120,
      'submitted_at', v_submitted_at
    )
  );
  return v_result || jsonb_build_object(
    'auto_accepted', true,
    'card_id', v_card.id,
    'challenge_ref', v_card.ref
  );
end;
$$;

revoke all on function public.auto_accept_challenge_review_atomic(uuid, uuid, int, text[])
  from public, anon, authenticated;
grant execute on function public.auto_accept_challenge_review_atomic(uuid, uuid, int, text[])
  to service_role;
