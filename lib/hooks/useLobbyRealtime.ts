'use client'

import { useEffect } from 'react'
import { apiGet } from '@/lib/api'
import { getDeviceId } from '@/lib/device'
import { createClient } from '@/lib/supabase/client'
import { useGameStore } from '@/store/gameStore'
import type { Game, GameByCodeResponse, Player, Team } from '@/lib/types'

export const LOBBY_RECONCILE_INTERVAL_MS = 3_000
export const LOBBY_RECONCILE_TIMEOUT_MS = 8_000

let nextLobbyChannelInstance = 0

// Subscribes to Realtime postgres_changes for the lobby of a given game.
// Watches: games (by id), teams (by game_id), players (one unfiltered table
// subscription, then client-side game-team scoping).
// Forwards inserts/updates/deletes into the Zustand store.
export function useLobbyRealtime(gameId: string | null, gameCode: string | null) {
  const setSnapshot = useGameStore((s) => s.setSnapshot)
  const setGame = useGameStore((s) => s.setGame)
  const upsertTeam = useGameStore((s) => s.upsertTeam)
  const upsertPlayer = useGameStore((s) => s.upsertPlayer)
  const removePlayer = useGameStore((s) => s.removePlayer)

  useEffect(() => {
    if (!gameId || !gameCode) return

    const supabase = createClient()
    // Supabase reuses a channel object when its topic matches an existing
    // channel. removeChannel() is asynchronous, so a quick cleanup + setup
    // with the same topic can receive the old channel while it is leaving;
    // subscribe() then cannot join it again. A per-effect topic keeps lobby
    // hydration and React StrictMode remounts independent.
    const channel = supabase.channel(`lobby:${gameId}:${++nextLobbyChannelInstance}`)
    let cancelled = false
    let reconcileInFlight = false
    let reconcileQueued = false
    let reconcileController: AbortController | null = null
    let realtimeRevision = 0

    // Postgres Changes is a live signal, not a durable queue. A browser tab or
    // installed PWA can be suspended through the lobby -> setup or setup ->
    // live update and never receive that row change. Re-read the authoritative
    // snapshot on subscribe/resume/online so the phase router cannot remain on
    // a stale screen until the user force-refreshes.
    const reconcile = async () => {
      if (cancelled) return
      if (reconcileInFlight) {
        reconcileQueued = true
        return
      }

      reconcileInFlight = true
      try {
        do {
          reconcileQueued = false
          const revisionAtStart = realtimeRevision
          const controller = new AbortController()
          reconcileController = controller
          const timeout = window.setTimeout(
            () => controller.abort(),
            LOBBY_RECONCILE_TIMEOUT_MS,
          )
          try {
            const snapshot = await apiGet<GameByCodeResponse>(
              `/api/games/by-code/${encodeURIComponent(gameCode)}`,
              { signal: controller.signal },
            )
            if (cancelled) return

            // A Realtime change may arrive while this request is in flight.
            // In that case the response could pre-date the event, so skip it.
            // A timer/focus request alone does not invalidate the response: on
            // a slow mobile network it is still useful even if another polling
            // tick was queued while it loaded.
            if (realtimeRevision === revisionAtStart) {
              const deviceId = getDeviceId()
              const me = deviceId
                ? (snapshot.players.find((player) => player.device_id === deviceId) ?? null)
                : null
              setSnapshot({ ...snapshot, me })
            }
          } catch {
            // Best effort. Realtime keeps trying to reconnect and the next
            // focus, online event, or reconciliation tick tries again.
          } finally {
            window.clearTimeout(timeout)
            if (reconcileController === controller) reconcileController = null
          }
        } while (!cancelled && reconcileQueued)
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
        if (cancelled) return
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          realtimeRevision += 1
          setGame(payload.new as Game)
          void reconcile()
        }
      },
    )

    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'teams', filter: `game_id=eq.${gameId}` },
      (payload) => {
        if (cancelled) return
        if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
          realtimeRevision += 1
          upsertTeam(payload.new as Team)
          void reconcile()
        }
      },
    )

    // PostgreSQL DELETE payloads only include the primary key under the
    // default replica identity, so a server-side `team_id` filter silently
    // drops them. Subscribe once without a filter: DELETE can remove by id;
    // INSERT/UPDATE are scoped to this game's current team ids here. Reading
    // from the store avoids tearing down the channel when hydration fills the
    // initially empty teams array.
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'players' },
      (payload) => {
        if (cancelled) return
        if (payload.eventType === 'DELETE') {
          const old = payload.old as { id?: string }
          const isKnownPlayer = old.id
            ? useGameStore.getState().players.some((player) => player.id === old.id)
            : false
          if (old.id && isKnownPlayer) {
            realtimeRevision += 1
            removePlayer(old.id)
            void reconcile()
          }
          return
        }
        const player = payload.new as Player
        const teamIds = new Set(useGameStore.getState().teams.map((team) => team.id))
        if (teamIds.has(player.team_id)) {
          realtimeRevision += 1
          upsertPlayer(player)
          void reconcile()
        }
      },
    )

    channel.subscribe((status) => {
      if (
        status === 'SUBSCRIBED' ||
        status === 'CHANNEL_ERROR' ||
        status === 'TIMED_OUT'
      ) {
        void reconcile()
      }
    })

    const reconcileInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reconcile()
    }, LOBBY_RECONCILE_INTERVAL_MS)

    window.addEventListener('online', reconcile)
    window.addEventListener('pageshow', reconcile)
    window.addEventListener('focus', reconcile)
    document.addEventListener('visibilitychange', reconcileWhenVisible)

    return () => {
      cancelled = true
      reconcileController?.abort()
      window.clearInterval(reconcileInterval)
      window.removeEventListener('online', reconcile)
      window.removeEventListener('pageshow', reconcile)
      window.removeEventListener('focus', reconcile)
      document.removeEventListener('visibilitychange', reconcileWhenVisible)
      supabase.removeChannel(channel)
    }
  }, [gameId, gameCode, setSnapshot, setGame, upsertTeam, upsertPlayer, removePlayer])
}
