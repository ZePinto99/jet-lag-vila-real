-- Migration 0029: durable, private proof photos for [B] curses.
-- Files are uploaded only by the service-role submit route. There are no
-- client Storage policies and no readable object paths in public events.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'curse-proofs',
  'curse-proofs',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "curse_proofs_insert" on storage.objects;
drop policy if exists "curse_proofs_read" on storage.objects;

create table if not exists public.curse_proofs (
  id              uuid primary key default gen_random_uuid(),
  game_id         uuid not null references public.games(id) on delete cascade,
  curse_id        uuid not null,
  curse_ref       text not null,
  target_team_id  uuid not null references public.teams(id) on delete cascade,
  prompt_index    integer not null check (prompt_index >= 0),
  submitted_by    uuid not null references public.players(id) on delete cascade,
  object_path     text not null,
  submitted_at    timestamptz not null default now(),
  unique (curse_id, prompt_index),
  unique (object_path)
);

create index if not exists curse_proofs_game_team_idx
  on public.curse_proofs(game_id, target_team_id, submitted_at desc);

alter table public.curse_proofs enable row level security;
-- Intentionally no anon/authenticated table policies. The live-state route
-- returns only path-free receipts to the affected team.

create or replace function public.submit_curse_proof_atomic(
  p_game_id uuid,
  p_curse_id uuid,
  p_target_team_id uuid,
  p_prompt_index integer,
  p_submitted_by uuid,
  p_object_path text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_curse public.active_curses%rowtype;
  v_proof public.curse_proofs%rowtype;
begin
  select * into v_curse
  from public.active_curses
  where id = p_curse_id
    and game_id = p_game_id
    and target_team_id = p_target_team_id
    and (expires_at is null or expires_at > now())
  for update;

  if not found then
    return jsonb_build_object('error', 'curse_not_active');
  end if;

  if not exists (
    select 1
    from public.players p
    join public.teams t on t.id = p.team_id
    where p.id = p_submitted_by
      and p.team_id = p_target_team_id
      and t.game_id = p_game_id
  ) then
    return jsonb_build_object('error', 'forbidden');
  end if;

  insert into public.curse_proofs(
    game_id, curse_id, curse_ref, target_team_id,
    prompt_index, submitted_by, object_path
  ) values (
    p_game_id, p_curse_id, v_curse.curse_ref, p_target_team_id,
    p_prompt_index, p_submitted_by, p_object_path
  )
  on conflict (curse_id, prompt_index) do nothing
  returning * into v_proof;

  if not found then
    return jsonb_build_object('error', 'proof_already_submitted');
  end if;

  insert into public.events(game_id, type, actor_player_id, payload)
  values (
    p_game_id,
    'curse_proof_submitted',
    p_submitted_by,
    jsonb_build_object(
      'curse_id', p_curse_id,
      'curse_ref', v_curse.curse_ref,
      'target_team_id', p_target_team_id,
      'prompt_index', p_prompt_index,
      'submitted_by_player_id', p_submitted_by
    )
  );

  return jsonb_build_object('proof', to_jsonb(v_proof) - 'object_path');
end;
$$;
