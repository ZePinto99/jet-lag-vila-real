'use client'

import { useEffect } from 'react'
import { apiGet } from '@/lib/api'
import { getDeviceId } from '@/lib/device'
import { createClient } from '@/lib/supabase/client'
import { useGameStore } from '@/store/gameStore'
import type {
  ActiveCurse,
  Card,
  Game,
  GameEvent,
  LiveStateResponse,
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
export function useLiveGameRealtime(gameId: string | null, myTeamId: string | null) {
  const setGame = useGameStore((s) => s.setGame)
  const upsertTeam = useGameStore((s) => s.upsertTeam)
  const upsertPlayer = useGameStore((s) => s.upsertPlayer)
  const appendEvent = useGameStore((s) => s.appendEvent)
  const upsertActiveCurse = useGameStore((s) => s.upsertActiveCurse)
  const removeActiveCurse = useGameStore((s) => s.removeActiveCurse)
  const upsertCard = useGameStore((s) => s.upsertCard)
  const removeCard = useGameStore((s) => s.removeCard)
  const setLiveSnapshot = useGameStore((s) => s.setLiveSnapshot)

  useEffect(() => {
    if (!gameId) return

    const supabase = createClient()
    const channel = supabase.channel(`live:${gameId}`)
    let cancelled = false
    let reconcileInFlight = false
    let hasSubscribed = false

    // Postgres Changes is not a durable queue: events created while a mobile
    // browser is suspended or offline are not replayed after the socket comes
    // back. Reconcile the authoritative snapshot whenever the channel rejoins
    // (and when the tab returns to the foreground), so notifications and live
    // state recover without requiring a force refresh.
    const reconcile = async () => {
      if (cancelled || reconcileInFlight) return
      reconcileInFlight = true
      try {
        const deviceId = getDeviceId()
        const snapshot = await apiGet<LiveStateResponse>(
          `/api/games/${gameId}/live-state?device_id=${encodeURIComponent(deviceId)}`,
        )
        if (!cancelled) setLiveSnapshot(snapshot)
      } catch {
        // Best-effort recovery. Supabase will continue attempting to rejoin,
        // and the next online/visibility event gives us another chance.
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

    // players has no game_id column, so we can't filter server-side. Subscribe
    // game-wide and accept only rows whose team belongs to this game. Reading
    // teams via getState avoids re-subscribing every time the roster changes.
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'players' },
      (payload) => {
        if (payload.eventType === 'DELETE') return
        const player = payload.new as Player
        const teamIds = new Set(useGameStore.getState().teams.map((t) => t.id))
        if (!teamIds.has(player.team_id)) return
        upsertPlayer(player)
      },
    )

    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'events', filter: `game_id=eq.${gameId}` },
      (payload) => {
        const event = payload.new as GameEvent
        appendEvent(event)
        const eventPayload = event.payload as Record<string, unknown>

        // DELETE payloads from Postgres Changes may contain only the primary
        // key and table filters are unreliable for DELETEs. The append-only
        // event is the durable, game-filtered signal for removing an expired
        // or geofence-completed curse without a refresh.
        if (event.type === 'curse_expired' || event.type === 'curse_completed') {
          if (
            eventPayload.target_team_id === myTeamId &&
            typeof eventPayload.curse_id === 'string'
          ) {
            removeActiveCurse(eventPayload.curse_id)
          }
        }

        // Hardened landmark details and own placed curses are team-private or
        // hidden tables. Re-fetch the scoped snapshot only when the event says
        // the changed state belongs to this client team.
        const hardenChanged =
          event.type === 'flag_hardened' && eventPayload.team_id === myTeamId
        const ownPlacementChanged =
          (event.type === 'placed_curse_armed' && eventPayload.team_id === myTeamId) ||
          (event.type === 'placed_curse_triggered' &&
            eventPayload.owner_team_id === myTeamId)
        // Pause/resume changes automatic GPS behavior immediately. Reconcile
        // from the durable event as well as the games-row subscription so a
        // missed/coalesced UPDATE cannot leave a client performing actions
        // under the wrong phase.
        const phaseChanged = event.type === 'game_paused' || event.type === 'game_resumed'
        if (hardenChanged || ownPlacementChanged || phaseChanged) void reconcile()
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
          const card = payload.new as Card
          if (card.ref === 'intel.surroundings') {
            // The durable DB payload contains a private object_path, while the
            // team-scoped live-state response replaces it with a fresh signed
            // URL. Never overwrite the UI with the raw realtime row.
            void reconcile()
            return
          }
          upsertCard(card)
        },
      )
    }

    channel.subscribe((status) => {
      if (status !== 'SUBSCRIBED') return
      if (hasSubscribed) void reconcile()
      hasSubscribed = true
    })

    // A weather proposal only updates the games row; unlike an applied
    // pause/resume it does not create a durable event. Mobile browsers can
    // occasionally miss that single Postgres Changes message while the page
    // remains visible. Reconcile a lightweight authoritative snapshot on a
    // slow cadence so the opposing team's confirmation prompt still appears.
    const reconcileInterval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reconcile()
    }, 15_000)

    window.addEventListener('online', reconcile)
    document.addEventListener('visibilitychange', reconcileWhenVisible)

    return () => {
      cancelled = true
      window.clearInterval(reconcileInterval)
      window.removeEventListener('online', reconcile)
      document.removeEventListener('visibilitychange', reconcileWhenVisible)
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
    setLiveSnapshot,
  ])
}
