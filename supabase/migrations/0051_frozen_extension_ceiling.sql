-- Migration 0051 — finding P5 (balance): Frozen punished honesty by 4x.
--
-- Frozen (curse.frozen, RULEBOOK §12) is nominally 8 min / 480 s and requires
-- staying within 10 m of an anchor. The CURSED team's own client self-reports
-- its violations every 2 s, and 0027 extended expiry 1:1 per reported second up
-- to `p_nominal_duration_seconds * p_max_extension_factor`. With the caller
-- passing 4, the measured ceiling was 1920 s = 32.0 min, while a player who
-- simply closes the app reports nothing, never anchors, and serves exactly the
-- nominal 480 s. Honesty therefore cost up to 1440 s (24 min) — a 4x
-- differential strictly in favour of not cooperating, which also contradicts
-- useCurseEnforcement's own stated policy that movement curses carry no
-- automated penalty because GPS noise would punish unfairly.
--
-- Fix: keep the mechanism (the per-second dedupe and the first-write-wins
-- anchor are correct and worth keeping — Frozen should not be free to ignore),
-- but clamp the EFFECTIVE extension factor to at most 1.5x. 480 s -> at most
-- 720 s, i.e. +4 min rather than +24 min. The honesty penalty drops from 24 min
-- to 4 min while a wanderer still pays for wandering.
--
-- The clamp lives in the RPC, not the caller, so the ceiling holds regardless of
-- what any route passes. `app/api/games/[id]/extend-curse/route.ts` still sends
-- MAX_EXTENSION_FACTOR = 4; that is now inert (the RPC narrows it) and should be
-- lowered to match by whoever owns the route layer.
--
-- Note the type change: the factor is now applied as numeric so 1.5 is not
-- truncated to 1. The parameter stays `int` to keep the signature (and its
-- grants) identical for existing callers.
--
-- Unchanged, and re-verified after this migration: reporting a violation with no
-- anchor still raises `frozen_anchor_required`; the anchor is still
-- first-write-wins via `on conflict do nothing`; violation seconds are still
-- deduplicated into one bucket per wall-clock second.

create or replace function public.report_frozen_state(
  p_game_id uuid, p_curse_id uuid, p_player_id uuid,
  p_anchor_lat double precision, p_anchor_lng double precision,
  p_violation_start timestamptz, p_violation_end timestamptz,
  p_nominal_duration_seconds int, p_max_extension_factor int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_curse public.active_curses%rowtype; v_anchor public.frozen_player_anchors%rowtype;
  v_start timestamptz; v_end timestamptz; v_added int := 0; v_total int := 0;
  v_expires_at timestamptz;
  -- P5: hard ceiling on how far self-reported violations may stretch Frozen.
  v_max_factor constant numeric := 1.5;
  v_factor numeric;
begin
  if p_nominal_duration_seconds < 1 or p_max_extension_factor < 1 then raise exception 'invalid_frozen_duration'; end if;
  -- Clamp here rather than trusting the caller, so no route (or direct
  -- service_role call) can reinstate the 4x ceiling.
  v_factor := least(p_max_extension_factor::numeric, v_max_factor);
  perform pg_advisory_xact_lock(hashtextextended(p_curse_id::text || ':frozen', 0));
  select * into v_curse from public.active_curses
  where id = p_curse_id and game_id = p_game_id and curse_ref = 'curse.frozen' for update;
  if not found then raise exception 'frozen_curse_not_found'; end if;
  if not exists (select 1 from public.players p join public.teams t on t.id=p.team_id
    where p.id=p_player_id and t.game_id=p_game_id and p.team_id=v_curse.target_team_id)
  then raise exception 'frozen_player_forbidden'; end if;
  if p_anchor_lat is not null and p_anchor_lng is not null then
    insert into public.frozen_player_anchors(curse_id,player_id,lat,lng)
    values(p_curse_id,p_player_id,p_anchor_lat,p_anchor_lng) on conflict do nothing;
  end if;
  select * into v_anchor from public.frozen_player_anchors
  where curse_id=p_curse_id and player_id=p_player_id;
  if not found then raise exception 'frozen_anchor_required'; end if;
  if p_violation_start is not null or p_violation_end is not null then
    if p_violation_start is null or p_violation_end is null then raise exception 'invalid_frozen_interval'; end if;
    v_start:=greatest(p_violation_start,v_curse.started_at); v_end:=least(p_violation_end,clock_timestamp());
    if v_end>v_start then
      insert into public.frozen_violation_seconds(curse_id,second_at)
      select p_curse_id,tick from generate_series(date_trunc('second',v_start),
        date_trunc('second',v_end-interval '1 millisecond'),interval '1 second') tick
      on conflict do nothing; get diagnostics v_added=row_count;
    end if;
  end if;
  select count(*) into v_total from public.frozen_violation_seconds where curse_id=p_curse_id;
  v_expires_at:=least(
    v_curse.started_at+make_interval(secs=>p_nominal_duration_seconds*v_factor),
    v_curse.started_at+make_interval(secs=>p_nominal_duration_seconds+v_total));
  update public.active_curses set expires_at=v_expires_at where id=p_curse_id;
  return jsonb_build_object('anchor',jsonb_build_object('lat',v_anchor.lat,'lng',v_anchor.lng),
    'added_seconds',v_added,'total_violation_seconds',v_total,'expires_at',v_expires_at,
    -- Surfaced so the client can show an honest ceiling instead of implying the
    -- curse can grow without limit.
    'max_duration_seconds',floor(p_nominal_duration_seconds*v_factor)::int);
end;
$$;

revoke all on function public.report_frozen_state(
  uuid, uuid, uuid, double precision, double precision, timestamptz, timestamptz, int, int
) from public, anon, authenticated;
grant execute on function public.report_frozen_state(
  uuid, uuid, uuid, double precision, double precision, timestamptz, timestamptz, int, int
) to service_role;
