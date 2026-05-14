'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useGameStore } from '@/store/gameStore'
import type { Game, Player, Team } from '@/lib/types'

// Subscribes to Realtime postgres_changes for the lobby of a given game.
// Watches: games (by id), teams (by game_id), players (by team_id for each team in the snapshot).
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

    const teamIds = teamIdsKey ? teamIdsKey.split(',') : []
    for (const teamId of teamIds) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'players', filter: `team_id=eq.${teamId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const old = payload.old as { id?: string }
            if (old.id) removePlayer(old.id)
            return
          }
          upsertPlayer(payload.new as Player)
        },
      )
    }

    channel.subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [gameId, teamIdsKey, setGame, upsertTeam, upsertPlayer, removePlayer])
}
