// Shared server-side "award a completed challenge" logic (playtest item D14).
//
// Used by two routes:
//   • submit-challenge — for non-photo challenges that auto-complete on submit.
//   • accept-challenge — when the OTHER team approves a submitted photo.
//
// It consumes the challenge card, computes the first-blood bonus, credits the
// team (event first, then teams.coins), writes challenge_completed, and draws a
// replacement challenge. Throws on any DB error; callers map that to a 500.

import type { createAdminClient } from '@/lib/supabase/admin'
import { supportsTeamSize } from '@/lib/teamSizeEligibility'
import challengesCatalog from '@/data/challenges.json'
import type { Card, ChallengeDefinition, Game, Team } from '@/lib/types'

type Admin = ReturnType<typeof createAdminClient>

const CATALOG = challengesCatalog as ChallengeDefinition[]

export interface AwardChallengeArgs {
  supabase: Admin
  game: Game
  /** The team being credited (the submitting team). */
  team: Team
  /** The challenge card to consume. */
  card: Card
  def: ChallengeDefinition
  /** Player credited as the actor on the events (the submitter). */
  actorPlayerId: string
  /** Player whose request is being authorized (reviewer for peer accept). */
  requestingPlayerId: string
  /** When set (peer-accept), recorded on the completion event. */
  reviewedByTeamId?: string
}

export interface AwardChallengeResult {
  reward_coins: number
  first_blood: boolean
  bonus_coins: number
  team_coins: number
  replacement: ChallengeDefinition | null
}

class AwardError extends Error {}

export async function awardChallenge(args: AwardChallengeArgs): Promise<AwardChallengeResult> {
  const {
    supabase,
    game,
    team,
    card,
    def,
    actorPlayerId,
    requestingPlayerId,
    reviewedByTeamId,
  } = args
  const reward_coins = def.reward_coins
  // Build the replacement pool in application code (the catalog is static
  // JSON), then let Postgres choose and insert one inside the same transaction
  // as the award. This keeps first blood, coins, card state, events, and refill
  // consistent across concurrent phones.
  const { data: allCards, error: allError } = await supabase
    .from('cards')
    .select('ref, state')
    .eq('game_id', game.id)
    .eq('team_id', team.id)
    .eq('kind', 'challenge')
  if (allError) throw new AwardError(allError.message)
  const rows = (allCards ?? []) as Array<{ ref: string; state: string }>
  const drawnRefs = new Set(rows.map((c) => c.ref))
  const { count: teamSize, error: teamSizeError } = await supabase
    .from('players')
    .select('id', { count: 'exact', head: true })
    .eq('team_id', team.id)
  if (teamSizeError) throw new AwardError(teamSizeError.message)
  const unusedPool = CATALOG.filter(
    (candidate) =>
      !drawnRefs.has(candidate.id) &&
      supportsTeamSize(candidate, teamSize ?? 0),
  )
  const { data, error } = await supabase.rpc('award_challenge_atomic_guarded', {
    p_game_id: game.id,
    p_team_id: team.id,
    p_card_id: card.id,
    p_expected_state: card.state,
    p_reward_coins: reward_coins,
    p_actor_player_id: actorPlayerId,
    p_requesting_player_id: requestingPlayerId,
    p_reviewed_by_team_id: reviewedByTeamId ?? null,
    p_replacement_refs: unusedPool.map((candidate) => candidate.id),
  })
  if (error) throw new AwardError(error.message)
  const result = data as {
    error?: string
    reward_coins?: number
    first_blood?: boolean
    bonus_coins?: number
    team_coins?: number
    replacement_ref?: string | null
  } | null
  if (!result || result.error) {
    throw new AwardError(result?.error ?? 'challenge_award_failed')
  }
  const replacement = result.replacement_ref
    ? CATALOG.find((candidate) => candidate.id === result.replacement_ref) ?? null
    : null
  return {
    reward_coins: result.reward_coins ?? reward_coins,
    first_blood: result.first_blood ?? false,
    bonus_coins: result.bonus_coins ?? 0,
    team_coins: result.team_coins ?? team.coins,
    replacement,
  }
}
