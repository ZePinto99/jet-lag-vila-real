'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useGameStore } from '@/store/gameStore'
import type { Game, Player, Team } from '@/lib/types'

// Subscribes to Realtime postgres_changes for the lobby of a given game.
// Watches: games (by id), teams (by game_id), players (one unfiltered table
// subscription, then client-side game-team scoping).
// Forwards inserts/updates/deletes into the Zustand store.
export function useLobbyRealtime(gameId: string | null) {
  const teams = useGameStore((s) => s.teams)
  const setGame = useGameStore((s) => s.setGame)
  const upsertTeam = useGameStore((s) => s.upsertTeam)
  const upsertPlayer = useGameStore((s) => s.upsertPlayer)
  const removePlayer = useGameStore((s) => s.removePlayer)

  const teamIdsKey = teams.map((t) => t.id).sort().join(',')

  useEffect(() => {
    if (!gameId) return

    const supabase = createClient()
    const channel = supabase.channel(`lobby:${gameId}`)

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

    const teamIds = new Set(teamIdsKey ? teamIdsKey.split(',') : [])
    // PostgreSQL DELETE payloads only include the primary key under the
    // default replica identity, so a server-side `team_id` filter silently
    // drops them. Subscribe once without a filter: DELETE can remove by id;
    // INSERT/UPDATE are scoped to this game's two known team ids here.
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'players' },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          const old = payload.old as { id?: string }
          if (old.id) removePlayer(old.id)
          return
        }
        const player = payload.new as Player
        if (teamIds.has(player.team_id)) upsertPlayer(player)
      },
    )

    channel.subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [gameId, teamIdsKey, setGame, upsertTeam, upsertPlayer, removePlayer])
}
