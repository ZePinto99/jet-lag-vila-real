'use client'

// Discovered enemy landmark kinds — derived from the event log.
//
// Every time my team has attempted an enemy candidate landmark, the server
// emits a 'flag_attempt' event with `{ landmark_ref, result, team_id }`. The
// result is one of 'real' | 'decoy' | 'empty'. We map each to the underlying
// LandmarkKind and return the union as a Record keyed by landmark ref. This
// is fed to <GameMap discoveredEnemyKinds={...}/> so attempted enemy
// candidates show their confirmed kind in the popup.
//
// Memoised on (events, myTeamId).

import { useMemo } from 'react'
import type {
  FlagAttemptResult,
  GameEvent,
  LandmarkKind,
} from '@/lib/types'

const RESULT_TO_KIND: Record<FlagAttemptResult, LandmarkKind> = {
  real: 'flag_real',
  decoy: 'flag_decoy',
  empty: 'flag_empty',
}

export function useDiscoveredEnemyKinds(
  events: GameEvent[],
  myTeamId: string | null,
): Record<string, LandmarkKind> {
  return useMemo(() => {
    const acc: Record<string, LandmarkKind> = {}
    if (!myTeamId) return acc
    for (const e of events) {
      if (e.type !== 'flag_attempt') continue
      const payload = e.payload as Record<string, unknown>
      const teamId = payload.team_id
      const landmarkRef = payload.landmark_ref
      const result = payload.result
      if (
        typeof teamId !== 'string' ||
        typeof landmarkRef !== 'string' ||
        typeof result !== 'string'
      ) {
        continue
      }
      if (teamId !== myTeamId) continue
      const kind = RESULT_TO_KIND[result as FlagAttemptResult]
      if (!kind) continue
      acc[landmarkRef] = kind
    }
    return acc
  }, [events, myTeamId])
}
