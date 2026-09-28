-- Migration 0053 (finding P2): a tag strips the flag from a carrier.
--
-- RULEBOOK §6 now states that tagging the flag carrier ends their run. Until
-- this migration, `players.flag_carrier` was set in two places (0018:81 real-flag
-- adjudication, 0026:124 two-stage respawn variant) and cleared NOWHERE in the
-- repository — no `set flag_carrier = false` existed at all. The consequence,
-- measured in tools/sim/scenario-races.mjs: a tagged carrier walked to their
-- neutral landmark, cleared respawn, and still won while flagged, so the game's
-- only physical mechanic could not answer a successful raid.
--
-- Why this function: apply_tag_atomic_unchecked is the shared per-raider body
-- invoked by BOTH the single-target and bulk (apply_tags_atomic) paths, so
-- clearing the flag here covers every legal tag exactly once. Doing it in the
-- callers would need the same logic twice and could drift.
--
-- Why unconditionally, with no defense-zone test: tagging ALREADY requires the
-- tagger to stand inside their own defense zone — enforced at
-- app/api/games/[id]/tag/route.ts:185 (409 tagger_not_in_defense_zone) and
-- mirrored client-side in lib/hooks/useTagButton.ts:76. So "strip only inside
-- your own zone" is not a narrower rule than "strip on any legal tag"; every
-- legal tag already satisfies it, and adding a second zone check here would
-- imply a condition that does not exist.
--
-- The flag_found game status is deliberately NOT reverted. The raider's photo
-- genuinely validated and still scores (+10, lib/results/scoring.ts), and the
-- enemy flag stays discovered — what the tag removes is this player's ability to
-- complete the run. Another raider must photograph it again to carry it.
--
-- A dedicated event is emitted so the client can tell the player their run
-- ended, rather than silently discovering it at the home base. The events table
-- is append-only (trigger events_no_update); this only ever inserts.

create or replace function public.apply_tag_atomic_unchecked(
  p_game_id uuid,
  p_raider_player_id uuid,
  p_defender_player_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_respawn_target_ref text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raider public.players%rowtype;
  v_was_carrier boolean;
begin
  select * into v_raider from public.players
  where id = p_raider_player_id for update;
  if not found or v_raider.respawning then return false; end if;
  if nullif(p_respawn_target_ref, '') is null then
    raise exception 'respawn_target_required';
  end if;

  -- Captured before the update so the event payload and the caller's response
  -- can distinguish "tagged a carrier" from "tagged an ordinary raider".
  v_was_carrier := coalesce(v_raider.flag_carrier, false);

  insert into public.tags(game_id, raider_player_id, defender_player_id, lat, lng)
  values (p_game_id, p_raider_player_id, p_defender_player_id, p_lat, p_lng);
  update public.players set
    respawning = true,
    respawn_target_ref = p_respawn_target_ref,
    respawn_arrived = false,
    -- P2: the strip. Always false after a tag, so an ordinary raider is
    -- unaffected and a carrier loses the run.
    flag_carrier = false
  where id = p_raider_player_id;

  insert into public.events(game_id, type, actor_player_id, payload)
  values (p_game_id, 'tag', p_defender_player_id,
    jsonb_build_object(
      'raider_player_id', p_raider_player_id,
      'defender_player_id', p_defender_player_id,
      'lat', p_lat, 'lng', p_lng,
      'respawn_target_ref', p_respawn_target_ref,
      'stripped_flag_carrier', v_was_carrier
    ));
  insert into public.events(game_id, type, actor_player_id, payload)
  values (p_game_id, 'player_respawning_set', p_defender_player_id,
    jsonb_build_object(
      'player_id', p_raider_player_id,
      'team_id', v_raider.team_id,
      'respawn_target_ref', p_respawn_target_ref
    ));

  -- Only on an actual strip, so clients can surface it without filtering every
  -- ordinary tag.
  if v_was_carrier then
    insert into public.events(game_id, type, actor_player_id, payload)
    values (p_game_id, 'flag_carrier_stripped', p_defender_player_id,
      jsonb_build_object(
        'player_id', p_raider_player_id,
        'team_id', v_raider.team_id,
        'defender_player_id', p_defender_player_id
      ));
  end if;

  return true;
end;
$$;
