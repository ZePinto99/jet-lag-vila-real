'use client'

// Flag-attempt button (rulebook §5.2).
//
// Companion to TagButton — same UX shape, big amber button when enabled. The
// useFlagAttemptButton hook does all the proximity / state checks; this
// component renders the result, asks for confirmation, POSTs to
// /api/games/[id]/attempt-flag, and surfaces a short status line summarising
// the outcome (real / decoy / empty).
//
// On 'real', the realtime games update will flip status to 'flag_found' and
// the parent will swap in the FlagCarrierBanner.
// On 'decoy', the team's intel cards are expired server-side; the realtime
// card updates propagate that.

import { useRef, useState } from 'react'
import seedLandmarks from '@/data/landmarks.json'
import { apiPost } from '@/lib/api'
import { cn } from '@/lib/cn'
import { getDeviceId } from '@/lib/device'
import { createClient } from '@/lib/supabase/client'
import { useI18n } from '@/lib/i18n/context'
import { localizeCatalogField } from '@/lib/i18n/gameCatalog'
import { getFlagAttemptText } from '@/lib/flagChallenges'
import type {
  AttemptFlagRequest,
  AttemptFlagResponse,
  EnemyLandmark,
  FlagAttemptResult,
  GpsPosition,
  SeedLandmark,
} from '@/lib/types'
import {
  FLAG_ATTEMPT_RADIUS_M,
  type FlagAttemptDisabledReason,
} from '@/lib/hooks/useFlagAttemptButton'

const SEED = seedLandmarks as SeedLandmark[]

function landmarkName(ref: string, locale: 'en' | 'pt'): string {
  const fallback = SEED.find((s) => s.id === ref)?.name ?? ref
  return localizeCatalogField(ref, 'name', fallback, locale)
}

interface FlagAttemptButtonProps {
  gameId: string
  myPlayerId: string
  myGpsPos: GpsPosition | null
  meState: {
    enabled: boolean
    visible: boolean
    target: EnemyLandmark | null
    distance_m: number | null
    reason: FlagAttemptDisabledReason
  }
  /** When set (e.g. Full Stop curse active), the button is forced off and this
   *  label is shown as the reason. */
  lockedLabel?: string | null
  onResult?: (result: AttemptFlagResponse) => void
  onPanelOpenChange?: (open: boolean) => void
}

function reasonLabel(reason: FlagAttemptDisabledReason, t: Translate): string {
  switch (reason) {
    case 'no_gps':
      return t('flag_attempt.reason_no_gps')
    case 'respawning':
      return t('flag_attempt.reason_respawning')
    case 'not_live':
      return t('flag_attempt.reason_not_live')
    case 'no_landmark_in_range':
      return t('flag_attempt.reason_out_of_range', {
        m: FLAG_ATTEMPT_RADIUS_M,
      })
    case 'already_discovered':
      return t('flag_attempt.reason_discovered')
    case 'enabled':
    default:
      return ''
  }
}

type ResultTone = 'real' | 'decoy' | 'empty'

type Translate = (key: string, tokens?: Record<string, string | number>) => string

function resultMessage(
  result: FlagAttemptResult,
  t: Translate,
): {
  text: string
  tone: ResultTone
} {
  switch (result) {
    case 'real':
      return { text: t('flag_attempt.toast_real'), tone: 'real' }
    case 'decoy':
      return { text: t('flag_attempt.toast_decoy'), tone: 'decoy' }
    case 'empty':
      return { text: t('flag_attempt.toast_empty'), tone: 'empty' }
  }
}

// Map known server/client error codes to friendly, translated text.
function friendlyAttemptError(
  code: string,
  t: (key: string, tokens?: Record<string, string | number>) => string,
): string {
  const known = new Set([
    'attempts_locked',
    'landmark_locked_out',
    'out_of_geofence',
    'photo_required',
    'photo_upload_failed',
  ])
  return known.has(code) ? t(`attempt.err_${code}`) : t('attempt.err_generic')
}

// Upload the attempt photo to the public `flag-attempts` Storage bucket
// (migration 0009) and return its public URL.
async function uploadAttemptPhoto(gameId: string, playerId: string, file: File): Promise<string> {
  const supabase = createClient()
  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${gameId}/${playerId}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('flag-attempts').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'image/jpeg',
  })
  if (error) throw error
  const { data } = supabase.storage.from('flag-attempts').getPublicUrl(path)
  return data.publicUrl
}

export function FlagAttemptButton({
  gameId,
  myPlayerId,
  myGpsPos,
  meState,
  lockedLabel,
  onResult,
  onPanelOpenChange,
}: FlagAttemptButtonProps) {
  const { locale, t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<AttemptFlagResponse | null>(null)
  // The "confirm" step is now the mini-challenge panel (P2-1): task + photo +
  // optional answer. Replaces window.confirm (PWA-unreliable, P0-3).
  const [confirming, setConfirming] = useState(false)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [answer, setAnswer] = useState('')
  const [pinnedTarget, setPinnedTarget] = useState<EnemyLandmark | null>(null)
  const [pinnedDistanceM, setPinnedDistanceM] = useState<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const locked = Boolean(lockedLabel)
  const { target, distance_m, reason } = meState
  const enabled = meState.enabled && !locked
  const activeTarget = confirming ? pinnedTarget : target
  const activeDistanceM = confirming ? (distance_m ?? pinnedDistanceM) : distance_m
  const targetName = activeTarget ? landmarkName(activeTarget.ref, locale) : ''
  const targetDistanceLabel = activeDistanceM != null ? `${Math.round(activeDistanceM)} m` : ''
  const challenge = activeTarget ? getFlagAttemptText(activeTarget.ref, locale) : null
  const panelEligible = Boolean(
    confirming && enabled && pinnedTarget && target?.ref === pinnedTarget.ref,
  )

  function closePanel() {
    setConfirming(false)
    setPinnedTarget(null)
    setPinnedDistanceM(null)
    setPhotoFile(null)
    setAnswer('')
    onPanelOpenChange?.(false)
  }

  function openPanel() {
    if (!enabled || busy || !target) return
    setError(null)
    setPinnedTarget(target)
    setPinnedDistanceM(distance_m)
    setConfirming(true)
    onPanelOpenChange?.(true)
    // Fire-and-forget: signal the start so the defending team + attacker's
    // team-mates get a toast (P2-5). A cancelled panel is a feint — fine.
    apiPost(`/api/games/${gameId}/attempt-start`, {
      device_id: getDeviceId(),
      player_id: myPlayerId,
      landmark_ref: target.ref,
      pos: myGpsPos,
    }).catch(() => {})
  }

  async function doAttempt() {
    if (!panelEligible || !pinnedTarget || !myGpsPos || busy) return
    if (!photoFile) {
      setError('photo_required')
      return
    }
    setBusy(true)
    setError(null)
    setLastResult(null)

    let photoUrl: string
    try {
      photoUrl = await uploadAttemptPhoto(gameId, myPlayerId, photoFile)
    } catch {
      setError('photo_upload_failed')
      setBusy(false)
      return
    }

    const body: AttemptFlagRequest = {
      device_id: getDeviceId(),
      player_id: myPlayerId,
      landmark_ref: pinnedTarget.ref,
      pos: myGpsPos,
      photo_url: photoUrl,
      ...(answer.trim() ? { answer: answer.trim() } : {}),
    }

    try {
      const res = await apiPost<AttemptFlagResponse>(`/api/games/${gameId}/attempt-flag`, body)
      setLastResult(res)
      closePanel()
      onResult?.(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown_error')
    } finally {
      setBusy(false)
    }
  }

  const result = lastResult ? resultMessage(lastResult.result, t) : null
  const approaching =
    meState.visible &&
    !meState.enabled &&
    reason === 'no_landmark_in_range' &&
    target != null &&
    distance_m != null

  return (
    <div className="pointer-events-none flex w-full max-w-sm flex-col items-center gap-1.5">
      {approaching ? (
        <div className="rounded-full border border-amber-500/40 bg-neutral-950/90 px-4 py-2 text-center text-xs font-medium text-amber-100 shadow-lg backdrop-blur">
          {lockedLabel
            ? lockedLabel
            : t('flag_attempt.approaching', {
                name: targetName,
                m: Math.round(distance_m),
              })}
        </div>
      ) : confirming && pinnedTarget && challenge ? (
        <div className="pointer-events-auto flex w-full flex-col gap-2 rounded-2xl bg-neutral-950/95 p-3 shadow-lg ring-1 ring-amber-500/40">
          <div>
            <p className="text-sm font-semibold text-amber-100">{challenge.title}</p>
            <p className="mt-0.5 text-[11px] uppercase tracking-wider text-neutral-500">
              {targetName} · {targetDistanceLabel}
            </p>
          </div>
          <p className="text-xs leading-snug text-neutral-200">{challenge.task}</p>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className={cn(
              'w-full rounded-xl border px-3 py-2 text-xs font-medium transition disabled:opacity-50',
              photoFile
                ? 'border-emerald-500/60 bg-emerald-950/40 text-emerald-200'
                : 'border-neutral-700 bg-neutral-900 text-neutral-200 hover:border-neutral-600',
            )}
          >
            {photoFile ? `✓ ${photoFile.name.slice(0, 28)}` : t('flag_attempt.take_photo')}
          </button>

          {challenge.question && (
            <input
              type="text"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder={challenge.question}
              disabled={busy}
              className="w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-xs text-neutral-100 placeholder:text-neutral-500 focus:border-amber-500 focus:outline-none disabled:opacity-50"
            />
          )}

          <div className="flex w-full gap-2">
            <button
              type="button"
              onClick={closePanel}
              disabled={busy}
              className="flex-1 rounded-xl bg-neutral-800 px-4 py-3 text-sm font-semibold uppercase tracking-wider text-neutral-300 transition hover:bg-neutral-700 disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={doAttempt}
              disabled={busy || !photoFile || !panelEligible}
              className="flex-1 rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold uppercase tracking-wider text-neutral-950 shadow-lg shadow-amber-900/40 transition hover:bg-amber-400 disabled:opacity-50"
            >
              {busy ? t('common.submitting') : t('common.submit')}
            </button>
          </div>
          {!panelEligible && (
            <p className="text-center text-[11px] text-amber-200">
              {locked
                ? lockedLabel
                : reason === 'no_gps'
                  ? t('flag_attempt.reacquiring')
                  : reasonLabel(reason, t)}
            </p>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={openPanel}
          disabled={!enabled || busy}
          className={cn(
            'pointer-events-auto w-full rounded-2xl px-6 py-4 text-base font-semibold uppercase tracking-wider shadow-lg transition focus:outline-none',
            enabled
              ? 'animate-pulse bg-amber-500 text-neutral-950 shadow-amber-900/40 hover:bg-amber-400 focus-visible:ring-2 focus-visible:ring-amber-200'
              : 'cursor-not-allowed bg-neutral-800 text-neutral-500 shadow-none',
            busy && 'opacity-75',
          )}
          aria-label={
            enabled
              ? t('flag_attempt.aria_target', {
                  name: targetName,
                  distance: targetDistanceLabel,
                })
              : t('flag_attempt.aria_disabled')
          }
        >
          {enabled
            ? t('flag_attempt.button_enabled', {
                name: targetName,
                m: Math.round(distance_m ?? 0),
              })
            : t('flag_attempt.button_disabled')}
        </button>
      )}
      {!enabled && !approaching && (
        <p className="rounded bg-neutral-950/80 px-2 py-0.5 text-[11px] text-neutral-400">
          {locked ? lockedLabel : reasonLabel(reason, t)}
        </p>
      )}
      {result && (
        <p
          className={cn(
            'rounded px-2 py-0.5 text-[11px] font-medium',
            result.tone === 'real' && 'bg-emerald-900/80 text-emerald-100',
            result.tone === 'decoy' && 'bg-red-950/80 text-red-200',
            result.tone === 'empty' && 'bg-neutral-900/80 text-neutral-300',
          )}
        >
          {result.text}
        </p>
      )}
      {error && (
        <p className="rounded bg-red-950/80 px-2 py-0.5 text-[11px] text-red-200">
          {friendlyAttemptError(error, t)}
        </p>
      )}
    </div>
  )
}
