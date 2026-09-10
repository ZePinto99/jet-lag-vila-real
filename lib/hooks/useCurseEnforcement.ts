'use client'

// useCurseEnforcement — turns the curses currently on MY team into something
// the player actually feels (PLAYTEST_TRIAGE P2-6 / P1-3 / P1-4). Scope per the
// "felt, mostly honor" decision:
//   - [L] Full Stop  → actionsLocked: the live view disables every action button
//   - [L] Check-in   → a 60 s prompt the player taps to acknowledge (honor)
//   - [B] photo curses (single-file / photo-tax / outfit-swap / pose-patrol)
//                     → timed, server-verified private proof-photo prompts
//   - [A] movement curses (slow-walk / frozen / buddy-up / solo-quarantine)
//                     → live informational readouts (speed / drift / team spread).
//                       NO automated penalty — GPS noise would punish unfairly.
//
// Everything is derivation; no network calls. Expiry is still handled by the
// existing /expire-curses poll + active_curses realtime.

import { useEffect, useMemo, useRef, useState } from 'react'
import { apiPost } from '@/lib/api'
import { getDeviceId } from '@/lib/device'
import { getCurseProofWindow, PHOTO_VERIFIED_CURSE_REFS } from '@/lib/curses/proofWindows'
import { haversineMeters } from '@/lib/geo/haversine'
import { isPositionFresh } from '@/lib/geo/positionFreshness'
import { distanceToPolylineMeters, type GeoPoint } from '@/lib/geo/polyline'
import { getSeedLandmarkByRef } from '@/lib/landmarks'
import type { ActiveCurse, GpsPosition, PresencePayload } from '@/lib/types'

const FROZEN = 'curse.frozen'
const VIOLATION_REPORT_INTERVAL_MS = 2_000

function isTerminalCurseRequestError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return error.message === 'curse_not_found' || error.message === 'game_not_in_play'
}

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
  /** Present only for [B] prompts that require a durable proof photo. */
  proofRequired?: boolean
  promptIndex?: number
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
  /** User-facing reason for the action lock (Full Stop or Pilgrimage). */
  actionsLockedLabel: string | null
  /** Per-curse-id enforcement extras for the banner. */
  byCurseId: Record<string, CurseEnforcementEntry>
}

export interface UseCurseEnforcementParams {
  activeCurses: ActiveCurse[]
  myGps: GpsPosition | null
  myPlayerId?: string | null
  myTeamId: string | null
  presence: Record<string, PresencePayload>
  nowMs: number
  /** Real wall clock for GPS freshness and server report timestamps. */
  wallNowMs?: number
  /** Needed to extend a Frozen curse's expiry while the player wanders (E15). */
  gameId: string | null
  /** False during a weather pause: keep readouts visible but emit no actions. */
  gameplayActive?: boolean
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

function polylineParam(
  params: Record<string, unknown> | null | undefined,
  key: string,
): GeoPoint[] {
  const raw = params?.[key]
  if (!Array.isArray(raw)) return []
  const points: GeoPoint[] = []
  for (const value of raw) {
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'number' &&
      typeof value[1] === 'number'
    ) {
      points.push({ lat: value[0], lng: value[1] })
    }
  }
  return points
}

export function useCurseEnforcement(params: UseCurseEnforcementParams): UseCurseEnforcementResult {
  const {
    activeCurses,
    myGps,
    myPlayerId = null,
    myTeamId,
    presence,
    nowMs,
    wallNowMs = nowMs,
    gameId,
    gameplayActive = true,
    t,
  } = params

  // --- live speed estimate (for Slow Walk) ----------------------------------
  const [speedKmh, setSpeedKmh] = useState<number | null>(null)
  const lastSampleRef = useRef<{ lat: number; lng: number; ts: number } | null>(null)
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

  // --- Frozen durable anchor + violation reporting (E15) --------------------
  // Anchors are first-write-wins server state, so reloading after moving cannot
  // reset the start position. The server unions one-second violation buckets
  // across teammates, making simultaneous reports overlap-safe.
  interface FrozenState {
    anchor: { lat: number; lng: number } | null
    anchorRequesting: boolean
    lastTickMs: number
    unreportedStartMs: number | null
    pausedPendingViolationMs: number
    reporting: boolean
    terminal: boolean
  }
  interface FrozenStateResponse {
    anchor: { lat: number; lng: number }
  }
  const frozenRef = useRef<Record<string, FrozenState>>({})
  const [frozenAnchors, setFrozenAnchors] = useState<Record<string, { lat: number; lng: number }>>(
    {},
  )

  useEffect(() => {
    if (!gameplayActive) {
      for (const state of Object.values(frozenRef.current)) {
        if (state.unreportedStartMs != null) {
          // Preserve the small genuine violation interval accumulated before
          // the pause, but never include paused wall time. It is replayed as a
          // fresh interval after resume so the server freshness guard accepts
          // it even after a long weather pause.
          state.pausedPendingViolationMs += Math.max(0, state.lastTickMs - state.unreportedStartMs)
          state.unreportedStartMs = null
        }
        state.lastTickMs = wallNowMs
      }
      return
    }
    const liveFrozen = activeCurses.filter((c) => c.curse_ref === FROZEN && isActive(c, nowMs))
    const liveIds = new Set(liveFrozen.map((c) => c.id))
    for (const id of Object.keys(frozenRef.current)) {
      if (!liveIds.has(id)) delete frozenRef.current[id]
    }

    for (const c of liveFrozen) {
      let st = frozenRef.current[c.id]
      if (!st) {
        st = frozenRef.current[c.id] = {
          anchor: null,
          anchorRequesting: false,
          lastTickMs: wallNowMs,
          unreportedStartMs: null,
          pausedPendingViolationMs: 0,
          reporting: false,
          terminal: false,
        }
      }
      if (st.terminal) continue
      const previousTickMs = st.lastTickMs
      st.lastTickMs = wallNowMs
      const maxDrift = numParam(c.params, 'max_drift_m', 10)

      const freshGps = myGps && isPositionFresh(myGps.updated_at, wallNowMs) ? myGps : null
      if (!st.anchor && !st.anchorRequesting && freshGps && gameId && myPlayerId) {
        st.anchorRequesting = true
        apiPost<FrozenStateResponse>(`/api/games/${gameId}/extend-curse`, {
          device_id: getDeviceId(),
          player_id: myPlayerId,
          curse_id: c.id,
          anchor_pos: freshGps,
        })
          .then((response) => {
            const cur = frozenRef.current[c.id]
            if (!cur) return
            cur.anchor = response.anchor
            setFrozenAnchors((prev) => ({ ...prev, [c.id]: response.anchor }))
          })
          .catch((error: unknown) => {
            const cur = frozenRef.current[c.id]
            if (cur && isTerminalCurseRequestError(error)) cur.terminal = true
          })
          .finally(() => {
            const cur = frozenRef.current[c.id]
            if (cur) cur.anchorRequesting = false
          })
      }

      if (!st.anchor || !gameId || !myPlayerId) continue
      const inPlace = Boolean(freshGps && haversineMeters(st.anchor, freshGps) <= maxDrift)

      if (st.pausedPendingViolationMs > 0 && !st.reporting) {
        const pendingMs = st.pausedPendingViolationMs
        st.pausedPendingViolationMs = 0
        st.unreportedStartMs = inPlace ? null : wallNowMs
        st.reporting = true
        apiPost<FrozenStateResponse>(`/api/games/${gameId}/extend-curse`, {
          device_id: getDeviceId(),
          player_id: myPlayerId,
          curse_id: c.id,
          violation: { started_at: wallNowMs - pendingMs, ended_at: wallNowMs },
        })
          .then((response) => {
            const cur = frozenRef.current[c.id]
            if (!cur) return
            cur.anchor = response.anchor
            setFrozenAnchors((prev) => ({ ...prev, [c.id]: response.anchor }))
          })
          .catch((error: unknown) => {
            const cur = frozenRef.current[c.id]
            if (!cur) return
            if (isTerminalCurseRequestError(error)) cur.terminal = true
            else cur.pausedPendingViolationMs += pendingMs
          })
          .finally(() => {
            const cur = frozenRef.current[c.id]
            if (cur) cur.reporting = false
          })
        continue
      }
      if (!inPlace && st.unreportedStartMs == null) {
        st.unreportedStartMs = previousTickMs
      }

      const pendingMs = st.unreportedStartMs == null ? 0 : wallNowMs - st.unreportedStartMs
      const shouldReport =
        !st.reporting &&
        st.unreportedStartMs != null &&
        (pendingMs >= VIOLATION_REPORT_INTERVAL_MS || (inPlace && pendingMs >= 500))
      if (shouldReport) {
        const reportStartMs = st.unreportedStartMs!
        const reportEndMs = wallNowMs
        st.unreportedStartMs = inPlace ? null : reportEndMs
        st.reporting = true
        apiPost<FrozenStateResponse>(`/api/games/${gameId}/extend-curse`, {
          device_id: getDeviceId(),
          player_id: myPlayerId,
          curse_id: c.id,
          violation: { started_at: reportStartMs, ended_at: reportEndMs },
        })
          .then((response) => {
            const cur = frozenRef.current[c.id]
            if (!cur) return
            cur.anchor = response.anchor
            setFrozenAnchors((prev) => ({ ...prev, [c.id]: response.anchor }))
          })
          .catch((error: unknown) => {
            const cur = frozenRef.current[c.id]
            if (cur) {
              if (isTerminalCurseRequestError(error)) {
                cur.terminal = true
                return
              }
              cur.unreportedStartMs = Math.min(
                cur.unreportedStartMs ?? reportStartMs,
                reportStartMs,
              )
            }
          })
          .finally(() => {
            const cur = frozenRef.current[c.id]
            if (cur) cur.reporting = false
          })
      } else if (inPlace) {
        st.unreportedStartMs = null
      }
    }
  }, [nowMs, wallNowMs, activeCurses, myGps, myPlayerId, gameId, gameplayActive])

  // Pilgrimage is geofence-gated. While active, all regular actions stay
  // locked; arriving within 30 m calls the server-authoritative completion
  // route, which removes the curse for the whole team via realtime.
  const completingPilgrimagesRef = useRef<Set<string>>(new Set())
  const terminalPilgrimagesRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!gameplayActive) return
    if (!gameId || !myPlayerId || !myGps || !isPositionFresh(myGps.updated_at, wallNowMs)) return
    const liveIds = new Set<string>()
    for (const curse of activeCurses) {
      if (curse.curse_ref !== 'curse.pilgrimage' || !isActive(curse, nowMs)) continue
      liveIds.add(curse.id)
      const targetRef =
        typeof curse.params?.target_landmark_ref === 'string'
          ? curse.params.target_landmark_ref
          : null
      const target = targetRef ? getSeedLandmarkByRef(targetRef) : null
      if (!target) continue
      const distance = haversineMeters(myGps, target)
      if (
        distance > 30 ||
        completingPilgrimagesRef.current.has(curse.id) ||
        terminalPilgrimagesRef.current.has(curse.id)
      ) {
        continue
      }
      completingPilgrimagesRef.current.add(curse.id)
      apiPost(`/api/games/${gameId}/complete-pilgrimage`, {
        device_id: getDeviceId(),
        player_id: myPlayerId,
        curse_id: curse.id,
        pos: myGps,
      }).catch((error: unknown) => {
        if (isTerminalCurseRequestError(error)) terminalPilgrimagesRef.current.add(curse.id)
        completingPilgrimagesRef.current.delete(curse.id)
      })
    }
    for (const id of completingPilgrimagesRef.current) {
      if (!liveIds.has(id)) completingPilgrimagesRef.current.delete(id)
    }
    for (const id of terminalPilgrimagesRef.current) {
      if (!liveIds.has(id)) terminalPilgrimagesRef.current.delete(id)
    }
  }, [activeCurses, gameId, myGps, myPlayerId, nowMs, wallNowMs, gameplayActive])

  return useMemo<UseCurseEnforcementResult>(() => {
    const live = activeCurses.filter((c) => isActive(c, nowMs))
    const fullStopActive = live.some((c) => c.curse_ref === FULL_STOP)
    const pilgrimageActive = live.some((c) => c.curse_ref === 'curse.pilgrimage')
    const actionsLocked = fullStopActive || pilgrimageActive
    const actionsLockedLabel = fullStopActive
      ? t('curse.actions_locked')
      : pilgrimageActive
        ? t('curse.pilgrimage_locked')
        : null

    // Team spread (for Buddy Up / Solo Quarantine): max pairwise distance
    // among my team's presence entries.
    let teamSpreadM: number | null = null
    if (myTeamId) {
      const mates = Object.values(presence).filter(
        (p) => p.team_id === myTeamId && isPositionFresh(p.updated_at, wallNowMs),
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
        const anchor = frozenAnchors[c.id] ?? frozenRef.current[c.id]?.anchor ?? null
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
          const maxPair = numParam(c.params, 'max_pairwise_distance_m', 50)
          entry.readout = {
            text: t('curse.readout_quarantine', { m: Math.round(teamSpreadM) }),
            ok: teamSpreadM <= maxPair,
          }
        }
      } else if (ref === 'curse.detour') {
        const streetName =
          typeof c.params?.banned_street_name === 'string'
            ? c.params.banned_street_name
            : t('curse.detour_unknown_street')
        const geometry = polylineParam(c.params, 'banned_street_polyline')
        if (myGps && isPositionFresh(myGps.updated_at, wallNowMs) && geometry.length > 0) {
          const distance = distanceToPolylineMeters(myGps, geometry)
          const corridor = numParam(c.params, 'corridor_m', 18)
          entry.readout = {
            text: t('curse.readout_detour', {
              name: streetName,
              m: Math.round(distance),
            }),
            ok: distance > corridor,
          }
        }
      } else if (ref === 'curse.pilgrimage') {
        const targetRef =
          typeof c.params?.target_landmark_ref === 'string' ? c.params.target_landmark_ref : null
        const target = targetRef ? getSeedLandmarkByRef(targetRef) : null
        if (myGps && target) {
          const distance = haversineMeters(myGps, target)
          entry.readout = {
            text: t('curse.readout_pilgrimage', {
              name: target.name,
              m: Math.round(distance),
            }),
            ok: distance <= 30,
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
                  : ref === 'curse.mute'
                    ? 'curse.prompt.mute'
                    : ref === 'curse.backwards'
                      ? 'curse.prompt.backwards'
                      : ref === 'curse.detour'
                        ? 'curse.prompt.detour'
                        : null

      if (promptLabelKey) {
        if (PHOTO_VERIFIED_CURSE_REFS.has(ref)) {
          const proofWindow = getCurseProofWindow(c, nowMs)
          if (proofWindow) {
            entry.prompt = {
              label: t(promptLabelKey),
              secondsLeft: proofWindow.secondsLeft,
              proofRequired: true,
              promptIndex: proofWindow.promptIndex,
            }
          }
        } else {
          const intervalS =
            ref === 'curse.mute'
              ? numParam(c.params, 'ping_interval_seconds', 60)
              : numParam(c.params, 'interval_seconds', 0)
          const windowS = numParam(c.params, 'submission_window_seconds', 30)
          if (intervalS > 0) {
            const intoInterval = elapsedS % intervalS
            if (intoInterval < windowS) {
              const baseLabel =
                ref === 'curse.detour'
                  ? t(promptLabelKey, {
                      name:
                        typeof c.params?.banned_street_name === 'string'
                          ? c.params.banned_street_name
                          : t('curse.detour_unknown_street'),
                    })
                  : t(promptLabelKey)
              entry.prompt = {
                label: baseLabel,
                secondsLeft: Math.max(0, windowS - intoInterval),
              }
            }
          } else {
            // No interval (e.g. single-file's prompts_per_curse / outfit-swap's
            // before/after): show a persistent reminder, no countdown.
            entry.prompt = {
              label:
                ref === 'curse.detour'
                  ? t(promptLabelKey, {
                      name:
                        typeof c.params?.banned_street_name === 'string'
                          ? c.params.banned_street_name
                          : t('curse.detour_unknown_street'),
                    })
                  : t(promptLabelKey),
              secondsLeft: 0,
            }
          }
        }
      }

      if (entry.readout || entry.prompt || entry.remainingMsOverride != null) {
        byCurseId[c.id] = entry
      }
    }

    return { actionsLocked, actionsLockedLabel, byCurseId }
  }, [activeCurses, myGps, myTeamId, presence, nowMs, wallNowMs, speedKmh, frozenAnchors, t])
}
