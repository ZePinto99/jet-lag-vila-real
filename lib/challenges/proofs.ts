import type { GameEvent } from '@/lib/types'

/**
 * Index challenge proof photos by card so completion events can expose the
 * original submission even when they predate `photo_url` being copied onto the
 * completion event itself.
 */
export function buildChallengeProofIndex(events: GameEvent[]): ReadonlyMap<string, string> {
  const byCardId = new Map<string, string>()

  for (const event of events) {
    if (event.type !== 'challenge_submitted') continue
    const payload = event.payload as Record<string, unknown>
    const cardId = payload.card_id
    const photoUrl = payload.photo_url
    if (typeof cardId === 'string' && typeof photoUrl === 'string') {
      byCardId.set(cardId, photoUrl)
    }
  }

  return byCardId
}

/** Return the proof attached to a challenge submission or completion event. */
export function challengeProofUrl(
  event: GameEvent,
  byCardId: ReadonlyMap<string, string>,
): string | null {
  if (event.type !== 'challenge_submitted' && event.type !== 'challenge_completed') {
    return null
  }

  const payload = event.payload as Record<string, unknown>
  if (typeof payload.photo_url === 'string') return payload.photo_url
  return typeof payload.card_id === 'string' ? (byCardId.get(payload.card_id) ?? null) : null
}
