-- Migration 0005: relax the append-only guard on events so that the FK cascade
-- from players.id (events.actor_player_id ON DELETE SET NULL) can fire.
--
-- The semantic invariant we want is: events.type and events.payload are
-- immutable, no event can be deleted, and the actor FK may be nulled when the
-- referenced player is deleted. The existing trigger blocked ALL updates,
-- which prevented player deletion entirely.

create or replace function events_block_mutation() returns trigger
language plpgsql as $$
begin
  -- DELETE: never allowed.
  if tg_op = 'DELETE' then
    raise exception 'events table is append-only (delete forbidden)';
  end if;

  -- UPDATE: allow only the actor_player_id FK cascade to NULL. Every other
  -- column must remain unchanged.
  if tg_op = 'UPDATE' then
    if new.id          is distinct from old.id          then raise exception 'events.id is immutable'; end if;
    if new.game_id     is distinct from old.game_id     then raise exception 'events.game_id is immutable'; end if;
    if new.type        is distinct from old.type        then raise exception 'events.type is immutable'; end if;
    if new.payload     is distinct from old.payload     then raise exception 'events.payload is immutable'; end if;
    if new.created_at  is distinct from old.created_at  then raise exception 'events.created_at is immutable'; end if;
    -- actor_player_id may change, but only from non-null to null (the cascade case).
    if not (old.actor_player_id is not null and new.actor_player_id is null) then
      raise exception 'events.actor_player_id can only be cleared by FK cascade';
    end if;
  end if;

  return new;
end;
$$;
