import type { Card } from '@/lib/types'

/** Strip legacy secrets before a team-scoped card leaves the server. */
export function sanitizeIntelCard(card: Card): Card {
  if (card.kind !== 'intel' || card.ref !== 'intel.hot-cold') return card
  const payload = { ...(card.payload ?? {}) }
  delete payload.target
  return { ...card, payload }
}
