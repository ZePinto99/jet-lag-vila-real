'use client'

// useGameToasts — in-app discovery notifications (PLAYTEST_TRIAGE P2-5).
//
// Two stages, foregrounded PWA only (no Notification API, no native push):
//   1. Attempt start  — driven by `flag_attempt_started` events.
//   2. Attempt resolve — driven by `flag_found` (real) and `flag_attempt`
//                        (decoy/empty) events.
// Plus an enemy-proximity ping when an enemy raider enters one of MY defense
// zones (presence-derived, fired once per entry).
//
// The attempter themselves never gets a toast (they have the in-UI result).

import { useEffect, useRef, useState } from 'react'
import { haversineMeters } from '@/lib/geo/haversine'
import { DEFENSE_ZONE_RADIUS_M } from '@/lib/geo/zones'
import { getSeedLandmarkByRef } from '@/lib/landmarks'
import type {
  GameEvent,
  Landmark,
  Player,
  PresencePayload,
} from '@/lib/types'

export type ToastTone = 'alert' | 'info' | 'success' | 'warn'

export interface GameToast {
  id: string
  text: string
  tone: ToastTone
}

const MAX_VISIBLE = 4
const TOAST_TTL_MS = 6000

interface UseGameToastsParams {
  events: GameEvent[]
  myTeamId: string | null
  myPlayerId: string | null
  players: Player[]
  presence: Record<string, PresencePayload>
  myTeamLandmarks: Landmark[]
  t: (key: string, tokens?: Record<string, string | number>) => string
}

function landmarkName(ref: string): string {
  return getSeedLandmarkByRef(ref)?.name ?? ref
}

export function useGameToasts({
  events,
  myTeamId,
  myPlayerId,
  players,
  presence,
  myTeamLandmarks,
  t,
}: UseGameToastsParams): {
  toasts: GameToast[]
  dismiss: (id: string) => void
} {
  const [toasts, setToasts] = useState<GameToast[]>([])
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Stable push that auto-expires. seq ref guarantees unique ids.
  const seqRef = useRef(0)
  const pushRef = useRef<(text: string, tone: ToastTone) => void>(() => {})
  pushRef.current = (text: string, tone: ToastTone) => {
    const id = `t${seqRef.current++}`
    setToasts((prev) => [...prev, { id, text, tone }].slice(-MAX_VISIBLE))
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id))
      timersRef.current.delete(id)
    }, TOAST_TTL_MS)
    timersRef.current.set(id, timer)
  }

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  }, [])

  // --- event-driven toasts ---------------------------------------------------
  // Seed with the snapshot's events on first run so we never toast history.
  const processedRef = useRef<Set<string>>(new Set())
  const seededRef = useRef(false)
  useEffect(() => {
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
  }, [events, myTeamId, myPlayerId])

  function handleEvent(e: GameEvent) {
    const p = e.payload as Record<string, unknown>

    // NOTE: flag_found, tag and placed_curse_triggered are handled by
    // useGameMoments (the animated big-moment overlay), not here.

    const ref = typeof p.landmark_ref === 'string' ? p.landmark_ref : null
    if (!ref) return
    const name = landmarkName(ref)
    const attackerTeam = typeof p.team_id === 'string' ? p.team_id : null
    const iAmAttacker = attackerTeam != null && attackerTeam === myTeamId

    if (e.type === 'flag_attempt_started') {
      const defendingTeam =
        typeof p.defending_team_id === 'string' ? p.defending_team_id : null
      if (defendingTeam === myTeamId) {
        pushRef.current(t('toast.defender_attempt_start', { name }), 'alert')
      } else if (iAmAttacker && e.actor_player_id !== myPlayerId) {
        const player =
          players.find((pl) => pl.id === e.actor_player_id)?.display_name ??
          'Teammate'
        pushRef.current(
          t('toast.teammate_attempt_start', { player, name }),
          'info',
        )
      }
      return
    }

    if (e.type === 'flag_attempt') {
      const result = typeof p.result === 'string' ? p.result : null
      if (result !== 'decoy' && result !== 'empty') return // 'real' → flag_found
      if (iAmAttacker) {
        if (e.actor_player_id !== myPlayerId) {
          pushRef.current(t('toast.teammate_attempt_failed', { name }), 'info')
        }
      } else {
        pushRef.current(t('toast.defender_failed', { name }), 'info')
      }
    }
  }

  // --- enemy-proximity ping --------------------------------------------------
  // Fire once when an enemy enters any of my defense zones; reset on exit so a
  // re-entry pings again.
  const enemiesInZoneRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!myTeamId || myTeamLandmarks.length === 0) return
    const stillInside = new Set<string>()
    for (const entry of Object.values(presence)) {
      if (!entry || entry.team_id === myTeamId) continue
      let nearestRef: string | null = null
      let nearestDist = Infinity
      for (const lm of myTeamLandmarks) {
        const d = haversineMeters(
          { lat: entry.lat, lng: entry.lng },
          { lat: lm.lat, lng: lm.lng },
        )
        if (d < nearestDist) {
          nearestDist = d
          nearestRef = lm.ref
        }
      }
      if (nearestRef != null && nearestDist <= DEFENSE_ZONE_RADIUS_M) {
        stillInside.add(entry.player_id)
        if (!enemiesInZoneRef.current.has(entry.player_id)) {
          pushRef.current(
            t('toast.enemy_near', { name: landmarkName(nearestRef) }),
            'warn',
          )
        }
      }
    }
    enemiesInZoneRef.current = stillInside
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presence, myTeamId, myTeamLandmarks])

  function dismiss(id: string) {
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
    setToasts((prev) => prev.filter((x) => x.id !== id))
  }

  return { toasts, dismiss }
}
