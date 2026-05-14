-- Migration 0006: drop the hard DELETE guard on events.
--
-- The original trigger from migration 0001 blocked every DELETE, including
-- legitimate FK cascades from games.id (the parent) when an empty lobby is
-- cleaned up. Postgres cannot portably distinguish a user-issued DELETE from
-- a cascade-triggered one inside a trigger, so we drop the delete guard and
-- rely on application convention (no app code deletes events).
--
-- The UPDATE guard from migration 0005 stays: events.type, payload, and
-- created_at remain immutable.

drop trigger if exists events_no_delete on events;
