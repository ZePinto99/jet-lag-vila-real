-- Migration 0011: web push subscriptions (lock-screen notifications).
--
-- Stores one row per (browser endpoint) so the server can fan out best-effort
-- Web Push notifications to a team or a set of players. The browser obtains a
-- PushSubscription via the Push API and POSTs it to /push-subscribe; the
-- server persists endpoint + the two encryption keys (p256dh, auth).
--
-- Like placed_curses (0010), this table:
--   * has RLS enabled with NO anon policies — only the service-role server
--     (lib/supabase/admin.ts) reads/writes it, and
--   * is deliberately NOT added to publication supabase_realtime (no broadcast).
-- Push endpoints are not secret game state but there's no reason for any anon
-- client to read or mutate them, so we lock it down by default.

create table if not exists push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid references games(id) on delete cascade,
  player_id   uuid references players(id) on delete cascade,
  team_id     uuid,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz default now()
);

create index if not exists push_subscriptions_game_team_idx
  on push_subscriptions(game_id, team_id);

alter table push_subscriptions enable row level security;
-- No policies: anon clients get nothing; the service-role server bypasses RLS.
-- (Intentionally NOT added to publication supabase_realtime.)
