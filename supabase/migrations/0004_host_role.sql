-- Migration 0004: add a host marker to players.
-- The first player in a game (the creator) is the host. Only the host can
-- remove other players; the host role auto-transfers if the current host
-- leaves while other players remain.
--
-- Exactly one host per game is enforced by a trigger (a partial unique index
-- cannot be expressed because is_host's scope spans players->teams->games).

alter table players add column if not exists is_host boolean not null default false;

create or replace function players_enforce_single_host() returns trigger
language plpgsql as $$
declare
  v_game_id uuid;
  v_count   int;
begin
  if new.is_host is not true then
    return new;
  end if;
  select t.game_id into v_game_id from teams t where t.id = new.team_id;
  select count(*) into v_count
    from players p
    join teams  t on t.id = p.team_id
    where t.game_id = v_game_id
      and p.is_host = true
      and p.id <> new.id;
  if v_count > 0 then
    raise exception 'a game can have at most one host';
  end if;
  return new;
end;
$$;

drop trigger if exists players_single_host_check on players;
create trigger players_single_host_check
  before insert or update on players
  for each row execute function players_enforce_single_host();
