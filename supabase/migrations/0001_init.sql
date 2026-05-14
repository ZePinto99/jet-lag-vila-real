-- Jet Lag: Vila Real — initial schema
-- Implements the data model needed for the referee responsibilities in
-- RULEBOOK.md §12 (geofencing, append-only ledger, flag adjudication, curse
-- enforcement, camping limits, intel state, hidden secret state, full timeline).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- games
-- ---------------------------------------------------------------------------
create table if not exists games (
  id          uuid primary key default gen_random_uuid(),
  status      text not null default 'lobby'
              check (status in ('lobby', 'live', 'paused', 'finished')),
  config      jsonb not null default '{}'::jsonb,
  started_at  timestamptz,
  ended_at    timestamptz,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- teams
-- ---------------------------------------------------------------------------
create table if not exists teams (
  id                uuid primary key default gen_random_uuid(),
  game_id           uuid not null references games(id) on delete cascade,
  name              text not null,
  home_landmark_id  text,
  coins             int  not null default 100,
  created_at        timestamptz not null default now()
);

create index if not exists teams_game_id_idx on teams(game_id);

-- ---------------------------------------------------------------------------
-- players
-- ---------------------------------------------------------------------------
create table if not exists players (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references teams(id) on delete cascade,
  display_name  text not null,
  role          text not null check (role in ('captain', 'player')),
  device_id     text,
  created_at    timestamptz not null default now()
);

create index if not exists players_team_id_idx on players(team_id);

-- ---------------------------------------------------------------------------
-- landmarks (per-game state; the seed catalog lives in /data/landmarks.json)
-- ---------------------------------------------------------------------------
create table if not exists landmarks (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references games(id) on delete cascade,
  ref         text not null,
  lat         double precision not null,
  lng         double precision not null,
  team_id     uuid references teams(id) on delete set null,
  kind        text not null
              check (kind in ('flag_real', 'flag_decoy', 'flag_empty', 'home', 'neutral')),
  hardened    boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists landmarks_game_id_idx on landmarks(game_id);
create index if not exists landmarks_game_team_idx on landmarks(game_id, team_id);

-- ---------------------------------------------------------------------------
-- cards (challenges, curses, intel — per-team state)
-- ---------------------------------------------------------------------------
create table if not exists cards (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references games(id) on delete cascade,
  team_id     uuid not null references teams(id) on delete cascade,
  kind        text not null check (kind in ('challenge', 'curse', 'intel')),
  ref         text not null,
  state       text not null
              check (state in ('available', 'in_hand', 'active', 'consumed', 'expired')),
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists cards_game_team_state_idx on cards(game_id, team_id, state);

-- ---------------------------------------------------------------------------
-- events (append-only source of truth)
-- ---------------------------------------------------------------------------
create table if not exists events (
  id               uuid primary key default gen_random_uuid(),
  game_id          uuid not null references games(id) on delete cascade,
  type             text not null,
  actor_player_id  uuid references players(id) on delete set null,
  payload          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);

create index if not exists events_game_created_idx on events(game_id, created_at);

-- Append-only guard: block updates and deletes on the events table.
create or replace function events_block_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'events table is append-only';
end;
$$;

drop trigger if exists events_no_update on events;
create trigger events_no_update
  before update on events
  for each row execute function events_block_mutation();

drop trigger if exists events_no_delete on events;
create trigger events_no_delete
  before delete on events
  for each row execute function events_block_mutation();

-- ---------------------------------------------------------------------------
-- photos (flag attempts, challenge proofs, curse compliance)
-- ---------------------------------------------------------------------------
create table if not exists photos (
  id              uuid primary key default gen_random_uuid(),
  game_id         uuid not null references games(id) on delete cascade,
  player_id       uuid not null references players(id) on delete cascade,
  url             text not null,
  lat             double precision,
  lng             double precision,
  taken_at        timestamptz,
  kind            text not null
                  check (kind in ('flag_attempt', 'challenge', 'curse_proof', 'other')),
  related_card_id uuid references cards(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists photos_game_taken_idx on photos(game_id, taken_at);

-- ---------------------------------------------------------------------------
-- active_curses (currently-running curses on a team)
-- ---------------------------------------------------------------------------
create table if not exists active_curses (
  id              uuid primary key default gen_random_uuid(),
  game_id         uuid not null references games(id) on delete cascade,
  target_team_id  uuid not null references teams(id) on delete cascade,
  curse_ref       text not null,
  started_at      timestamptz not null default now(),
  expires_at      timestamptz,
  params          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists active_curses_game_team_expires_idx
  on active_curses(game_id, target_team_id, expires_at);

-- ---------------------------------------------------------------------------
-- tags (raider intercepted by defender)
-- ---------------------------------------------------------------------------
create table if not exists tags (
  id                  uuid primary key default gen_random_uuid(),
  game_id             uuid not null references games(id) on delete cascade,
  raider_player_id    uuid not null references players(id) on delete cascade,
  defender_player_id  uuid not null references players(id) on delete cascade,
  lat                 double precision not null,
  lng                 double precision not null,
  created_at          timestamptz not null default now()
);

create index if not exists tags_game_id_idx on tags(game_id);
