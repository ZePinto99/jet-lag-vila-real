#!/bin/bash
# Verify migration 0056: a weather pause must NOT be charged to a tagged
# player's respawn grace period.
#
# Each psql call is a SEPARATE transaction on purpose. An earlier attempt used
# pg_sleep() inside one DO block, which was invalid: the pause RPC computes
# pause_seconds from now(), and now() is TRANSACTION START time in Postgres, so
# holding one transaction open makes the recorded pause 0 s and measures nothing.
set -u
export DOCKER_CONFIG="${TMPDIR}/dockercfg"
export DOCKER_HOST="unix://${HOME}/.rd/docker.sock"
q() { docker exec -i supabase_db_jet-lag-the-game-vr psql -U postgres -d postgres -tAc "$1" | tr -d ' \n'; }

G=$(q "select t.game_id from teams t group by t.game_id having count(*)=2 order by max(t.created_at) desc limit 1")
W=$(q "select id from teams where game_id='$G' and side='west'")
E=$(q "select id from teams where game_id='$G' and side='east'")
WP=$(q "select id from players where team_id='$W' limit 1")
EP=$(q "select id from players where team_id='$E' limit 1")
echo "game=$G"

q "update games set status='live', config=coalesce(config,'{}'::jsonb)-'weather_pause' where id='$G'" >/dev/null
q "update players set respawning=true, respawn_arrived=false, respawn_target_ref='landmark.teatro-vila-real', respawning_since=clock_timestamp()-interval '2 minutes' where id='$EP'" >/dev/null

BEFORE=$(q "select extract(epoch from (clock_timestamp()-respawning_since))::int from players where id='$EP'")
echo "respawn age before pause: ${BEFORE}s (owes ~8 min of a 10-min grace)"

q "select weather_pause_vote_atomic('$G','$W','$WP','pause')" >/dev/null
q "select weather_pause_vote_atomic('$G','$E','$EP','pause')" >/dev/null
echo "status: $(q "select status from games where id='$G'") — waiting 12 s of real wall clock"
sleep 12
q "select weather_pause_vote_atomic('$G','$W','$WP','resume')" >/dev/null
q "select weather_pause_vote_atomic('$G','$E','$EP','resume')" >/dev/null

PS=$(q "select coalesce(config->'weather_pause'->>'last_pause_seconds','?') from games where id='$G'")
AFTER=$(q "select extract(epoch from (clock_timestamp()-respawning_since))::int from players where id='$EP'")
DELTA=$((AFTER - BEFORE))
echo "recorded pause: ${PS}s | age after: ${AFTER}s | delta: ${DELTA}s"
echo
echo "A correct fix credits the paused time back, so the age should grow by only"
echo "the ~1-2 s of genuine non-paused time, NOT by the ${PS}s pause."
if [ "$DELTA" -lt 5 ]; then
  echo "VERDICT: FIXED — the ${PS}s pause was credited back"
else
  echo "VERDICT: STILL CHARGED — the player lost ${DELTA}s of grace to the pause"
fi

q "update players set respawning=false, respawning_since=null, respawn_target_ref=null where id='$EP'" >/dev/null
q "update games set config=coalesce(config,'{}'::jsonb)-'weather_pause' where id='$G'" >/dev/null
