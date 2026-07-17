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
import cursesSeed from '@/data/curses.json'
import { apiPost } from '@/lib/api'
import { getDeviceId } from '@/lib/device'
import { haversineMeters } from '@/lib/geo/haversine'
import type { ActiveCurse, GpsPosition, PresencePayload } from '@/lib/types'

// Nominal durations from the catalog, for the Frozen gated countdown (E15).
const CURSE_DURATION_MS: Record<string, number> = {}
for (const c of cursesSeed as { id: string; duration_minutes: number | null }[]) {
  if (c.duration_minutes) CURSE_DURATION_MS[c.id] = c.duration_minutes * 60_000
}

const FROZEN = 'curse.frozen'
// Accumulated out-of-place time before we ask the server to extend, and the
// minimum gap between extend calls (keeps the network chatter low).
const EXTEND_DEBT_THRESHOLD_MS = 6_000
const EXTEND_MIN_INTERVAL_MS = 8_000

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
  /**
   * For "stay in place" curses (Frozen): the remaining time computed from
   * accumulated IN-PLACE time only. It pauses while the player is out of place,
   * so the countdown reflects "time served" rather than raw wall-clock (E15).
   */
  remainingMsOverride?: number
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
  /** Needed to extend a Frozen curse's expiry while the player wanders (E15). */
  gameId: string | null
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
  const { activeCurses, myGps, myTeamId, presence, nowMs, gameId, t } = params

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

  // --- Frozen "stay in place" bookkeeping, keyed by curse id (E15) ----------
  // The countdown only advances while the player is within max_drift_m of the
  // anchor captured at curse start. Out-of-place time is accumulated as "debt"
  // and pushed to the server (extend-curse) so wandering prolongs the freeze
  // rather than letting the wall clock run out.
  interface FrozenState {
    anchor: { lat: number; lng: number } | null
    lastTickMs: number
    inPlaceMs: number
    debtMs: number
    lastExtendMs: number
    durationMs: number
    extending: boolean
  }
  const frozenRef = useRef<Record<string, FrozenState>>({})
  const [frozenRemaining, setFrozenRemaining] = useState<
    Record<string, number>
  >({})

  useEffect(() => {
    const liveFrozen = activeCurses.filter(
      (c) => c.curse_ref === FROZEN && isActive(c, nowMs),
    )
    const liveIds = new Set(liveFrozen.map((c) => c.id))
    for (const id of Object.keys(frozenRef.current)) {
      if (!liveIds.has(id)) delete frozenRef.current[id]
    }

    const next: Record<string, number> = {}
    for (const c of liveFrozen) {
      let st = frozenRef.current[c.id]
      if (!st) {
        st = frozenRef.current[c.id] = {
          anchor: myGps ? { lat: myGps.lat, lng: myGps.lng } : null,
          lastTickMs: nowMs,
          inPlaceMs: 0,
          debtMs: 0,
          lastExtendMs: 0,
          durationMs: CURSE_DURATION_MS[c.curse_ref] ?? 8 * 60_000,
          extending: false,
        }
      }
      if (st.anchor == null && myGps) {
        st.anchor = { lat: myGps.lat, lng: myGps.lng }
      }
      const dt = Math.max(0, nowMs - st.lastTickMs)
      st.lastTickMs = nowMs
      const maxDrift = numParam(c.params, 'max_drift_m', 10)
      // Without a GPS fix we can't verify, so give the benefit of the doubt and
      // let the timer run (honor system — no penalty for GPS gaps).
      let inPlace = true
      if (myGps && st.anchor) {
        inPlace =
          haversineMeters(st.anchor, { lat: myGps.lat, lng: myGps.lng }) <=
          maxDrift
      }
      if (inPlace) st.inPlaceMs += dt
      else st.debtMs += dt
      next[c.id] = Math.max(0, st.durationMs - st.inPlaceMs)

      if (
        gameId &&
        st.debtMs >= EXTEND_DEBT_THRESHOLD_MS &&
        !st.extending &&
        nowMs - st.lastExtendMs >= EXTEND_MIN_INTERVAL_MS
      ) {
        const extendSeconds = Math.min(120, Math.round(st.debtMs / 1000))
        st.debtMs = 0
        st.lastExtendMs = nowMs
        st.extending = true
        apiPost(`/api/games/${gameId}/extend-curse`, {
          device_id: getDeviceId(),
          curse_id: c.id,
          extend_seconds: extendSeconds,
        })
          .catch(() => {})
          .finally(() => {
            const cur = frozenRef.current[c.id]
            if (cur) cur.extending = false
          })
      }
    }

    setFrozenRemaining((prev) => {
      const prevKeys = Object.keys(prev)
      const nextKeys = Object.keys(next)
      if (
        prevKeys.length === nextKeys.length &&
        nextKeys.every((k) => prev[k] === next[k])
      ) {
        return prev
      }
      return next
    })
  }, [nowMs, activeCurses, myGps, gameId])

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
        const anchor = frozenRef.current[c.id]?.anchor ?? null
        if (myGps && anchor) {
          const drift = haversineMeters(anchor, {
            lat: myGps.lat,
            lng: myGps.lng,
          })
          const maxDrift = numParam(c.params, 'max_drift_m', 10)
          entry.readout = {
            text: t('curse.readout_drift', { m: Math.round(drift) }),
            ok: drift <= maxDrift,
          }
        }
        const rem = frozenRemaining[c.id]
        if (rem != null) entry.remainingMsOverride = rem
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

      if (entry.readout || entry.prompt || entry.remainingMsOverride != null) {
        byCurseId[c.id] = entry
      }
    }

    return { actionsLocked, byCurseId }
  }, [
    activeCurses,
    myGps,
    myTeamId,
    presence,
    nowMs,
    speedKmh,
    frozenRemaining,
    t,
  ])
}
