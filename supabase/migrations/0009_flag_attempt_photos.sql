-- Migration 0009: storage bucket for flag-attempt photos (PLAYTEST_TRIAGE P2-1).
--
-- The flag-attempt mini-challenge now requires a real photo upload. Photos are
-- stored in a public bucket so the opposing team can eyeball/dispute them; the
-- photos table (migration 0001) already records the URL + GPS + player.
--
-- Anon clients upload directly (no auth layer in v1), so we add permissive
-- insert/select policies scoped to this one bucket. This is consistent with the
-- v1 security posture (anon SELECT is already open); tighten alongside the
-- v1.1 anonymous-auth work if/when it lands.

insert into storage.buckets (id, name, public)
values ('flag-attempts', 'flag-attempts', true)
on conflict (id) do nothing;

-- Public read (bucket is public, but an explicit SELECT policy keeps the REST
-- listing working for the dispute view).
drop policy if exists "flag_attempts_read" on storage.objects;
create policy "flag_attempts_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'flag-attempts');

-- Anyone in a game can upload a flag-attempt photo.
drop policy if exists "flag_attempts_insert" on storage.objects;
create policy "flag_attempts_insert"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'flag-attempts');
