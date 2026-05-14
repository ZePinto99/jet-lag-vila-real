-- Migration 0008: RLS baseline.
--
-- v1 goal: prevent clients from bypassing the API routes' validation by
-- writing directly to the DB with the anon key. Reads stay open so the
-- Realtime postgres_changes subscriptions keep working (they run as `anon`
-- and need SELECT to broadcast change events).
--
-- All server mutations go through API routes using the service-role key,
-- which bypasses RLS entirely. No changes needed there.
--
-- v1.1 hardening path (documented in CLAUDE.md):
--   - Enable Supabase anonymous auth on join, link players.device_id ↔
--     auth.users.id, then tighten SELECT policies so:
--       * landmarks: a team can only read its own kind/hardened
--       * cards: a team can only read its own payload
--       * events: payloads with secrets are redacted client-side via
--         curated broadcast channel instead of postgres_changes
--   - Move all photo URLs into a private Supabase Storage bucket with
--     per-team signed URLs.

alter table games          enable row level security;
alter table teams          enable row level security;
alter table players        enable row level security;
alter table landmarks      enable row level security;
alter table cards          enable row level security;
alter table events         enable row level security;
alter table photos         enable row level security;
alter table active_curses  enable row level security;
alter table tags           enable row level security;

-- Permissive public-read policies. The Realtime publication checks SELECT
-- permission per row before broadcasting change events; without these,
-- postgres_changes goes silent.
create policy "anon_read_games"         on games         for select using (true);
create policy "anon_read_teams"         on teams         for select using (true);
create policy "anon_read_players"       on players       for select using (true);
create policy "anon_read_landmarks"     on landmarks     for select using (true);
create policy "anon_read_cards"         on cards         for select using (true);
create policy "anon_read_events"        on events        for select using (true);
create policy "anon_read_photos"        on photos        for select using (true);
create policy "anon_read_active_curses" on active_curses for select using (true);
create policy "anon_read_tags"          on tags          for select using (true);

-- No INSERT / UPDATE / DELETE policies are added. With RLS on and no
-- granting policy, the anon role cannot mutate any row. The service-role
-- key (used exclusively by API routes via lib/supabase/admin.ts) bypasses
-- RLS, so server-side writes are unaffected.
