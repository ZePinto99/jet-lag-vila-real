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
import challengesCatalog from '@/data/challenges.json'
import type { Card, ChallengeDefinition, Game, Team } from '@/lib/types'

type Admin = ReturnType<typeof createAdminClient>

const FIRST_BLOOD_BONUS = 30
const ACTIVE_CHALLENGES_TARGET = 3
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

export async function awardChallenge(
  args: AwardChallengeArgs,
): Promise<AwardChallengeResult> {
  const { supabase, game, team, card, def, actorPlayerId, reviewedByTeamId } =
    args
  const reward_coins = def.reward_coins
  const now = new Date().toISOString()

  // 1. Consume the card (guard on its current state to avoid double-award).
  const { data: consumed, error: consumeError } = await supabase
    .from('cards')
    .update({
      state: 'consumed',
      payload: { ...(card.payload ?? {}), completed_at: now },
      updated_at: now,
    })
    .eq('id', card.id)
    .eq('state', card.state)
    .select()
    .maybeSingle()
  if (consumeError) throw new AwardError(consumeError.message)
  if (!consumed) throw new AwardError('challenge_not_available')

  // 2. First-blood: any prior challenge_completed in this game?
  const { data: prior, error: priorError } = await supabase
    .from('events')
    .select('id')
    .eq('game_id', game.id)
    .eq('type', 'challenge_completed')
    .limit(1)
    .maybeSingle()
  if (priorError) throw new AwardError(priorError.message)
  const first_blood = !prior
  const bonus_coins = first_blood ? FIRST_BLOOD_BONUS : 0
  const total_credit = reward_coins + bonus_coins

  // 3. coins_credited event (before the coin bump).
  const { error: coinsEventError } = await supabase.from('events').insert({
    game_id: game.id,
    type: 'coins_credited',
    actor_player_id: actorPlayerId,
    payload: {
      team_id: team.id,
      amount: total_credit,
      reason: 'challenge_completed',
      challenge_ref: def.id,
      breakdown: { reward: reward_coins, first_blood: bonus_coins },
    },
  })
  if (coinsEventError) throw new AwardError(coinsEventError.message)

  // 4. Credit team coins, then re-read to avoid drift from concurrent credits.
  const { error: teamUpdateError } = await supabase
    .from('teams')
    .update({ coins: team.coins + total_credit })
    .eq('id', team.id)
  if (teamUpdateError) throw new AwardError(teamUpdateError.message)
  let team_coins = team.coins + total_credit
  const { data: refreshed, error: refreshError } = await supabase
    .from('teams')
    .select('coins')
    .eq('id', team.id)
    .maybeSingle()
  if (refreshError) throw new AwardError(refreshError.message)
  if (refreshed) team_coins = (refreshed as { coins: number }).coins

  // 5. challenge_completed event.
  const { error: completedError } = await supabase.from('events').insert({
    game_id: game.id,
    type: 'challenge_completed',
    actor_player_id: actorPlayerId,
    payload: {
      team_id: team.id,
      challenge_ref: def.id,
      card_id: card.id,
      reward_coins,
      first_blood,
      bonus_coins,
      actor_player_id: actorPlayerId,
      ...(reviewedByTeamId ? { reviewed_by_team_id: reviewedByTeamId } : {}),
    },
  })
  if (completedError) throw new AwardError(completedError.message)

  // 6. Draw a replacement if the team is below the active target.
  let replacement: ChallengeDefinition | null = null
  const { data: allCards, error: allError } = await supabase
    .from('cards')
    .select('ref, state')
    .eq('game_id', game.id)
    .eq('team_id', team.id)
    .eq('kind', 'challenge')
  if (allError) throw new AwardError(allError.message)
  const rows = (allCards ?? []) as Array<{ ref: string; state: string }>
  // Count both available and pending toward the active cap so we don't refill
  // past 3 while some await review.
  const activeCount = rows.filter(
    (c) => c.state === 'available' || c.state === 'pending',
  ).length
  const drawnRefs = new Set(rows.map((c) => c.ref))
  const unusedPool = CATALOG.filter((c) => !drawnRefs.has(c.id))
  if (activeCount < ACTIVE_CHALLENGES_TARGET && unusedPool.length > 0) {
    const pick = unusedPool[Math.floor(Math.random() * unusedPool.length)]
    const { data: inserted, error: insertError } = await supabase
      .from('cards')
      .insert({
        game_id: game.id,
        team_id: team.id,
        kind: 'challenge',
        ref: pick.id,
        state: 'available',
        payload: {},
      })
      .select()
      .maybeSingle()
    if (insertError) throw new AwardError(insertError.message)
    if (inserted) replacement = pick
  }

  return { reward_coins, first_blood, bonus_coins, team_coins, replacement }
}
