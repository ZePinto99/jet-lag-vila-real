'use client'

// Per-landmark lockout state for enemy candidates my team has attempted.
//
// RULEBOOK §5.2: after a decoy/empty attempt the team is locked out of THAT
// landmark for 15 min. The server enforces it (`landmark_locked_out`); this
// hook re-derives it client-side from the `flag_attempt` event log so the map
// can grey the landmark out and show a live countdown of the lockout window.
//
// Keyed by landmark ref → the latest attempt's result + when it unlocks.
// Memoised on (events, myTeamId).

import { useMemo } from 'react'
import type { FlagAttemptResult, GameEvent } from '@/lib/types'

export const LANDMARK_LOCKOUT_MS = 15 * 60_000

export interface EnemyLandmarkLock {
  result: FlagAttemptResult
  attemptedAtMs: number
  unlocksAtMs: number
}

export function useEnemyLandmarkLocks(
  events: GameEvent[],
  myTeamId: string | null,
): Record<string, EnemyLandmarkLock> {
  return useMemo(() => {
    const acc: Record<string, EnemyLandmarkLock> = {}
    if (!myTeamId) return acc
    for (const e of events) {
      if (e.type !== 'flag_attempt') continue
      const p = e.payload as Record<string, unknown>
      if (p.team_id !== myTeamId) continue
      const ref = p.landmark_ref
      const result = p.result
      if (typeof ref !== 'string' || typeof result !== 'string') continue
      if (result !== 'decoy' && result !== 'empty' && result !== 'real') continue
      const attemptedAtMs = Date.parse(e.created_at)
      if (Number.isNaN(attemptedAtMs)) continue
      const existing = acc[ref]
      // Keep the most recent attempt per landmark.
      if (!existing || attemptedAtMs > existing.attemptedAtMs) {
        acc[ref] = {
          result: result as FlagAttemptResult,
          attemptedAtMs,
          unlocksAtMs: attemptedAtMs + LANDMARK_LOCKOUT_MS,
        }
      }
    }
    return acc
  }, [events, myTeamId])
}
