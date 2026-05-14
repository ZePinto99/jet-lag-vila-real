-- Migration 0002: post-design adjustments
-- 1. Remove captain role (all players are equal)
-- 2. Add game.code for human-readable join codes
-- 3. Add players.flag_carrier and players.ready
-- 4. Add teams.side (west|east), unique per game
-- 5. Extend game status with setup + flag_found

-- Captain role removed
alter table players drop constraint players_role_check;
update players set role = 'player' where role = 'captain';
alter table players add constraint players_role_check check (role in ('player'));

-- Human-readable join code (4 letters, unique across all games)
alter table games add column if not exists code text;
create unique index if not exists games_code_unique on games(code) where code is not null;

-- Per-player runtime flags
alter table players add column if not exists flag_carrier boolean not null default false;
alter table players add column if not exists ready boolean not null default false;

-- Team side (west or east); exactly one of each per game
alter table teams add column if not exists side text;
alter table teams add constraint teams_side_check check (side in ('west', 'east'));
create unique index if not exists teams_game_side_unique on teams(game_id, side) where side is not null;

-- Extend game status enum with setup + flag_found
alter table games drop constraint games_status_check;
alter table games add constraint games_status_check
  check (status in ('lobby', 'setup', 'live', 'flag_found', 'paused', 'finished'));
