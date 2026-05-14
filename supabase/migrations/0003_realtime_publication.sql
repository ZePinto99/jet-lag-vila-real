-- Migration 0003: enable Realtime change broadcasts on the tables clients subscribe to.
-- Without this, postgres_changes subscriptions silently receive nothing and the
-- UI only updates on manual refresh.

alter publication supabase_realtime add table games;
alter publication supabase_realtime add table teams;
alter publication supabase_realtime add table players;
alter publication supabase_realtime add table landmarks;
alter publication supabase_realtime add table cards;
alter publication supabase_realtime add table events;
alter publication supabase_realtime add table active_curses;
alter publication supabase_realtime add table tags;
