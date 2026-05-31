-- Migration 0010: placed curses (PLAYTEST_TRIAGE P2-2).
--
-- A team places a curse on one of its OWN candidate landmarks; it lies armed
-- and HIDDEN until an enemy enters that landmark's defense zone, then triggers
-- on the intruder's team and is consumed.
--
-- Secrecy is the whole point: a team usually places on its real flag, so the
-- placement must never reach the enemy. Therefore this table:
--   * has RLS enabled with NO anon policies (only the service-role server
--     reads it — same hidden model as landmarks.kind), and
--   * is deliberately NOT added to the supabase_realtime publication, so no
--     postgres_changes broadcast can leak it.
-- The owning team sees its own placements via the live-state API (server-side).
-- Only the *trigger* is public (it becomes an ordinary curse the victim sees).

create table if not exists placed_curses (
  id                   uuid primary key default gen_random_uuid(),
  game_id              uuid not null references games(id) on delete cascade,
  owner_team_id        uuid not null references teams(id) on delete cascade,
  landmark_ref         text not null,
  placed_ref           text not null,          -- id in data/placed-curses.json
  curse_ref            text not null,          -- curse cast on the intruder's team
  armed                boolean not null default true,
  created_at           timestamptz not null default now(),
  triggered_at         timestamptz,
  triggered_by_team_id uuid references teams(id) on delete set null
);

create index if not exists placed_curses_game_owner_idx
  on placed_curses(game_id, owner_team_id);
create index if not exists placed_curses_game_armed_idx
  on placed_curses(game_id, armed);

-- One armed placement per landmark per owner (re-placing requires the previous
-- to have triggered). Partial unique index keyed on armed = true.
create unique index if not exists placed_curses_one_armed_per_landmark
  on placed_curses(game_id, owner_team_id, landmark_ref)
  where armed;

alter table placed_curses enable row level security;
-- No policies: anon clients get nothing; the service-role server bypasses RLS.
-- (Intentionally NOT added to publication supabase_realtime.)
