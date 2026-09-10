'use client'

// ActiveCursesBanner — rendered at the top of the live view when there are
// curses currently affecting MY team. Stacks vertically, amber/orange theme
// to distinguish from RespawnBanner (red/amber) and FlagFoundBanner.
//
// Each entry shows: curse name + enforcement tag, one-line description, a live
// countdown to expiry, and (P2-6) the enforcement extras from
// useCurseEnforcement: a live readout for [A] movement curses and a timed
// prompt for [B] photo curses / [L] check-in. A Full Stop curse adds an
// "actions locked" notice. Curses past their expiry render dimmed; the expiry
// poll cleans them up shortly.

import { useState } from 'react'
import cursesSeed from '@/data/curses.json'
import { getDeviceId } from '@/lib/device'
import { useI18n, useT } from '@/lib/i18n/context'
import { localizeCatalogField } from '@/lib/i18n/gameCatalog'
import type { CurseEnforcementEntry } from '@/lib/hooks/useCurseEnforcement'
import type {
  ActiveCurse,
  CurseEnforcement,
  CurseProofReceipt,
  CurseTier,
  SubmitCurseProofResponse,
} from '@/lib/types'

interface CurseSeed {
  id: string
  name: string
  tier: CurseTier
  enforcement: CurseEnforcement
  duration_minutes: number | null
  description: string
}

const CURSE_CATALOG: CurseSeed[] = cursesSeed as CurseSeed[]

interface ActiveCursesBannerProps {
  activeCurses: ActiveCurse[]
  nowMs: number
  actionsLocked?: boolean
  actionsLockedLabel?: string | null
  byCurseId?: Record<string, CurseEnforcementEntry>
  gameId?: string | null
  myPlayerId?: string | null
  proofReceipts?: CurseProofReceipt[]
  onProofSubmitted?: (proof: CurseProofReceipt) => void
}

export function ActiveCursesBanner({
  activeCurses,
  nowMs,
  actionsLocked = false,
  actionsLockedLabel = null,
  byCurseId = {},
  gameId = null,
  myPlayerId = null,
  proofReceipts = [],
  onProofSubmitted,
}: ActiveCursesBannerProps) {
  const t = useT()
  if (activeCurses.length === 0) return null

  return (
    <div className="flex flex-col gap-1 border-b border-orange-700/70 bg-orange-950/40 px-4 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wider text-orange-200">
        {t('curse.banner_title')}
      </p>
      {actionsLocked && (
        <p role="alert" className="rounded bg-red-900/60 px-2 py-1 text-[11px] font-semibold text-red-100">
          {actionsLockedLabel ?? t('curse.actions_locked')}
        </p>
      )}
      <ul className="flex flex-col gap-1.5">
        {activeCurses.map((curse) => (
          <ActiveCurseRow
            key={curse.id}
            curse={curse}
            nowMs={nowMs}
            enforcement={byCurseId[curse.id]}
            actionsLocked={actionsLocked}
            gameId={gameId}
            myPlayerId={myPlayerId}
            proofReceipts={proofReceipts}
            onProofSubmitted={onProofSubmitted}
          />
        ))}
      </ul>
    </div>
  )
}

function ActiveCurseRow({
  curse,
  nowMs,
  enforcement,
  actionsLocked,
  gameId,
  myPlayerId,
  proofReceipts,
  onProofSubmitted,
}: {
  curse: ActiveCurse
  nowMs: number
  enforcement?: CurseEnforcementEntry
  actionsLocked: boolean
  gameId: string | null
  myPlayerId: string | null
  proofReceipts: CurseProofReceipt[]
  onProofSubmitted?: (proof: CurseProofReceipt) => void
}) {
  const { t, locale } = useI18n()
  const seed = CURSE_CATALOG.find((c) => c.id === curse.curse_ref)
  const name = localizeCatalogField(
    curse.curse_ref,
    'name',
    seed?.name ?? curse.curse_ref,
    locale,
  )
  const enforcementTag = seed?.enforcement ?? 'C'
  const description = localizeCatalogField(
    curse.curse_ref,
    'description',
    seed?.description ?? '',
    locale,
  )

  const expiresMs = curse.expires_at
    ? new Date(curse.expires_at).getTime()
    : null

  // Frozen shows a gated countdown (time served while in place) instead of the
  // raw wall clock (E15). It also pauses while the player is out of place.
  const overrideMs = enforcement?.remainingMsOverride ?? null
  const paused = overrideMs != null && enforcement?.readout?.ok === false
  const remainingMs =
    overrideMs != null
      ? overrideMs
      : expiresMs != null
        ? Math.max(0, expiresMs - nowMs)
        : null
  const timerExpired =
    overrideMs != null ? overrideMs <= 0 : expiresMs != null && expiresMs <= nowMs

  // Check-in (E16): the prompt is an explicit tap-to-acknowledge each interval.
  const isCheckin = curse.curse_ref === 'curse.check-in'
  const intervalS =
    typeof curse.params?.interval_seconds === 'number'
      ? curse.params.interval_seconds
      : 60
  const startedMs = new Date(curse.started_at).getTime()
  const intervalIdx = Math.max(
    0,
    Math.floor((nowMs - startedMs) / (intervalS * 1000)),
  )
  const [ackedIdx, setAckedIdx] = useState(-1)
  const acked = ackedIdx === intervalIdx

  return (
    <li
      className={
        'rounded border border-orange-700/40 bg-orange-900/30 px-3 py-1.5 text-xs text-orange-100' +
        (timerExpired ? ' opacity-60' : '')
      }
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="rounded bg-orange-700/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-orange-200">
            [{enforcementTag}]
          </span>
          <span className="truncate text-sm font-semibold text-orange-50">
            {name}
          </span>
        </div>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-orange-200">
          {remainingMs == null
            ? t('curse.no_timer')
            : timerExpired
              ? t('curse.expired_hint')
              : `${paused ? '⏸ ' : ''}${formatMsRemaining(remainingMs)}`}
        </span>
      </div>
      {description && (
        <p className="mt-0.5 text-[11px] leading-snug text-orange-200/90">
          {description}
        </p>
      )}
      {enforcement?.prompt &&
        !timerExpired &&
        (enforcement.prompt.proofRequired &&
        enforcement.prompt.promptIndex != null ? (
          <CurseProofControl
            key={`${curse.id}:${enforcement.prompt.promptIndex}`}
            curse={curse}
            promptLabel={enforcement.prompt.label}
            promptIndex={enforcement.prompt.promptIndex}
            secondsLeft={enforcement.prompt.secondsLeft}
            gameId={gameId}
            myPlayerId={myPlayerId}
            actionsLocked={actionsLocked}
            submitted={proofReceipts.some(
              (proof) =>
                proof.curse_id === curse.id &&
                proof.prompt_index === enforcement.prompt?.promptIndex,
            )}
            onProofSubmitted={onProofSubmitted}
          />
        ) : isCheckin ? (
          acked ? (
            <p className="mt-1 rounded bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-200">
              {t('curse.checkin_ack')}
            </p>
          ) : (
            <button
              type="button"
              onClick={() => setAckedIdx(intervalIdx)}
              className="mt-1 w-full rounded bg-amber-400/30 px-2 py-1 text-[11px] font-semibold text-amber-50 transition hover:bg-amber-400/50"
            >
              {enforcement.prompt.secondsLeft > 0
                ? t('curse.prompt_window', {
                    label: enforcement.prompt.label,
                    s: enforcement.prompt.secondsLeft,
                  })
                : enforcement.prompt.label}
            </button>
          )
        ) : (
          <p className="mt-1 rounded bg-amber-400/20 px-2 py-0.5 text-[11px] font-semibold text-amber-100">
            {enforcement.prompt.secondsLeft > 0
              ? t('curse.prompt_window', {
                  label: enforcement.prompt.label,
                  s: enforcement.prompt.secondsLeft,
                })
              : enforcement.prompt.label}
          </p>
        ))}
      {enforcement?.readout && !timerExpired && (
        <p
          className={
            'mt-1 font-mono text-[11px] tabular-nums ' +
            (enforcement.readout.ok ? 'text-emerald-300' : 'text-red-300')
          }
        >
          {enforcement.readout.text}
        </p>
      )}
    </li>
  )
}

function CurseProofControl({
  curse,
  promptLabel,
  promptIndex,
  secondsLeft,
  gameId,
  myPlayerId,
  actionsLocked,
  submitted,
  onProofSubmitted,
}: {
  curse: ActiveCurse
  promptLabel: string
  promptIndex: number
  secondsLeft: number
  gameId: string | null
  myPlayerId: string | null
  actionsLocked: boolean
  submitted: boolean
  onProofSubmitted?: (proof: CurseProofReceipt) => void
}) {
  const t = useT()
  const [photo, setPhoto] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputId = `curse-proof-${curse.id}-${promptIndex}`

  async function submitProof() {
    if (!photo || !gameId || !myPlayerId || actionsLocked || submitted) return
    setSubmitting(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('device_id', getDeviceId())
      form.set('player_id', myPlayerId)
      form.set('curse_id', curse.id)
      form.set('prompt_index', String(promptIndex))
      form.set('photo', photo)
      const response = await fetch(`/api/games/${gameId}/submit-curse-proof`, {
        method: 'POST',
        body: form,
      })
      const body = (await response.json()) as SubmitCurseProofResponse | { error?: string }
      if (!response.ok || !('proof' in body)) {
        throw new Error('error' in body && body.error ? body.error : 'request_failed')
      }
      onProofSubmitted?.(body.proof)
      setPhoto(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'request_failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <p className="mt-1 rounded bg-emerald-500/20 px-2 py-1 text-[11px] font-semibold text-emerald-200">
        {t('curse.proof_submitted')}
      </p>
    )
  }

  return (
    <div className="mt-1 rounded bg-amber-400/20 p-2 text-[11px] text-amber-50">
      <p className="font-semibold">
        {t('curse.prompt_window', { label: promptLabel, s: secondsLeft })}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <input
          id={inputId}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          capture="environment"
          className="sr-only"
          disabled={actionsLocked || submitting}
          onChange={(event) => {
            setPhoto(event.target.files?.[0] ?? null)
            setError(null)
          }}
        />
        <label
          htmlFor={inputId}
          aria-disabled={actionsLocked || submitting}
          className={
            'rounded px-2 py-1 font-semibold ' +
            (actionsLocked || submitting
              ? 'cursor-not-allowed bg-neutral-700 text-neutral-400'
              : 'cursor-pointer bg-amber-300/30 text-amber-50 hover:bg-amber-300/45')
          }
        >
          {photo ? t('curse.proof_ready') : t('curse.proof_add')}
        </label>
        <button
          type="button"
          disabled={!photo || actionsLocked || submitting || !gameId || !myPlayerId}
          onClick={submitProof}
          className="rounded bg-amber-300 px-2 py-1 font-bold text-amber-950 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {submitting ? t('curse.proof_submitting') : t('curse.proof_submit')}
        </button>
      </div>
      {!photo && <p className="mt-1 text-amber-200">{t('curse.proof_required')}</p>}
      {error && (
        <p role="alert" className="mt-1 text-red-200">
          {t('curse.proof_error', { error })}
        </p>
      )}
    </div>
  )
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function formatMsRemaining(rem: number): string {
  const clamped = Math.max(0, rem)
  const m = Math.floor(clamped / 60_000)
  const s = Math.floor((clamped % 60_000) / 1000)
  return `${m}m ${pad2(s)}s`
}
