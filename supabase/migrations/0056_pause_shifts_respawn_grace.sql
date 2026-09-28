-- Migration 0056 (findings P7 + P4): a weather pause must not be charged to a
-- tagged player's respawn grace period.
--
-- Recreated from the live weather_pause_vote_atomic (0050) with ONE addition in
-- the resume branch: shift `players.respawning_since` forward by the paused
-- duration, alongside the existing shifts of games.started_at,
-- active_curses.started_at/expires_at, and the pending challenge-review
-- deadline. Everything else is byte-identical to 0050.
--
-- Why it matters: 0055 added the respawning_since column and a 10-minute
-- grace-period sweep, but no shift here. Paused time therefore counted against
-- the grace the player was owed. Verified empirically before the fix — a real
-- 3-second pause aged a respawn from 120 s to 123 s — so a pause longer than the
-- player's remaining grace released them for free, skipping the walk the tag was
-- supposed to cost them.

CREATE OR REPLACE FUNCTION public.weather_pause_vote_atomic(p_game_id uuid, p_team_id uuid, p_actor_player_id uuid, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

      -- P7/P4 (migration 0056): the respawn grace period is a game-clock
      -- window too, and 0055 forgot it. `respawning_since` drives the 10-minute
      -- sweep in sweep_stuck_respawns, but nothing shifted it on resume — so a
      -- pause was CHARGED to the tagged player: paused wall clock counted
      -- against the grace they were owed, and a long enough pause consumed it
      -- entirely and released them without the walk. Measured before this fix: a
      -- real 3 s pause moved a respawn's age from 120 s to 123 s.
      --
      -- This is structurally the same defect 0050 fixed for the review window,
      -- reintroduced by the newer migration. 0055's own comment reasoned that
      -- the sweep may skip paused games "because 0027/0050 shift every other
      -- deadline forward on resume" — that premise was false for this column
      -- until now.
      if v_pause_seconds > 0 then
        update public.players p
        set respawning_since = p.respawning_since
                               + make_interval(secs => v_pause_seconds)
        from public.teams t
        where t.id = p.team_id
          and t.game_id = p_game_id
          and p.respawning
          and p.respawning_since is not null;
      end if;

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
$function$

