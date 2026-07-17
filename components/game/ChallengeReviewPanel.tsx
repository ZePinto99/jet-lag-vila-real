'use client'

// ChallengeReviewPanel (playtest item D14) — the OTHER team reviews photo
// challenge submissions. Fully event-driven: a `challenge_submitted` event
// (reviewing_team_id === my team) that hasn't been resolved by a later
// `challenge_completed` / `challenge_rejected` for the same card is a pending
// review. Accept credits the submitter; reject sends it back for a retake.

import { useMemo, useState } from 'react'
import { apiPost } from '@/lib/api'
import { getDeviceId } from '@/lib/device'
import { useT } from '@/lib/i18n/context'
import type { GameEvent } from '@/lib/types'

interface PendingReview {
  cardId: string
  challengeRef: string
  locationName: string
  photoUrl: string
  rewardCoins: number
  createdAt: string
}

interface ChallengeReviewPanelProps {
  gameId: string
  myPlayerId: string
  myTeamId: string
  events: GameEvent[]
}

export function ChallengeReviewPanel({
  gameId,
  myPlayerId,
  myTeamId,
  events,
}: ChallengeReviewPanelProps) {
  const t = useT()
  const [busyCard, setBusyCard] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const pending = useMemo<PendingReview[]>(() => {
    // Latest relevant event per card_id decides its state.
    const latest = new Map<string, GameEvent>()
    for (const e of events) {
      if (
        e.type !== 'challenge_submitted' &&
        e.type !== 'challenge_completed' &&
        e.type !== 'challenge_rejected'
      ) {
        continue
      }
      const cardId = (e.payload as Record<string, unknown>)?.card_id
      if (typeof cardId !== 'string') continue
      const prev = latest.get(cardId)
      if (!prev || e.created_at >= prev.created_at) latest.set(cardId, e)
    }
    const out: PendingReview[] = []
    for (const [cardId, e] of latest) {
      if (e.type !== 'challenge_submitted') continue
      const p = e.payload as Record<string, unknown>
      if (p.reviewing_team_id !== myTeamId) continue
      out.push({
        cardId,
        challengeRef: typeof p.challenge_ref === 'string' ? p.challenge_ref : '',
        locationName:
          typeof p.location_name === 'string' ? p.location_name : 'Challenge',
        photoUrl: typeof p.photo_url === 'string' ? p.photo_url : '',
        rewardCoins: typeof p.reward_coins === 'number' ? p.reward_coins : 0,
        createdAt: e.created_at,
      })
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }, [events, myTeamId])

  async function review(cardId: string, accept: boolean) {
    setBusyCard(cardId)
    setError(null)
    try {
      await apiPost(
        `/api/games/${gameId}/${accept ? 'accept-challenge' : 'reject-challenge'}`,
        {
          device_id: getDeviceId(),
          player_id: myPlayerId,
          card_id: cardId,
        },
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown_error')
    } finally {
      setBusyCard(null)
    }
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <h2 className="text-sm font-medium text-neutral-100">
        {t('challenge.review_title')}
      </h2>
      {pending.length === 0 ? (
        <p className="mt-2 text-xs text-neutral-500">
          {t('challenge.review_none')}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {pending.map((r) => (
            <li
              key={r.cardId}
              className="rounded border border-amber-800/40 bg-amber-950/20 px-3 py-2"
            >
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-sm font-medium text-amber-100">
                  {r.locationName}
                </p>
                <p className="shrink-0 text-xs font-semibold tabular-nums text-amber-300">
                  +{r.rewardCoins}
                </p>
              </div>
              {r.photoUrl && (
                <a
                  href={r.photoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-[11px] text-sky-300 underline"
                >
                  {t('challenge.view_photo')}
                </a>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => review(r.cardId, false)}
                  disabled={busyCard === r.cardId}
                  className="flex-1 rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-200 transition hover:bg-neutral-700 disabled:opacity-50"
                >
                  {busyCard === r.cardId
                    ? t('challenge.reviewing')
                    : t('challenge.reject')}
                </button>
                <button
                  type="button"
                  onClick={() => review(r.cardId, true)}
                  disabled={busyCard === r.cardId}
                  className="flex-1 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-50"
                >
                  {busyCard === r.cardId
                    ? t('challenge.reviewing')
                    : t('challenge.accept')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="mt-3 rounded bg-red-950/70 px-2 py-1 text-[11px] text-red-200">
          {error}
        </p>
      )}
    </div>
  )
}
