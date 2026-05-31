'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useGameStore } from '@/store/gameStore'
import type {
  ActiveCurse,
  Card,
  Game,
  GameEvent,
  Player,
  Team,
} from '@/lib/types'

// Subscribes to postgres_changes for the live phase of a given game.
//
// Channel name: live:{gameId}.
// Watches:
//   - games (by id)            → setGame on UPDATE
//   - teams (by game_id)       → upsertTeam (coin counter, home base)
//   - players                  → upsertPlayer, filtered to this game's teams
//                                client-side (respawning, flag_carrier)
//   - events (by game_id)      → appendEvent on INSERT
//   - active_curses (by game_id) → upsert/remove (we filter by myTeamId client-side)
//   - cards (by team_id)       → upsert/remove (only my team's cards)
//
// Supabase only supports a single equality filter per binding. `teams` carries
// game_id so it filters server-side; `players` only carries team_id, so we
// subscribe game-wide and drop rows for other games in the handler. Without the
// teams/players bindings, coin balances and respawn/flag-carrier state went
// stale mid-game (the snapshot is only fetched on mount) — see PLAYTEST_TRIAGE
// P0-1 / P1-1.
export function useLiveGameRealtime(
  gameId: string | null,
  myTeamId: string | null,
) {
  const setGame = useGameStore((s) => s.setGame)
  const upsertTeam = useGameStore((s) => s.upsertTeam)
  const upsertPlayer = useGameStore((s) => s.upsertPlayer)
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
      { event: '*', schema: 'public', table: 'teams', filter: `game_id=eq.${gameId}` },
      (payload) => {
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          upsertTeam(payload.new as Team)
        }
      },
    )

    // players has no game_id column, so we can't filter server-side. Subscribe
    // game-wide and accept only rows whose team belongs to this game. Reading
    // teams via getState avoids re-subscribing every time the roster changes.
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'players' },
      (payload) => {
        if (payload.eventType === 'DELETE') return
        const player = payload.new as Player
        const teamIds = new Set(
          useGameStore.getState().teams.map((t) => t.id),
        )
        if (!teamIds.has(player.team_id)) return
        upsertPlayer(player)
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
    upsertTeam,
    upsertPlayer,
    appendEvent,
    upsertActiveCurse,
    removeActiveCurse,
    upsertCard,
    removeCard,
  ])
}
