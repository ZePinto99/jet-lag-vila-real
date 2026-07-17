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
import { useT } from '@/lib/i18n/context'
import type { CurseEnforcementEntry } from '@/lib/hooks/useCurseEnforcement'
import type {
  ActiveCurse,
  CurseEnforcement,
  CurseTier,
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
  byCurseId?: Record<string, CurseEnforcementEntry>
}

export function ActiveCursesBanner({
  activeCurses,
  nowMs,
  actionsLocked = false,
  byCurseId = {},
}: ActiveCursesBannerProps) {
  const t = useT()
  if (activeCurses.length === 0) return null

  return (
    <div className="flex flex-col gap-1 border-b border-orange-700/70 bg-orange-950/40 px-4 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wider text-orange-200">
        {t('curse.banner_title')}
      </p>
      {actionsLocked && (
        <p className="rounded bg-red-900/60 px-2 py-1 text-[11px] font-semibold text-red-100">
          {t('curse.actions_locked')}
        </p>
      )}
      <ul className="flex flex-col gap-1.5">
        {activeCurses.map((curse) => (
          <ActiveCurseRow
            key={curse.id}
            curse={curse}
            nowMs={nowMs}
            enforcement={byCurseId[curse.id]}
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
}: {
  curse: ActiveCurse
  nowMs: number
  enforcement?: CurseEnforcementEntry
}) {
  const t = useT()
  const seed = CURSE_CATALOG.find((c) => c.id === curse.curse_ref)
  const name = seed?.name ?? curse.curse_ref
  const enforcementTag = seed?.enforcement ?? 'C'
  const description = seed?.description ?? ''

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
        (isCheckin ? (
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

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function formatMsRemaining(rem: number): string {
  const clamped = Math.max(0, rem)
  const m = Math.floor(clamped / 60_000)
  const s = Math.floor((clamped % 60_000) / 1000)
  return `${m}m ${pad2(s)}s`
}
