'use client'

import { useEffect, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import type { GpsPosition, PresencePayload } from '@/lib/types'

// Wraps a Supabase Realtime Presence channel keyed by player_id. The channel
// is named game:{gameId}:positions. Every connected phone tracks its latest
// GPS reading; every phone receives the merged presence map.
//
// presence: { [player_id]: latest PresencePayload }.
export function usePresence(
  gameId: string | null,
  myPlayerId: string | null,
  myTeamId: string | null,
  myPosition: GpsPosition | null,
): {
  presence: Record<string, PresencePayload>
} {
  const [presence, setPresence] = useState<Record<string, PresencePayload>>({})
  const channelRef = useRef<RealtimeChannel | null>(null)
  const subscribedRef = useRef(false)
  // Latest payload we want tracked. The track effect reads from here, and
  // the subscribe callback below also reads it so the first publish lands
  // as soon as the subscription completes.
  const pendingPayloadRef = useRef<PresencePayload | null>(null)

  // 1) Subscribe to the channel when ids are known. Cleanup on change/unmount.
  useEffect(() => {
    if (!gameId || !myPlayerId) {
      setPresence({})
      return
    }

    const supabase = createClient()
    const channel = supabase.channel(`game:${gameId}:positions`, {
      config: {
        presence: { key: myPlayerId },
      },
    })

    const rebuild = () => {
      const state = channel.presenceState<PresencePayload>()
      const next: Record<string, PresencePayload> = {}
      for (const [key, entries] of Object.entries(state)) {
        if (!entries || entries.length === 0) continue
        // Each key may have multiple metas if the same key tracks more than
        // once; we pick the most recent by updated_at.
        let best: PresencePayload | null = null
        for (const e of entries) {
          if (!best || (e.updated_at ?? 0) > (best.updated_at ?? 0)) {
            best = e
          }
        }
        if (best) {
          next[key] = best
        }
      }
      setPresence(next)
    }

    channel
      .on('presence', { event: 'sync' }, rebuild)
      .on('presence', { event: 'join' }, rebuild)
      .on('presence', { event: 'leave' }, rebuild)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          subscribedRef.current = true
          // Flush any pending payload accumulated before subscribe completed.
          const pending = pendingPayloadRef.current
          if (pending) {
            channel.track(pending).catch(() => {})
          }
        }
      })

    channelRef.current = channel

    return () => {
      subscribedRef.current = false
      channelRef.current = null
      // untrack is best-effort; removeChannel tears everything down anyway.
      channel.untrack().catch(() => {})
      supabase.removeChannel(channel)
      setPresence({})
    }
  }, [gameId, myPlayerId])

  // 2) Publish my position when it changes (and ids are known).
  useEffect(() => {
    if (!myPlayerId || !myTeamId || !myPosition) return

    const payload: PresencePayload = {
      player_id: myPlayerId,
      team_id: myTeamId,
      lat: myPosition.lat,
      lng: myPosition.lng,
      accuracy: myPosition.accuracy,
      updated_at: myPosition.updated_at,
    }
    pendingPayloadRef.current = payload

    const channel = channelRef.current
    if (!channel || !subscribedRef.current) return

    channel.track(payload).catch(() => {
      // Track may fail if the channel is mid-teardown; the next position
      // update (or the subscribe callback) will retry from pendingPayloadRef.
    })
  }, [myPlayerId, myTeamId, myPosition])

  return { presence }
}
