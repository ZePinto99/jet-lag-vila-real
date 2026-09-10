-- Migration 0017: durable Frozen anchors and overlap-safe violation accounting.
--
-- Every cursed player gets one immutable anchor per Frozen cast. Violation
-- time is stored as unique one-second buckets per curse (not per player), so
-- two teammates wandering during the same interval pause the shared clock once
-- rather than multiplying its expiry. The RPC owns the transaction and row
-- lock; browser retries and concurrent phones are safe.

create table if not exists public.frozen_player_anchors (
  curse_id uuid not null references public.active_curses(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  created_at timestamptz not null default now(),
  primary key (curse_id, player_id)
);

create table if not exists public.frozen_violation_seconds (
  curse_id uuid not null references public.active_curses(id) on delete cascade,
  second_at timestamptz not null,
  primary key (curse_id, second_at)
);

alter table public.frozen_player_anchors enable row level security;
alter table public.frozen_violation_seconds enable row level security;

create or replace function public.report_frozen_state(
  p_game_id uuid,
  p_curse_id uuid,
  p_player_id uuid,
  p_anchor_lat double precision,
  p_anchor_lng double precision,
  p_violation_start timestamptz,
  p_violation_end timestamptz,
  p_nominal_duration_seconds int,
  p_max_extension_factor int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_curse public.active_curses%rowtype;
  v_anchor public.frozen_player_anchors%rowtype;
  v_start timestamptz;
  v_end timestamptz;
  v_added int := 0;
  v_total int := 0;
  v_expires_at timestamptz;
begin
  if p_nominal_duration_seconds < 1 or p_max_extension_factor < 1 then
    raise exception 'invalid_frozen_duration';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_curse_id::text || ':frozen', 0));

  select * into v_curse
  from public.active_curses
  where id = p_curse_id
    and game_id = p_game_id
    and curse_ref = 'curse.frozen'
  for update;
  if not found then raise exception 'frozen_curse_not_found'; end if;

  if not exists (
    select 1
    from public.players p
    join public.teams t on t.id = p.team_id
    where p.id = p_player_id
      and t.game_id = p_game_id
      and p.team_id = v_curse.target_team_id
  ) then
    raise exception 'frozen_player_forbidden';
  end if;

  if p_anchor_lat is not null and p_anchor_lng is not null then
    insert into public.frozen_player_anchors(curse_id, player_id, lat, lng)
    values (p_curse_id, p_player_id, p_anchor_lat, p_anchor_lng)
    on conflict (curse_id, player_id) do nothing;
  end if;

  select * into v_anchor
  from public.frozen_player_anchors
  where curse_id = p_curse_id and player_id = p_player_id;
  if not found then raise exception 'frozen_anchor_required'; end if;

  if p_violation_start is not null or p_violation_end is not null then
    if p_violation_start is null or p_violation_end is null then
      raise exception 'invalid_frozen_interval';
    end if;
    v_start := greatest(p_violation_start, v_curse.started_at);
    v_end := least(p_violation_end, clock_timestamp());
    if v_end > v_start then
      insert into public.frozen_violation_seconds(curse_id, second_at)
      select p_curse_id, tick
      from generate_series(
        date_trunc('second', v_start),
        date_trunc('second', v_end - interval '1 millisecond'),
        interval '1 second'
      ) as tick
      on conflict (curse_id, second_at) do nothing;
      get diagnostics v_added = row_count;
    end if;
  end if;

  select count(*) into v_total
  from public.frozen_violation_seconds
  where curse_id = p_curse_id;

  v_expires_at := least(
    v_curse.started_at + make_interval(secs => p_nominal_duration_seconds * p_max_extension_factor),
    v_curse.started_at + make_interval(secs => p_nominal_duration_seconds + v_total)
  );
  update public.active_curses
  set expires_at = v_expires_at
  where id = p_curse_id;

  return jsonb_build_object(
    'anchor', jsonb_build_object('lat', v_anchor.lat, 'lng', v_anchor.lng),
    'added_seconds', v_added,
    'total_violation_seconds', v_total,
    'expires_at', v_expires_at
  );
end;
$$;

revoke all on table public.frozen_player_anchors from anon, authenticated;
revoke all on table public.frozen_violation_seconds from anon, authenticated;
revoke all on function public.report_frozen_state(
  uuid, uuid, uuid, double precision, double precision,
  timestamptz, timestamptz, int, int
) from public, anon, authenticated;
grant execute on function public.report_frozen_state(
  uuid, uuid, uuid, double precision, double precision,
  timestamptz, timestamptz, int, int
) to service_role;
