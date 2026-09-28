'use client'

// ChallengesPanel (rulebook §8.1, §9) — the caller team's active challenges,
// with submission. Lives in the Actions tab.
//
// Peer verification (D14): challenges with `photo_required` now upload a proof
// photo and enter a `pending` state for the OTHER team to accept/reject. Coins
// are credited only on accept; on reject the challenge returns for resubmission.
// Non-photo challenges (such as the window count) auto-complete on submit.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiGet, apiPost } from '@/lib/api'
import { cn } from '@/lib/cn'
import { getDeviceId } from '@/lib/device'
import { createClient } from '@/lib/supabase/client'
import { useI18n } from '@/lib/i18n/context'
import { localizeCatalogField } from '@/lib/i18n/gameCatalog'
import { CHALLENGE_GEOFENCE_M } from '@/lib/gameConstants'
import { haversineMeters } from '@/lib/geo/haversine'
import { getSeedLandmarkByRef } from '@/lib/landmarks'
import type {
  ChallengeDefinition,
  GameEvent,
  GameStatus,
  GetChallengesResponse,
  GpsPosition,
  PendingChallenge,
  SubmitChallengeRequest,
  SubmitChallengeResponse,
} from '@/lib/types'

// Client-side pre-check, derived from the server's authoritative radius so the
// two can never drift again. P10 tightened the server to 60 m while this was
// still a hardcoded 150, which meant a player 100 m away saw an ENABLED Submit
// button and then got a server rejection — the "action that silently does
// nothing" failure mode.
//
// The client stays deliberately looser than the server (the same 1.5x buffer the
// tag button uses at 5 m client / 10 m server) so ordinary urban GPS drift does
// not grey out a button for someone who is genuinely standing at the landmark.
const CLIENT_PROXIMITY_LIMIT_M = Math.round(CHALLENGE_GEOFENCE_M * 1.5)

async function uploadChallengePhoto(gameId: string, playerId: string, file: File): Promise<string> {
  const supabase = createClient()
  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${gameId}/${playerId}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from('challenge-photos').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'image/jpeg',
  })
  if (error) throw error
  return supabase.storage.from('challenge-photos').getPublicUrl(path).data.publicUrl
}

interface ChallengesPanelProps {
  gameId: string
  gameStatus: GameStatus
  myPlayerId: string
  myTeamId: string
  myGps: GpsPosition | null
  respawning: boolean
  actionsLocked?: boolean
  /** Drives refetch when a review resolves (accept/reject/submit). */
  events: GameEvent[]
}

export function ChallengesPanel({
  gameId,
  gameStatus,
  myPlayerId,
  myTeamId,
  myGps,
  respawning,
  actionsLocked = false,
  events,
}: ChallengesPanelProps) {
  const { t, locale } = useI18n()
  const lockedLabel = actionsLocked ? t('curse.actions_locked') : null
  const [active, setActive] = useState<ChallengeDefinition[] | null>(null)
  const [pending, setPending] = useState<PendingChallenge[]>([])
  const [rejectedRefs, setRejectedRefs] = useState<Set<string>>(new Set())
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busyRef, setBusyRef] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const fetchChallenges = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const deviceId = getDeviceId()
      const data = await apiGet<GetChallengesResponse>(
        `/api/games/${gameId}/challenges?device_id=${encodeURIComponent(deviceId)}`,
      )
      setActive(data.active)
      setPending(data.pending ?? [])
      setRejectedRefs(new Set(data.rejected_refs ?? []))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'unknown_error')
    } finally {
      setLoading(false)
    }
  }, [gameId])

  useEffect(() => {
    if (gameStatus !== 'live' && gameStatus !== 'flag_found') return
    void fetchChallenges()
  }, [gameStatus, fetchChallenges])

  // Refetch when one of MY team's challenges changes review state, so pending
  // ↔ available transitions (accept/reject/submit) reflect promptly (D14).
  const reviewSignal = useMemo(
    () =>
      events.filter(
        (e) =>
          (e.type === 'challenge_submitted' ||
            e.type === 'challenge_completed' ||
            e.type === 'challenge_rejected') &&
          (e.payload as Record<string, unknown>)?.team_id === myTeamId,
      ).length,
    [events, myTeamId],
  )
  useEffect(() => {
    if (gameStatus !== 'live' && gameStatus !== 'flag_found') return
    void fetchChallenges()
  }, [reviewSignal, gameStatus, fetchChallenges])

  const gameNotLive = gameStatus !== 'live' && gameStatus !== 'flag_found'

  const handleSubmit = useCallback(
    async (challenge: ChallengeDefinition, opts: { text?: string; file?: File | null }) => {
      setSubmitError(null)
      setToast(null)

      if (textPromptForChallenge(challenge, t) && !opts.text?.trim()) {
        setSubmitError(t('challenge.submission_required'))
        return
      }
      if (challenge.photo_required && !opts.file) {
        setSubmitError(t('challenge.photo_required_hint'))
        return
      }

      setBusyRef(challenge.id)
      try {
        let photoUrl: string | undefined
        if (challenge.photo_required && opts.file) {
          photoUrl = await uploadChallengePhoto(gameId, myPlayerId, opts.file)
        }
        const body: SubmitChallengeRequest = {
          device_id: getDeviceId(),
          player_id: myPlayerId,
          challenge_ref: challenge.id,
        }
        if (myGps) body.pos = myGps
        if (opts.text?.trim()) body.text_submission = opts.text.trim()
        if (photoUrl) body.photo_url = photoUrl

        const res = await apiPost<SubmitChallengeResponse>(
          `/api/games/${gameId}/submit-challenge`,
          body,
        )
        if (res.status === 'pending') {
          setToast(t('challenge.pending_review'))
        } else {
          const bonusStr = res.first_blood ? t('challenge.toast_first_blood') : ''
          setToast(`+${res.reward_coins} ${t('common.coins')}${bonusStr}`)
        }
        await fetchChallenges()
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'unknown_error')
      } finally {
        setBusyRef(null)
      }
    },
    [gameId, myPlayerId, myGps, t, fetchChallenges],
  )

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-neutral-100">{t('challenge.panel_title')}</h2>
        <p className="text-[11px] text-neutral-500">
          {active ? t('challenge.active_count', { n: active.length }) : ''}
        </p>
      </div>
      <p className="mt-1 text-xs text-neutral-400">{t('challenge.panel_hint')}</p>

      {loading && active === null && (
        <p className="mt-3 text-xs text-neutral-500">{t('challenge.loading')}</p>
      )}
      {loadError && (
        <p className="mt-3 rounded bg-red-950/70 px-2 py-1 text-[11px] text-red-200">{loadError}</p>
      )}
      {active && active.length === 0 && pending.length === 0 && !loading && (
        <p className="mt-3 text-xs text-neutral-500">{t('challenge.none_active')}</p>
      )}

      {active && active.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {active.map((c) => (
            <ChallengeRow
              key={c.id}
              challenge={c}
              gameNotLive={gameNotLive}
              respawning={respawning}
              myGps={myGps}
              busy={busyRef === c.id}
              anyBusy={busyRef !== null}
              lockedLabel={lockedLabel}
              rejected={rejectedRefs.has(c.id)}
              locale={locale}
              onSubmit={handleSubmit}
            />
          ))}
        </ul>
      )}

      {pending.length > 0 && (
        <div className="mt-3 rounded border border-sky-800/40 bg-sky-950/30 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wider text-sky-300/80">
            {t('challenge.pending_review')}
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {pending.map((p) => (
              <li
                key={p.card_id}
                className="flex items-center justify-between gap-2 text-[11px] text-sky-100"
              >
                <span className="truncate">
                  {localizeCatalogField(
                    p.challenge.id,
                    'location_name',
                    p.challenge.location_name,
                    locale,
                  )}
                </span>
                {p.photo_url && (
                  <a
                    href={p.photo_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-sky-300 underline"
                  >
                    {t('challenge.view_photo')}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {toast && (
        <p role="status" className="mt-3 rounded bg-emerald-950/70 px-2 py-1 text-[11px] text-emerald-200">
          {toast}
        </p>
      )}
      {submitError && (
        <p role="alert" className="mt-3 rounded bg-red-950/70 px-2 py-1 text-[11px] text-red-200">
          {submitError}
        </p>
      )}
    </div>
  )
}

function ChallengeRow({
  challenge,
  gameNotLive,
  respawning,
  myGps,
  busy,
  anyBusy,
  lockedLabel,
  rejected,
  locale,
  onSubmit,
}: {
  challenge: ChallengeDefinition
  gameNotLive: boolean
  respawning: boolean
  myGps: GpsPosition | null
  busy: boolean
  anyBusy: boolean
  lockedLabel: string | null
  rejected: boolean
  locale: import('@/lib/i18n/messages').Locale
  onSubmit: (c: ChallengeDefinition, opts: { text?: string; file?: File | null }) => void
}) {
  const { t } = useI18n()
  const promptLabel = textPromptForChallenge(challenge, t)
  const [textValue, setTextValue] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)

  const seed = challenge.landmark_ref ? getSeedLandmarkByRef(challenge.landmark_ref) : null
  const distanceMeters =
    seed && myGps ? haversineMeters({ lat: myGps.lat, lng: myGps.lng }, seed) : null

  const needsGps = challenge.landmark_ref != null && !myGps
  const outOfRange = distanceMeters != null && distanceMeters > CLIENT_PROXIMITY_LIMIT_M

  const disabledReason: string | null = lockedLabel
    ? lockedLabel
    : gameNotLive
      ? t('challenge.reason_not_live')
      : respawning
        ? t('challenge.reason_respawning')
        : needsGps
          ? t('challenge.reason_no_gps')
          : outOfRange && distanceMeters != null
            ? t('challenge.reason_too_far', { m: formatDistance(distanceMeters) })
            : null

  const needsText = promptLabel != null
  const textMissing = needsText && textValue.trim().length === 0
  const photoMissing = challenge.photo_required && photoFile == null
  const disabled = busy || anyBusy || disabledReason !== null || textMissing || photoMissing
  const formControlsDisabled = busy || anyBusy || disabledReason !== null

  const showOutOfRangeHint = !outOfRange && distanceMeters != null && distanceMeters > 100

  return (
    <li className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-medium text-neutral-100">
              {localizeCatalogField(
                challenge.id,
                'location_name',
                challenge.location_name,
                locale,
              )}
            </p>
            <p className="shrink-0 text-xs font-semibold text-emerald-300 tabular-nums">
              +{challenge.reward_coins} {t('common.coins')}
            </p>
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-neutral-400">
            {localizeCatalogField(challenge.id, 'task', challenge.task, locale)}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {challenge.landmark_ref == null ? (
              <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-neutral-300">
                {t('challenge.available_anywhere')}
              </span>
            ) : distanceMeters != null ? (
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider',
                  outOfRange
                    ? 'bg-red-900/50 text-red-200'
                    : showOutOfRangeHint
                      ? 'bg-amber-900/50 text-amber-200'
                      : 'bg-emerald-900/50 text-emerald-200',
                )}
              >
                {t('challenge.away', { distance: formatDistance(distanceMeters) })}
              </span>
            ) : (
              <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-neutral-400">
                {t('challenge.gps_off')}
              </span>
            )}
            {challenge.photo_required && (
              <span className="rounded bg-sky-900/50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-sky-200">
                {t('challenge.photo_verified')}
              </span>
            )}
          </div>
          {rejected && (
            <p className="mt-1 text-[11px] font-medium text-amber-300">
              {t('challenge.rejected_resubmit')}
            </p>
          )}
        </div>
      </div>

      {needsText && (
        <input
          type="text"
          aria-label={promptLabel ?? t('challenge.answer')}
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          placeholder={promptLabel ?? ''}
          disabled={formControlsDisabled}
          className="mt-2 w-full rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-100 placeholder:text-neutral-500 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
        />
      )}

      {challenge.photo_required && (
        <label
          className={cn(
            'mt-2 flex cursor-pointer items-center justify-center rounded border px-3 py-2 text-xs font-medium transition',
            photoFile
              ? 'border-emerald-500/60 bg-emerald-950/40 text-emerald-200'
              : 'border-neutral-700 bg-neutral-900 text-neutral-200 hover:border-neutral-600',
            formControlsDisabled && 'pointer-events-none opacity-50',
          )}
        >
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={formControlsDisabled}
            onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
          />
          {photoFile ? t('challenge.photo_change') : t('challenge.photo_add')}
        </label>
      )}

      <div className="mt-2 flex items-center justify-between gap-3">
        <p className={cn('text-[11px]', disabledReason ? 'text-neutral-500' : 'text-neutral-600')}>
          {disabledReason ?? (challenge.photo_required ? t('challenge.photo_required_hint') : ' ')}
        </p>
        <button
          type="button"
          onClick={() =>
            onSubmit(challenge, {
              text: needsText ? textValue : undefined,
              file: photoFile,
            })
          }
          disabled={disabled}
          className={cn(
            'shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition',
            disabled
              ? 'cursor-not-allowed bg-neutral-800 text-neutral-500'
              : 'bg-emerald-500 text-neutral-950 hover:bg-emerald-400',
          )}
        >
          {busy ? t('challenge.submitting') : t('challenge.submit')}
        </button>
      </div>
    </li>
  )
}

function textPromptForChallenge(
  c: ChallengeDefinition,
  t: (key: string, tokens?: Record<string, string | number>) => string,
): string | null {
  const id = c.id
  const notes = (c.notes ?? '').toLowerCase()
  const task = c.task.toLowerCase()
  const wantsNumber = task.includes('submit number') || notes.includes('number')
  const wantsQuote = task.includes('submit a quote') || notes.includes('quote')
  const wantsLatinName =
    task.includes('submit the name') || task.includes('latin name') || notes.includes('latin name')
  const wantsRiverNames = task.includes('name the cabril and corgo') || notes.includes('river names')

  if (id === 'challenge.igreja-dos-clerigos-windows' || wantsNumber) {
    return t('challenge.answer_windows')
  }
  if (wantsQuote) {
    return t('challenge.answer_quote')
  }
  if (id === 'challenge.utad-botanical-latin-name' || wantsRiverNames) {
    return t('challenge.answer_rivers')
  }
  if (wantsLatinName) {
    return t('challenge.answer_latin')
  }
  return null
}

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(2)} km`
}
