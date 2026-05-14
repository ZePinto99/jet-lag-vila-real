-- Migration 0007: add `respawning` flag to players.
--
-- Set to true when a player is tagged. Cleared when the player calls
-- /api/games/[id]/respawn-clear while standing within 30 m of any neutral
-- landmark. While respawning the player cannot tag others or attempt enemy
-- flags.

alter table players add column if not exists respawning boolean not null default false;
