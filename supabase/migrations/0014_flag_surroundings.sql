-- Migration 0014: private setup-time surroundings photos for I7 intel.
--
-- A team uploads one surroundings photo for its real-flag landmark during
-- setup. The object must not be public: only the server-side buy-intel route
-- reads this table and creates a short-lived signed URL after the opposing
-- team purchases intel.surroundings.

insert into storage.buckets (id, name, public)
values ('surroundings-photos', 'surroundings-photos', false)
on conflict (id) do update set public = false;

-- v1 uses device ids rather than Supabase Auth, so setup clients upload
-- directly. There is deliberately NO SELECT policy: private objects can only
-- be read through a server-generated signed URL.
drop policy if exists "surroundings_photos_insert" on storage.objects;
create policy "surroundings_photos_insert"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'surroundings-photos');

drop policy if exists "surroundings_photos_read" on storage.objects;

create table if not exists public.flag_surroundings (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games(id) on delete cascade,
  team_id      uuid not null references public.teams(id) on delete cascade,
  landmark_id  uuid not null references public.landmarks(id) on delete cascade,
  uploaded_by  uuid not null references public.players(id) on delete cascade,
  object_path  text not null,
  created_at   timestamptz not null default now(),
  unique (game_id, team_id),
  unique (landmark_id)
);

create index if not exists flag_surroundings_game_team_idx
  on public.flag_surroundings(game_id, team_id);

alter table public.flag_surroundings enable row level security;

-- Intentionally no anon/authenticated table policies. All reads and writes
-- go through service-role API routes so setup paths cannot leak via REST.
