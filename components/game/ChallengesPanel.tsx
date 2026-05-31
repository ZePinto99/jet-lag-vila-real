'use client'

// ChallengesPanel (rulebook §8.1, §9) — fetches the 3 active challenges for
// the player's team and lets any team member submit one. Lives in the
// Actions tab, below CursePurchasePanel.
//
// Rules surfaced in the UI (server is authoritative for everything):
//  - Game must be in 'live' or 'flag_found'.
//  - Respawning players can't submit (challenges are field work).
//  - Challenges with a landmark_ref need GPS proximity (server enforces 100 m;
//    we pre-check at a loose 150 m to give clients a "get closer" hint).
//  - Landmark-agnostic challenges (e.g. pastel-de-nata quote) show an
//    "Available anywhere" badge and skip the proximity check.
//
// For challenges that need text input (e.g. window count, Latin name, pastel
// quote), we use window.prompt to capture a `text_submission` string. The
// server stores this in card.payload but does not validate the content.
//
// On success we surface a transient toast (e.g. "+40 coins (+30 first
// blood)") and optimistically swap in the `replacement` returned by the
// server. The realtime cards subscription also propagates the new state.

import { useCallback, useEffect, useState } from 'react'
import { apiGet, apiPost } from '@/lib/api'
import { cn } from '@/lib/cn'
import { getDeviceId } from '@/lib/device'
import { useT } from '@/lib/i18n/context'
import { haversineMeters } from '@/lib/geo/haversine'
import { getSeedLandmarkByRef } from '@/lib/landmarks'
import type {
  ChallengeDefinition,
  GameStatus,
  GetChallengesResponse,
  GpsPosition,
  SubmitChallengeRequest,
  SubmitChallengeResponse,
} from '@/lib/types'

// Loose client-side pre-check; the server is authoritative at 100 m.
const CLIENT_PROXIMITY_LIMIT_M = 150

interface ChallengesPanelProps {
  gameId: string
  gameStatus: GameStatus
  myPlayerId: string
  myGps: GpsPosition | null
  respawning: boolean
  actionsLocked?: boolean
}

export function ChallengesPanel({
  gameId,
  gameStatus,
  myPlayerId,
  myGps,
  respawning,
  actionsLocked = false,
}: ChallengesPanelProps) {
  const t = useT()
  const lockedLabel = actionsLocked ? t('curse.actions_locked') : null
  const [active, setActive] = useState<ChallengeDefinition[] | null>(null)
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
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'unknown_error')
    } finally {
      setLoading(false)
    }
  }, [gameId])

  // Initial fetch + refetch when game transitions into 'live' (challenges
  // are initialised lazily on the server the first time they're requested
  // during the live phase).
  useEffect(() => {
    if (gameStatus !== 'live' && gameStatus !== 'flag_found') return
    void fetchChallenges()
  }, [gameStatus, fetchChallenges])

  const gameNotLive = gameStatus !== 'live' && gameStatus !== 'flag_found'

  const handleSubmit = useCallback(
    async (challenge: ChallengeDefinition, textSubmission?: string) => {
      setSubmitError(null)
      setToast(null)

      // Text answer (window count, Latin name, pastel quote) is collected via
      // an inline field in ChallengeRow and passed in — native window.prompt is
      // unreliable in installed PWAs. See PLAYTEST_TRIAGE P0-3. Photo-only and
      // landmark-presence challenges submit directly on tap.
      if (textPromptForChallenge(challenge) && !textSubmission?.trim()) {
        setSubmitError('A submission is required for this challenge.')
        return
      }

      setBusyRef(challenge.id)
      const body: SubmitChallengeRequest = {
        device_id: getDeviceId(),
        player_id: myPlayerId,
        challenge_ref: challenge.id,
      }
      if (myGps) body.pos = myGps
      if (textSubmission?.trim()) body.text_submission = textSubmission.trim()

      try {
        const res = await apiPost<SubmitChallengeResponse>(
          `/api/games/${gameId}/submit-challenge`,
          body,
        )
        // Optimistic local update: swap the consumed challenge for the
        // server-issued replacement (if any). The realtime cards
        // subscription will reconcile shortly after.
        setActive((prev) => {
          if (!prev) return prev
          return prev
            .map((c) => {
              if (c.id !== challenge.id) return c
              return res.replacement ?? null
            })
            .filter((c): c is ChallengeDefinition => c != null)
        })
        const bonusStr = res.first_blood
          ? ` (+${res.bonus_coins} first blood!)`
          : ''
        setToast(`+${res.reward_coins} coins${bonusStr}`)
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : 'unknown_error')
      } finally {
        setBusyRef(null)
      }
    },
    [gameId, myPlayerId, myGps],
  )

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-neutral-100">Challenges</h2>
        <p className="text-[11px] text-neutral-500">
          {active ? `${active.length} active` : ''}
        </p>
      </div>
      <p className="mt-1 text-xs text-neutral-400">
        Earn coins by completing location-based tasks. First completion of any
        challenge in the game earns a +30 first-blood bonus.
      </p>

      {loading && active === null && (
        <p className="mt-3 text-xs text-neutral-500">Loading challenges…</p>
      )}

      {loadError && (
        <p className="mt-3 rounded bg-red-950/70 px-2 py-1 text-[11px] text-red-200">
          {loadError}
        </p>
      )}

      {active && active.length === 0 && !loading && (
        <p className="mt-3 text-xs text-neutral-500">
          No active challenges right now.
        </p>
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
              onSubmit={handleSubmit}
            />
          ))}
        </ul>
      )}

      {toast && (
        <p className="mt-3 rounded bg-emerald-950/70 px-2 py-1 text-[11px] text-emerald-200">
          {toast}
        </p>
      )}
      {submitError && (
        <p className="mt-3 rounded bg-red-950/70 px-2 py-1 text-[11px] text-red-200">
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
  onSubmit,
}: {
  challenge: ChallengeDefinition
  gameNotLive: boolean
  respawning: boolean
  myGps: GpsPosition | null
  busy: boolean
  anyBusy: boolean
  lockedLabel: string | null
  onSubmit: (c: ChallengeDefinition, text?: string) => void
}) {
  // Inline answer field for challenges that expect a text submission (window
  // count, Latin name, pastel quote). Replaces window.prompt (PWA-unreliable).
  const promptLabel = textPromptForChallenge(challenge)
  const [textValue, setTextValue] = useState('')

  const seed = challenge.landmark_ref
    ? getSeedLandmarkByRef(challenge.landmark_ref)
    : null

  const distanceMeters =
    seed && myGps
      ? haversineMeters({ lat: myGps.lat, lng: myGps.lng }, seed)
      : null

  const needsGps = challenge.landmark_ref != null && !myGps
  const outOfRange =
    distanceMeters != null && distanceMeters > CLIENT_PROXIMITY_LIMIT_M

  const disabledReason: string | null = lockedLabel
    ? lockedLabel
    : gameNotLive
    ? 'Available during live game'
    : respawning
      ? 'You are respawning'
      : needsGps
        ? 'Enable GPS to submit'
        : outOfRange && distanceMeters != null
          ? `Get closer (currently ${formatDistance(distanceMeters)})`
          : null

  const needsText = promptLabel != null
  const textMissing = needsText && textValue.trim().length === 0
  const disabled = busy || anyBusy || disabledReason !== null || textMissing

  // Soft hint when we have GPS and we're within 150 m but past 100 m: still
  // enabled, but warn the player that the server may reject.
  const showOutOfRangeHint =
    !outOfRange &&
    distanceMeters != null &&
    distanceMeters > 100

  return (
    <li className="rounded border border-neutral-800 bg-neutral-950 px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm font-medium text-neutral-100">
              {challenge.location_name}
            </p>
            <p className="shrink-0 text-xs font-semibold text-emerald-300 tabular-nums">
              +{challenge.reward_coins} coins
            </p>
          </div>
          <p className="mt-0.5 text-[11px] leading-snug text-neutral-400">
            {challenge.task}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {challenge.landmark_ref == null ? (
              <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-neutral-300">
                Available anywhere
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
                {formatDistance(distanceMeters)} away
              </span>
            ) : (
              <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-neutral-400">
                GPS off
              </span>
            )}
            {showOutOfRangeHint && !outOfRange && (
              <span className="text-[10px] text-amber-300/80">
                server requires &lt;100 m
              </span>
            )}
          </div>
        </div>
      </div>
      {needsText && (
        <input
          type="text"
          value={textValue}
          onChange={(e) => setTextValue(e.target.value)}
          placeholder={promptLabel ?? ''}
          disabled={busy || anyBusy}
          className="mt-2 w-full rounded border border-neutral-700 bg-neutral-900 px-2.5 py-1.5 text-xs text-neutral-100 placeholder:text-neutral-500 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
        />
      )}
      <div className="mt-2 flex items-center justify-between gap-3">
        <p
          className={cn(
            'text-[11px]',
            disabledReason ? 'text-neutral-500' : 'text-neutral-600',
          )}
        >
          {disabledReason ?? ' '}
        </p>
        <button
          type="button"
          onClick={() => onSubmit(challenge, needsText ? textValue : undefined)}
          disabled={disabled}
          className={cn(
            'shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition',
            disabled
              ? 'cursor-not-allowed bg-neutral-800 text-neutral-500'
              : 'bg-emerald-500 text-neutral-950 hover:bg-emerald-400',
          )}
        >
          {busy ? 'Submitting…' : 'Submit'}
        </button>
      </div>
    </li>
  )
}

// Decide whether a challenge needs a text submission, and what label to show
// in the window.prompt. Falls back to a generic label if the notes string
// hints at text without being more specific.
function textPromptForChallenge(c: ChallengeDefinition): string | null {
  const id = c.id
  const notes = (c.notes ?? '').toLowerCase()

  // Explicit "submit number" / "submit a quote" / "submit the name" in task.
  const task = c.task.toLowerCase()
  const wantsNumber =
    task.includes('submit number') || notes.includes('number')
  const wantsQuote =
    task.includes('submit a quote') || notes.includes('quote')
  const wantsLatinName =
    task.includes('submit the name') ||
    task.includes('latin name') ||
    notes.includes('latin name')

  // Hand-tuned labels for the known cases in data/challenges.json.
  if (id === 'challenge.igreja-dos-clerigos-windows' || wantsNumber) {
    return 'How many windows? (number)'
  }
  if (id === 'challenge.pastel-de-nata-quote' || wantsQuote) {
    return 'Paste the quote from the local'
  }
  if (id === 'challenge.utad-botanical-latin-name' || wantsLatinName) {
    return 'Latin name from the placard'
  }

  // Photo-only challenges (or anything else without a text component) don't
  // need a prompt in v1.
  return null
}

function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(2)} km`
}
