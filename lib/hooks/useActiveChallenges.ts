'use client'

// Fetches the caller team's active challenges so the live map can draw them
// as star markers (playtest item C10). Refetches whenever a challenge is
// completed (the active set rotates), keyed off the count of
// `challenge_completed` events already in the store.

import { useEffect, useMemo, useState } from 'react'
import { apiGet } from '@/lib/api'
import { getDeviceId } from '@/lib/device'
import { getSeedLandmarkByRef } from '@/lib/landmarks'
import type {
  ChallengeDefinition,
  GameEvent,
  GameStatus,
  GetChallengesResponse,
} from '@/lib/types'

export interface ChallengeMarker {
  ref: string
  name: string
  task: string
  reward: number
  lat: number
  lng: number
}

export function useActiveChallenges(
  gameId: string | null,
  gameStatus: GameStatus,
  events: GameEvent[],
): ChallengeMarker[] {
  const [active, setActive] = useState<ChallengeDefinition[]>([])

  // Bump this whenever a challenge completes so we refetch the rotated set.
  const completedCount = useMemo(
    () => events.filter((e) => e.type === 'challenge_completed').length,
    [events],
  )

  useEffect(() => {
    if (!gameId) return
    if (gameStatus !== 'live' && gameStatus !== 'flag_found') return
    let cancelled = false
    ;(async () => {
      try {
        const deviceId = getDeviceId()
        const data = await apiGet<GetChallengesResponse>(
          `/api/games/${gameId}/challenges?device_id=${encodeURIComponent(deviceId)}`,
        )
        if (!cancelled) setActive(data.active)
      } catch {
        // Non-fatal: the map simply shows no challenge stars.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [gameId, gameStatus, completedCount])

  return useMemo(() => {
    const markers: ChallengeMarker[] = []
    for (const c of active) {
      if (!c.landmark_ref) continue // landmark-agnostic challenges have no pin
      const seed = getSeedLandmarkByRef(c.landmark_ref)
      if (!seed) continue
      markers.push({
        ref: c.id,
        name: c.location_name,
        task: c.task,
        reward: c.reward_coins,
        lat: seed.lat,
        lng: seed.lng,
      })
    }
    return markers
  }, [active])
}
