// Lookup helpers for the per-landmark flag-attempt mini-challenges
// (data/flag-attempt-challenges.json). Imported on both client and server —
// the content is public (hardening is a server-side radius, not a text swap,
// so nothing here leaks which candidate is the real flag).

import raw from '@/data/flag-attempt-challenges.json'
import type {
  FlagAttemptChallenge,
  FlagAttemptChallengeText,
} from '@/lib/types'

const CHALLENGES = raw as FlagAttemptChallenge[]
const BY_REF = new Map<string, FlagAttemptChallenge>(
  CHALLENGES.map((c) => [c.landmark_ref, c]),
)

export function getFlagAttemptChallenge(
  landmarkRef: string,
): FlagAttemptChallenge | undefined {
  return BY_REF.get(landmarkRef)
}

// Locale-aware text, falling back en → pt and finally to a generic prompt so a
// landmark without authored content (e.g. a freshly added one) still works.
export function getFlagAttemptText(
  landmarkRef: string,
  locale: 'en' | 'pt',
): FlagAttemptChallengeText {
  const entry = BY_REF.get(landmarkRef)
  if (entry) return entry[locale] ?? entry.en
  return locale === 'pt'
    ? {
        title: 'Captura a bandeira',
        task: 'Fotografa-te no marco com a equipa. Marcador visível.',
      }
    : {
        title: 'Capture the flag',
        task: 'Photograph yourself at the marker with your team. Marker visible.',
      }
}
