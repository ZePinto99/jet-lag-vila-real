import type { createAdminClient } from '@/lib/supabase/admin'
import type { Player } from '@/lib/types'

type Admin = ReturnType<typeof createAdminClient>

// Full Stop and Pilgrimage are app-action locks, not merely visual warnings.
// Every mutating gameplay route calls this after authenticating the player's
// team so a stale tab or direct API retry cannot bypass either curse.
export async function isTeamActionLocked(
  supabase: Admin,
  gameId: string,
  teamId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('active_curses')
    .select('id')
    .eq('game_id', gameId)
    .eq('target_team_id', teamId)
    .in('curse_ref', ['curse.full-stop', 'curse.pilgrimage'])
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .limit(1)

  if (error) throw new Error(`action_lock_lookup_failed: ${error.message}`)
  return (data ?? []).length > 0
}

export type GameplayActionBlock = 'player_respawning' | 'actions_locked'

/**
 * Shared route-level fast guard for active field actions. The matching RPCs
 * repeat this check under the game/player transaction locks; this helper is
 * for a stable, user-facing HTTP contract and avoids every route drifting on
 * whether a tagged/decoy player may spend or adjudicate.
 */
export async function getGameplayActionBlock(
  supabase: Admin,
  gameId: string,
  player: Pick<Player, 'team_id' | 'respawning'>,
): Promise<GameplayActionBlock | null> {
  if (player.respawning) return 'player_respawning'
  return await isTeamActionLocked(supabase, gameId, player.team_id)
    ? 'actions_locked'
    : null
}
