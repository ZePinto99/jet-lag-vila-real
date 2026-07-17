-- Migration 0012: storage bucket for challenge-proof photos (playtest item D14).
--
-- Photo challenges now go through peer review: the submitting team uploads a
-- proof photo, and the OTHER team accepts or rejects it before coins are
-- credited. Photos live in a public bucket so the reviewing team can eyeball
-- them (same posture as the flag-attempts bucket in migration 0009).
--
-- Anon clients upload directly (no auth layer in v1). Tighten alongside the
-- v1.1 anonymous-auth work if/when it lands.

insert into storage.buckets (id, name, public)
values ('challenge-photos', 'challenge-photos', true)
on conflict (id) do nothing;

drop policy if exists "challenge_photos_read" on storage.objects;
create policy "challenge_photos_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'challenge-photos');

drop policy if exists "challenge_photos_insert" on storage.objects;
create policy "challenge_photos_insert"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'challenge-photos');
