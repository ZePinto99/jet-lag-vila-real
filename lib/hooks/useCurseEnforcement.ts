'use client'

// useCurseEnforcement — turns the curses currently on MY team into something
// the player actually feels (PLAYTEST_TRIAGE P2-6 / P1-3 / P1-4). Scope per the
// "felt, mostly honor" decision:
//   - [L] Full Stop  → actionsLocked: the live view disables every action button
//   - [L] Check-in   → a 60 s prompt the player taps to acknowledge (honor)
//   - [B] photo curses (single-file / photo-tax / outfit-swap / pose-patrol)
//                     → timed prompts with a submission-window countdown (honor)
//   - [A] movement curses (slow-walk / frozen / buddy-up / solo-quarantine)
//                     → live informational readouts (speed / drift / team spread).
//                       NO automated penalty — GPS noise would punish unfairly.
//
// Everything is derivation; no network calls. Expiry is still handled by the
// existing /expire-curses poll + active_curses realtime.

import { useEffect, useMemo, useRef, useState } from 'react'
import { haversineMeters } from '@/lib/geo/haversine'
import type { ActiveCurse, GpsPosition, PresencePayload } from '@/lib/types'

export interface CurseReadout {
  /** i18n key for the label, with already-substituted value inside. */
  text: string
  /** false when the player is currently breaching the (honor) constraint. */
  ok: boolean
}

export interface CursePrompt {
  /** Human label (already translated) for the action to perform. */
  label: string
  /** Seconds left in the current submission window. */
  secondsLeft: number
}

export interface CurseEnforcementEntry {
  readout?: CurseReadout
  prompt?: CursePrompt
}

export interface UseCurseEnforcementResult {
  /** True while a non-expired Full Stop curse is on the team. */
  actionsLocked: boolean
  /** Per-curse-id enforcement extras for the banner. */
  byCurseId: Record<string, CurseEnforcementEntry>
}

export interface UseCurseEnforcementParams {
  activeCurses: ActiveCurse[]
  myGps: GpsPosition | null
  myTeamId: string | null
  presence: Record<string, PresencePayload>
  nowMs: number
  t: (key: string, tokens?: Record<string, string | number>) => string
}

const FULL_STOP = 'curse.full-stop'

function isActive(c: ActiveCurse, nowMs: number): boolean {
  if (!c.expires_at) return true
  return new Date(c.expires_at).getTime() > nowMs
}

function numParam(
  params: Record<string, unknown> | null | undefined,
  key: string,
  fallback: number,
): number {
  const v = params?.[key]
  return typeof v === 'number' ? v : fallback
}

export function useCurseEnforcement(
  params: UseCurseEnforcementParams,
): UseCurseEnforcementResult {
  const { activeCurses, myGps, myTeamId, presence, nowMs, t } = params

  // --- live speed estimate (for Slow Walk) ----------------------------------
  const [speedKmh, setSpeedKmh] = useState<number | null>(null)
  const lastSampleRef = useRef<{ lat: number; lng: number; ts: number } | null>(
    null,
  )
  useEffect(() => {
    if (!myGps) {
      lastSampleRef.current = null
      setSpeedKmh(null)
      return
    }
    const prev = lastSampleRef.current
    const ts = myGps.updated_at
    if (prev && ts > prev.ts) {
      const meters = haversineMeters(
        { lat: prev.lat, lng: prev.lng },
        { lat: myGps.lat, lng: myGps.lng },
      )
      const hours = (ts - prev.ts) / 3_600_000
      if (hours > 0) setSpeedKmh(meters / 1000 / hours)
    }
    lastSampleRef.current = { lat: myGps.lat, lng: myGps.lng, ts }
  }, [myGps])

  // --- captured "start" positions for Frozen, keyed by curse id -------------
  const startPosRef = useRef<Record<string, { lat: number; lng: number }>>({})

  // Drop captured start positions for curses no longer present so the map
  // doesn't grow unbounded across a long game.
  useEffect(() => {
    const liveIds = new Set(activeCurses.map((c) => c.id))
    for (const id of Object.keys(startPosRef.current)) {
      if (!liveIds.has(id)) delete startPosRef.current[id]
    }
  }, [activeCurses])

  return useMemo<UseCurseEnforcementResult>(() => {
    const live = activeCurses.filter((c) => isActive(c, nowMs))
    const actionsLocked = live.some((c) => c.curse_ref === FULL_STOP)

    // Team spread (for Buddy Up / Solo Quarantine): max pairwise distance
    // among my team's presence entries.
    let teamSpreadM: number | null = null
    if (myTeamId) {
      const mates = Object.values(presence).filter(
        (p) => p.team_id === myTeamId,
      )
      if (mates.length >= 2) {
        let max = 0
        for (let i = 0; i < mates.length; i++) {
          for (let j = i + 1; j < mates.length; j++) {
            const d = haversineMeters(
              { lat: mates[i].lat, lng: mates[i].lng },
              { lat: mates[j].lat, lng: mates[j].lng },
            )
            if (d > max) max = d
          }
        }
        teamSpreadM = max
      }
    }

    const byCurseId: Record<string, CurseEnforcementEntry> = {}

    for (const c of live) {
      const ref = c.curse_ref
      const startedMs = new Date(c.started_at).getTime()
      const elapsedS = Math.max(0, Math.floor((nowMs - startedMs) / 1000))
      const entry: CurseEnforcementEntry = {}

      // -- [A] movement readouts --
      if (ref === 'curse.slow-walk') {
        const maxKmh = numParam(c.params, 'max_speed_kmh', 2.5)
        if (speedKmh != null) {
          entry.readout = {
            text: t('curse.readout_speed', { kmh: speedKmh.toFixed(1) }),
            ok: speedKmh <= maxKmh,
          }
        }
      } else if (ref === 'curse.frozen') {
        if (myGps) {
          if (!startPosRef.current[c.id]) {
            startPosRef.current[c.id] = { lat: myGps.lat, lng: myGps.lng }
          }
          const start = startPosRef.current[c.id]
          const drift = haversineMeters(start, {
            lat: myGps.lat,
            lng: myGps.lng,
          })
          const maxDrift = numParam(c.params, 'max_drift_m', 10)
          entry.readout = {
            text: t('curse.readout_drift', { m: Math.round(drift) }),
            ok: drift <= maxDrift,
          }
        }
      } else if (ref === 'curse.buddy-up') {
        if (teamSpreadM != null) {
          const maxPair = numParam(c.params, 'max_pairwise_distance_m', 10)
          entry.readout = {
            text: t('curse.readout_spread', { m: Math.round(teamSpreadM) }),
            ok: teamSpreadM <= maxPair,
          }
        }
      } else if (ref === 'curse.solo-quarantine') {
        if (teamSpreadM != null) {
          const minPair = numParam(c.params, 'min_pairwise_distance_m', 50)
          // For solo-quarantine "ok" means everyone is far apart. We only have
          // the max spread cheaply; treat ok when the spread already clears the
          // minimum (a coarse honor hint, not enforcement).
          entry.readout = {
            text: t('curse.readout_spread', { m: Math.round(teamSpreadM) }),
            ok: teamSpreadM >= minPair,
          }
        }
      }

      // -- [B] photo prompts + [L] check-in (timed windows) --
      const promptLabelKey =
        ref === 'curse.single-file'
          ? 'curse.prompt.single-file'
          : ref === 'curse.photo-tax'
            ? 'curse.prompt.photo-tax'
            : ref === 'curse.outfit-swap'
              ? 'curse.prompt.outfit-swap'
              : ref === 'curse.pose-patrol'
                ? 'curse.prompt.pose-patrol'
                : ref === 'curse.check-in'
                  ? 'curse.checkin_prompt'
                  : null

      if (promptLabelKey) {
        const intervalS = numParam(c.params, 'interval_seconds', 0)
        const windowS = numParam(c.params, 'submission_window_seconds', 30)
        if (intervalS > 0) {
          const intoInterval = elapsedS % intervalS
          if (intoInterval < windowS) {
            const baseLabel = t(promptLabelKey)
            entry.prompt = {
              label: baseLabel,
              secondsLeft: Math.max(0, windowS - intoInterval),
            }
          }
        } else {
          // No interval (e.g. single-file's prompts_per_curse / outfit-swap's
          // before/after): show a persistent reminder, no countdown.
          entry.prompt = { label: t(promptLabelKey), secondsLeft: 0 }
        }
      }

      if (entry.readout || entry.prompt) byCurseId[c.id] = entry
    }

    return { actionsLocked, byCurseId }
  }, [activeCurses, myGps, myTeamId, presence, nowMs, speedKmh, t])
}
