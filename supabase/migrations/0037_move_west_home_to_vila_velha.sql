-- Migration 0037: move the West home base from UTAD to Vila Velha.
--
-- New games receive the new ref in the create route. This one-time update also
-- fixes lobby/setup games that have not persisted a flag assignment yet,
-- without changing active or historical games.

update public.teams as team
set home_landmark_id = 'landmark.miradouro-vila-velha'
from public.games as game
where team.game_id = game.id
  and team.side = 'west'
  and team.home_landmark_id = 'landmark.utad-main-library'
  and game.status in ('lobby', 'setup')
  and not exists (
    select 1
    from public.landmarks as landmark
    where landmark.game_id = team.game_id
      and landmark.team_id = team.id
      and landmark.kind in ('flag_real', 'flag_decoy', 'flag_empty')
  );
