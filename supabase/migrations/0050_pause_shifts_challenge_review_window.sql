-- Migration 0050 — finding P11 (bug): a weather pause consumed the entire
-- challenge-review window, so any pause longer than 120 s auto-awarded the
-- coins on resume without the reviewing team ever seeing the photo.
--
-- 0027 already freezes the game clock across a pause: on resume it shifts
-- `games.started_at` and every `active_curses.started_at/expires_at` forward by
-- the paused duration. It did NOT shift the challenge-review deadline, which
-- 0048 derives from `cards.payload.submitted_at` (falling back to
-- `cards.updated_at`) and compares against wall-clock `now() - 120 s`. The
-- review sweep is correctly inert while paused
-- (resolve-challenge-reviews/route.ts), so the pause burned the window
-- silently: submit proof -> pause 200 s -> resume => submitted_at is 201 s old
-- and the next sweep auto-accepts with zero post-resume review time.
--
-- Semantics chosen: "the timer does not run during a pause" (RULEBOOK §13 — a
-- weather pause freezes play; it is not a way to gain or lose tempo). This
-- mirrors the existing curse-proof-window behaviour exactly and preserves the
-- reviewer's REMAINING time rather than resetting it to a fresh 120 s, so a
-- pause can be used neither to award nor to delay a challenge.
--
-- On `cards.updated_at`: `public.cards` has NO updated_at trigger (verified),
-- and for a pending challenge card `updated_at` is the submit instant, written
-- by `submit_challenge_review_atomic` (0023). So the shift must be explicit for
-- the 0048 legacy fallback to be corrected too — an UPDATE does not bump it by
-- itself, which is what we want: bumping it to now() would hand out a fresh
-- full window (the rejected option 2) instead of preserving the remainder.
-- Both timestamps are therefore moved by exactly the paused duration, and a
-- payload whose `submitted_at` is missing or unparseable is left alone so it
-- keeps falling back to the (now shifted) `updated_at`.

create or replace function public.weather_pause_vote_atomic(
  p_game_id uuid,
  p_team_id uuid,
  p_actor_player_id uuid,
  p_action text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_state jsonb;
  v_requested_by uuid;
  v_requested_at timestamptz;
  v_prior_status text;
  v_paused_at timestamptz;
  v_pause_seconds int;
begin
  if p_action not in ('pause', 'resume') then return jsonb_build_object('error', 'invalid_pause_action'); end if;
  select * into v_game from public.games where id = p_game_id for update;
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if not exists (select 1 from public.teams where id = p_team_id and game_id = p_game_id) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  v_state := coalesce(v_game.config->'weather_pause', '{}'::jsonb);
  if p_action = 'pause' then
    if v_game.status = 'paused' then return jsonb_build_object(
      'game', to_jsonb(v_game), 'action', p_action, 'pending', false,
      'applied', false, 'already_applied', true); end if;
    if v_game.status not in ('live', 'flag_found') then return jsonb_build_object('error', 'game_not_in_play'); end if;
  else
    if v_game.status <> 'paused' then
      if nullif(v_state->>'last_resumed_at', '') is not null then return jsonb_build_object(
        'game', to_jsonb(v_game), 'action', p_action, 'pending', false,
        'applied', false, 'already_applied', true); end if;
      return jsonb_build_object('error', 'game_not_paused');
    end if;
  end if;
  if v_state->>'proposal_action' = p_action then
    begin v_requested_by := nullif(v_state->>'requested_by_team_id', '')::uuid;
    exception when others then v_requested_by := null; end;
    begin v_requested_at := nullif(v_state->>'requested_at', '')::timestamptz;
    exception when others then v_requested_at := null; end;
  end if;
  if v_requested_by is not null and v_requested_by <> p_team_id
     and v_requested_at > now() - interval '5 minutes' then
    if p_action = 'pause' then
      v_state := jsonb_build_object(
        'prior_status', v_game.status, 'paused_at', now(),
        'requested_by_team_id', v_requested_by, 'confirmed_by_team_id', p_team_id);
      update public.games set status = 'paused',
        config = jsonb_set(config, '{weather_pause}', v_state, true)
      where id = p_game_id returning * into v_game;
      insert into public.events(game_id, type, actor_player_id, payload)
      values (p_game_id, 'game_paused', p_actor_player_id, jsonb_build_object(
        'requested_by_team_id', v_requested_by, 'confirmed_by_team_id', p_team_id,
        'prior_status', v_state->>'prior_status'));
    else
      v_prior_status := coalesce(nullif(v_state->>'prior_status', ''), 'live');
      if v_prior_status not in ('live', 'flag_found') then v_prior_status := 'live'; end if;
      v_paused_at := nullif(v_state->>'paused_at', '')::timestamptz;
      v_pause_seconds := greatest(0, floor(extract(epoch from (now() - v_paused_at)))::int);
      update public.active_curses
      set started_at = started_at + make_interval(secs => v_pause_seconds),
          expires_at = case when expires_at is null then null
            else expires_at + make_interval(secs => v_pause_seconds) end,
          params = coalesce(params, '{}'::jsonb) - 'weather_pause_seconds'
      where game_id = p_game_id;

      -- P11: the challenge-review deadline is a game-clock window too. Shift
      -- the submit instant of every still-pending challenge card forward by the
      -- paused duration so the reviewing team resumes with exactly the review
      -- time it had left. `/submit-challenge` is gated on status live/flag_found,
      -- so nothing can become pending during the pause; the `<= v_paused_at`
      -- guard is belt-and-braces against a malformed/injected future timestamp
      -- being handed extra time.
      if v_pause_seconds > 0 and v_paused_at is not null then
        update public.cards
        set payload = jsonb_set(
              payload,
              '{submitted_at}',
              to_jsonb(
                ((payload->>'submitted_at')::timestamptz)
                  + make_interval(secs => v_pause_seconds)
              ),
              true
            )
        where game_id = p_game_id
          and kind = 'challenge'
          and state = 'pending'
          and payload->>'submitted_at' is not null
          and pg_input_is_valid(payload->>'submitted_at', 'timestamptz')
          and (payload->>'submitted_at')::timestamptz <= v_paused_at;

        -- Legacy/malformed payloads fall back to updated_at in 0048, and for a
        -- pending challenge card updated_at IS the submit instant (0023). Move
        -- it by the same amount; deliberately NOT to now().
        update public.cards
        set updated_at = updated_at + make_interval(secs => v_pause_seconds)
        where game_id = p_game_id
          and kind = 'challenge'
          and state = 'pending'
          and updated_at <= v_paused_at;
      end if;

      v_state := jsonb_build_object(
        'last_resumed_at', now(), 'last_pause_seconds', v_pause_seconds,
        'requested_by_team_id', v_requested_by, 'confirmed_by_team_id', p_team_id);
      update public.games set status = v_prior_status,
        started_at = case when started_at is null then null
          else started_at + make_interval(secs => v_pause_seconds) end,
        config = jsonb_set(config, '{weather_pause}', v_state, true)
      where id = p_game_id returning * into v_game;
      insert into public.events(game_id, type, actor_player_id, payload)
      values (p_game_id, 'game_resumed', p_actor_player_id, jsonb_build_object(
        'requested_by_team_id', v_requested_by, 'confirmed_by_team_id', p_team_id,
        'restored_status', v_prior_status, 'pause_seconds', v_pause_seconds));
    end if;
    return jsonb_build_object('game', to_jsonb(v_game), 'action', p_action,
      'pending', false, 'applied', true, 'already_applied', false);
  end if;
  if v_requested_by is null or v_requested_by <> p_team_id or
     v_requested_at <= now() - interval '5 minutes' then
    v_requested_by := p_team_id; v_requested_at := now();
    v_state := v_state || jsonb_build_object(
      'proposal_action', p_action, 'requested_by_team_id', p_team_id,
      'requested_at', v_requested_at);
    update public.games set config = jsonb_set(config, '{weather_pause}', v_state, true)
    where id = p_game_id returning * into v_game;
  end if;
  return jsonb_build_object('game', to_jsonb(v_game), 'action', p_action,
    'pending', true, 'applied', false, 'already_applied', false,
    'requested_by_team_id', v_requested_by,
    'proposal_expires_at', v_requested_at + interval '5 minutes');
end;
$$;

revoke all on function public.weather_pause_vote_atomic(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.weather_pause_vote_atomic(uuid, uuid, uuid, text)
  to service_role;
