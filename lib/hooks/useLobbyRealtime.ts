'use client'

import { useEffect } from 'react'
import { apiGet } from '@/lib/api'
import { getDeviceId } from '@/lib/device'
import { createClient } from '@/lib/supabase/client'
import { useGameStore } from '@/store/gameStore'
import type { Game, GameByCodeResponse, Player, Team } from '@/lib/types'

// Subscribes to Realtime postgres_changes for the lobby of a given game.
// Watches: games (by id), teams (by game_id), players (one unfiltered table
// subscription, then client-side game-team scoping).
// Forwards inserts/updates/deletes into the Zustand store.
export function useLobbyRealtime(gameId: string | null, gameCode: string | null) {
  const teams = useGameStore((s) => s.teams)
  const setSnapshot = useGameStore((s) => s.setSnapshot)
  const setGame = useGameStore((s) => s.setGame)
  const upsertTeam = useGameStore((s) => s.upsertTeam)
  const upsertPlayer = useGameStore((s) => s.upsertPlayer)
  const removePlayer = useGameStore((s) => s.removePlayer)

  const teamIdsKey = teams
    .map((t) => t.id)
    .sort()
    .join(',')

  useEffect(() => {
    if (!gameId || !gameCode) return

    const supabase = createClient()
    const channel = supabase.channel(`lobby:${gameId}`)
    let cancelled = false
    let reconcileInFlight = false

    // Postgres Changes is a live signal, not a durable queue. A browser tab or
    // installed PWA can be suspended through the lobby -> setup or setup ->
    // live update and never receive that row change. Re-read the authoritative
    // snapshot on subscribe/resume/online so the phase router cannot remain on
    // a stale screen until the user force-refreshes.
    const reconcile = async () => {
      if (cancelled || reconcileInFlight) return
      reconcileInFlight = true
      try {
        const snapshot = await apiGet<GameByCodeResponse>(
          `/api/games/by-code/${encodeURIComponent(gameCode)}`,
        )
        if (cancelled) return
        const deviceId = getDeviceId()
        const me = deviceId
          ? (snapshot.players.find((player) => player.device_id === deviceId) ?? null)
          : null
        setSnapshot({ ...snapshot, me })
      } catch {
        // Best effort. Realtime keeps trying to reconnect and the next focus,
        // online event, or slow reconciliation tick gives us another chance.
      } finally {
        reconcileInFlight = false
      }
    }

    const reconcileWhenVisible = () => {
      if (document.visibilityState === 'visible') void reconcile()
    }

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

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') void reconcile()
    })

    const reconcileInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reconcile()
    }, 15_000)

    window.addEventListener('online', reconcile)
    window.addEventListener('pageshow', reconcile)
    document.addEventListener('visibilitychange', reconcileWhenVisible)

    return () => {
      cancelled = true
      window.clearInterval(reconcileInterval)
      window.removeEventListener('online', reconcile)
      window.removeEventListener('pageshow', reconcile)
      document.removeEventListener('visibilitychange', reconcileWhenVisible)
      supabase.removeChannel(channel)
    }
  }, [gameId, gameCode, teamIdsKey, setSnapshot, setGame, upsertTeam, upsertPlayer, removePlayer])
}
