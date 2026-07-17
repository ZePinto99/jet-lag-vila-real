'use client'

// useGameMoments — the "big moment" layer that sits above the ambient toasts.
//
// Drives a queue of full-screen animated popups (see MomentOverlay) for the
// marquee events of a game:
//   • flag_found            — your team captured a flag / your flag was found
//   • tag                   — you tagged a raider / your team got tagged
//   • placed_curse_triggered — you sprang a hidden trap
//
// Smaller events (attempt started, decoy/empty miss, enemy proximity) stay in
// useGameToasts. Moments show one at a time, ~2.8 s each, then advance.

import { useEffect, useRef, useState } from 'react'
import { getSeedLandmarkByRef } from '@/lib/landmarks'
import type { GameEvent, Player } from '@/lib/types'

export type MomentTone = 'good' | 'bad'
export type MomentCue = 'good' | 'bad' | 'alert' | 'win'

export interface GameMoment {
  id: string
  tone: MomentTone
  cue: MomentCue
  icon: string
  title: string
  subtitle: string
}

// Matches the .moment-life animation length in globals.css.
const MOMENT_TTL_MS = 2800

interface UseGameMomentsParams {
  events: GameEvent[]
  myTeamId: string | null
  myPlayerId: string | null
  players: Player[]
  /** True once the live-state snapshot has been applied (see useGameToasts). */
  ready: boolean
  t: (key: string, tokens?: Record<string, string | number>) => string
}

function landmarkName(ref: string): string {
  return getSeedLandmarkByRef(ref)?.name ?? ref
}

export function useGameMoments({
  events,
  myTeamId,
  myPlayerId,
  players,
  ready,
  t,
}: UseGameMomentsParams): {
  moment: GameMoment | null
  dismiss: (id: string) => void
} {
  const [queue, setQueue] = useState<GameMoment[]>([])

  const seqRef = useRef(0)
  const pushRef = useRef<(m: Omit<GameMoment, 'id'>) => void>(() => {})
  pushRef.current = (m: Omit<GameMoment, 'id'>) => {
    const id = `m${seqRef.current++}`
    setQueue((prev) => [...prev, { ...m, id }])
  }

  // Advance the queue: when the head changes, schedule its removal.
  const headId = queue[0]?.id
  useEffect(() => {
    if (!headId) return
    const timer = setTimeout(() => setQueue((q) => q.slice(1)), MOMENT_TTL_MS)
    return () => clearTimeout(timer)
  }, [headId])

  // Seed once the snapshot has loaded (ready) so we never replay history; only
  // events arriving after seeding produce a moment.
  const processedRef = useRef<Set<string>>(new Set())
  const seededRef = useRef(false)
  useEffect(() => {
    if (!ready) return
    if (!seededRef.current) {
      for (const e of events) processedRef.current.add(e.id)
      seededRef.current = true
      return
    }
    for (const e of events) {
      if (processedRef.current.has(e.id)) continue
      processedRef.current.add(e.id)
      handleEvent(e)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, ready, myTeamId, myPlayerId, players])

  function teamOf(playerId: string | null): string | null {
    return players.find((p) => p.id === playerId)?.team_id ?? null
  }
  function nameOf(playerId: string | null): string {
    return players.find((p) => p.id === playerId)?.display_name ?? 'Player'
  }

  function handleEvent(e: GameEvent) {
    const p = e.payload as Record<string, unknown>

    if (e.type === 'flag_found') {
      const ref = typeof p.landmark_ref === 'string' ? p.landmark_ref : null
      if (!ref) return
      const name = landmarkName(ref)
      const attackerTeam = typeof p.team_id === 'string' ? p.team_id : null
      const finderId =
        typeof p.player_id === 'string' ? p.player_id : e.actor_player_id
      const player = nameOf(finderId)
      if (attackerTeam === myTeamId) {
        pushRef.current({
          tone: 'good',
          cue: 'win',
          icon: '🚩',
          title: t('moment.capture.title'),
          subtitle: t('moment.capture.sub', { player, name }),
        })
      } else {
        pushRef.current({
          tone: 'bad',
          cue: 'alert',
          icon: '🚨',
          title: t('moment.discovered.title'),
          subtitle: t('moment.discovered.sub', { player, name }),
        })
      }
      return
    }

    if (e.type === 'tag') {
      const raiderId =
        typeof p.raider_player_id === 'string' ? p.raider_player_id : null
      const defenderId =
        typeof p.defender_player_id === 'string' ? p.defender_player_id : null
      const tagger = nameOf(defenderId)
      const raider = nameOf(raiderId)
      if (teamOf(defenderId) === myTeamId) {
        pushRef.current({
          tone: 'good',
          cue: 'good',
          icon: '🖐️',
          title: t('moment.tag_made.title'),
          subtitle: t('moment.tag_made.sub', { tagger, raider }),
        })
      } else if (teamOf(raiderId) === myTeamId) {
        pushRef.current({
          tone: 'bad',
          cue: 'alert',
          icon: '💥',
          title: t('moment.tagged.title'),
          subtitle: t('moment.tagged.sub', { raider, tagger }),
        })
      }
      return
    }

    if (e.type === 'placed_curse_triggered') {
      const targetTeam =
        typeof p.target_team_id === 'string' ? p.target_team_id : null
      if (targetTeam === myTeamId) {
        pushRef.current({
          tone: 'bad',
          cue: 'bad',
          icon: '🪤',
          title: t('moment.trap.title'),
          subtitle: t('moment.trap.sub', { player: nameOf(e.actor_player_id) }),
        })
      }
    }
  }

  function dismiss(id: string) {
    setQueue((prev) => prev.filter((m) => m.id !== id))
  }

  return { moment: queue[0] ?? null, dismiss }
}
