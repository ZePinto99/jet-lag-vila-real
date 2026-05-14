'use client'

// ActiveCursesBanner — rendered at the top of the live view when there are
// curses currently affecting MY team. Stacks vertically, amber/orange theme
// to distinguish from RespawnBanner (red/amber) and FlagFoundBanner.
//
// Each entry shows: curse name + enforcement tag, one-line description, and
// a live countdown to expiry. Curses past their expiry render dimmed with a
// "(expired — refreshing…)" hint; the expiry poll cleans them up shortly.

import cursesSeed from '@/data/curses.json'
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
}

export function ActiveCursesBanner({
  activeCurses,
  nowMs,
}: ActiveCursesBannerProps) {
  if (activeCurses.length === 0) return null

  return (
    <div className="flex flex-col gap-1 border-b border-orange-700/70 bg-orange-950/40 px-4 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wider text-orange-200">
        Active curses on your team
      </p>
      <ul className="flex flex-col gap-1.5">
        {activeCurses.map((curse) => (
          <ActiveCurseRow key={curse.id} curse={curse} nowMs={nowMs} />
        ))}
      </ul>
    </div>
  )
}

function ActiveCurseRow({
  curse,
  nowMs,
}: {
  curse: ActiveCurse
  nowMs: number
}) {
  const seed = CURSE_CATALOG.find((c) => c.id === curse.curse_ref)
  const name = seed?.name ?? curse.curse_ref
  const enforcement = seed?.enforcement ?? 'C'
  const description = seed?.description ?? ''

  const expiresMs = curse.expires_at
    ? new Date(curse.expires_at).getTime()
    : null
  const expired = expiresMs != null && expiresMs <= nowMs

  return (
    <li
      className={
        'rounded border border-orange-700/40 bg-orange-900/30 px-3 py-1.5 text-xs text-orange-100' +
        (expired ? ' opacity-60' : '')
      }
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="rounded bg-orange-700/40 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-orange-200">
            [{enforcement}]
          </span>
          <span className="truncate text-sm font-semibold text-orange-50">
            {name}
          </span>
        </div>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-orange-200">
          {expiresMs == null
            ? 'no timer'
            : expired
              ? '(expired — refreshing…)'
              : formatTimeRemaining(expiresMs, nowMs)}
        </span>
      </div>
      {description && (
        <p className="mt-0.5 text-[11px] leading-snug text-orange-200/90">
          {description}
        </p>
      )}
    </li>
  )
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function formatTimeRemaining(endsMs: number, nowMs: number): string {
  const rem = Math.max(0, endsMs - nowMs)
  const m = Math.floor(rem / 60_000)
  const s = Math.floor((rem % 60_000) / 1000)
  return `${m}m ${pad2(s)}s`
}
