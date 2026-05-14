'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useGameStore } from '@/store/gameStore'
import type {
  ActiveCurse,
  Card,
  Game,
  GameEvent,
} from '@/lib/types'

// Subscribes to postgres_changes for the live phase of a given game.
//
// Channel name: live:{gameId}.
// Watches:
//   - games (by id)            → setGame on UPDATE
//   - events (by game_id)      → appendEvent on INSERT
//   - active_curses (by game_id) → upsert/remove (we filter by myTeamId client-side)
//   - cards (by team_id)       → upsert/remove (only my team's cards)
//
// Supabase only supports a single equality filter per binding, so active_curses
// is subscribed for the whole game and filtered to my team in the handler.
export function useLiveGameRealtime(
  gameId: string | null,
  myTeamId: string | null,
) {
  const setGame = useGameStore((s) => s.setGame)
  const appendEvent = useGameStore((s) => s.appendEvent)
  const upsertActiveCurse = useGameStore((s) => s.upsertActiveCurse)
  const removeActiveCurse = useGameStore((s) => s.removeActiveCurse)
  const upsertCard = useGameStore((s) => s.upsertCard)
  const removeCard = useGameStore((s) => s.removeCard)

  useEffect(() => {
    if (!gameId) return

    const supabase = createClient()
    const channel = supabase.channel(`live:${gameId}`)

    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'games', filter: `id=eq.${gameId}` },
      (payload) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          setGame(payload.new as Game)
        }
      },
    )

    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'events', filter: `game_id=eq.${gameId}` },
      (payload) => {
        appendEvent(payload.new as GameEvent)
      },
    )

    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'active_curses', filter: `game_id=eq.${gameId}` },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          const old = payload.old as { id?: string }
          if (old.id) removeActiveCurse(old.id)
          return
        }
        const curse = payload.new as ActiveCurse
        // Filter to my team's incoming curses only. The publication broadcasts
        // both teams' rows because Supabase filters allow only one column.
        if (!myTeamId || curse.target_team_id !== myTeamId) return
        upsertActiveCurse(curse)
      },
    )

    if (myTeamId) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cards', filter: `team_id=eq.${myTeamId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const old = payload.old as { id?: string }
            if (old.id) removeCard(old.id)
            return
          }
          upsertCard(payload.new as Card)
        },
      )
    }

    channel.subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [
    gameId,
    myTeamId,
    setGame,
    appendEvent,
    upsertActiveCurse,
    removeActiveCurse,
    upsertCard,
    removeCard,
  ])
}
