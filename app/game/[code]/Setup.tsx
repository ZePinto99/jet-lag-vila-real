'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/Button'
import { apiGet, apiPost } from '@/lib/api'
import { getDeviceId } from '@/lib/device'
import { useGameStore } from '@/store/gameStore'
import { PlacedCursePanel } from '@/components/game/PlacedCursePanel'
import type {
  FlagAssignment,
  FlagRole,
  FlagSetupRequest,
  FlagSetupResponse,
  Landmark,
  SeedLandmark,
  SetupStateResponse,
  Team,
} from '@/lib/types'

const SetupMap = dynamic(() => import('@/components/map/SetupMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-72 w-full items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-sm text-neutral-500">
      Loading map…
    </div>
  ),
})

const ROLES: ReadonlyArray<FlagRole> = ['real', 'decoy', 'empty']

const ROLE_LABEL: Record<FlagRole, string> = {
  real: 'Real',
  decoy: 'Decoy',
  empty: 'Empty',
}

const ROLE_NEEDED: Record<FlagRole, number> = {
  real: 1,
  decoy: 2,
  empty: 2,
}

// kind in the per-game landmarks table maps to a FlagRole for setup-submitted rows.
const KIND_TO_ROLE: Record<string, FlagRole | null> = {
  flag_real: 'real',
  flag_decoy: 'decoy',
  flag_empty: 'empty',
}

interface SetupSnapshot {
  myTeam: Team
  myPool: SeedLandmark[]
  myLandmarks: Landmark[]
  otherTeamDone: boolean
}

export function Setup() {
  const game = useGameStore((s) => s.game)
  const me = useGameStore((s) => s.me)
  const myPlacedCurses = useGameStore((s) => s.myPlacedCurses)

  const [snapshot, setSnapshot] = useState<SetupSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selections, setSelections] = useState<Map<string, FlagRole | null>>(
    new Map(),
  )
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Hydrate setup state on mount and any time the game id changes.
  useEffect(() => {
    if (!game || !me) return
    let cancelled = false

    async function load(gameId: string) {
      setLoading(true)
      setLoadError(null)
      try {
        const deviceId = getDeviceId()
        const data = await apiGet<SetupStateResponse>(
          `/api/games/${gameId}/setup-state?device_id=${encodeURIComponent(deviceId)}`,
        )
        if (cancelled) return

        const initialSelections = new Map<string, FlagRole | null>()
        for (const seed of data.my_pool) {
          initialSelections.set(seed.id, null)
        }
        for (const lm of data.my_landmarks) {
          const role = KIND_TO_ROLE[lm.kind] ?? null
          if (role) initialSelections.set(lm.ref, role)
        }

        setSnapshot({
          myTeam: data.my_team,
          myPool: data.my_pool,
          myLandmarks: data.my_landmarks,
          otherTeamDone: data.other_team_done,
        })
        setSelections(initialSelections)
      } catch (err) {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'unknown_error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load(game.id)
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id, me?.id])

  const alreadySubmitted = (snapshot?.myLandmarks.length ?? 0) > 0

  const counts = useMemo(() => {
    let real = 0
    let decoy = 0
    let empty = 0
    for (const role of selections.values()) {
      if (role === 'real') real++
      else if (role === 'decoy') decoy++
      else if (role === 'empty') empty++
    }
    const total = real + decoy + empty
    return { real, decoy, empty, unused: selections.size - total }
  }, [selections])

  const isValid =
    counts.real === ROLE_NEEDED.real &&
    counts.decoy === ROLE_NEEDED.decoy &&
    counts.empty === ROLE_NEEDED.empty

  function setRole(ref: string, role: FlagRole | null) {
    setSelections((prev) => {
      const next = new Map(prev)
      next.set(ref, role)
      return next
    })
  }

  async function submit() {
    if (!game || !snapshot || !isValid) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const assignments: FlagAssignment[] = []
      for (const [landmark_ref, role] of selections.entries()) {
        if (role) assignments.push({ landmark_ref, role })
      }
      const body: FlagSetupRequest = {
        device_id: getDeviceId(),
        assignments,
      }
      const resp = await apiPost<FlagSetupResponse>(
        `/api/games/${game.id}/flag-setup`,
        body,
      )
      setSnapshot((prev) =>
        prev
          ? {
              ...prev,
              myLandmarks: resp.my_landmarks,
              otherTeamDone: resp.both_teams_done || prev.otherTeamDone,
            }
          : prev,
      )
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'unknown_error')
    } finally {
      setSubmitting(false)
    }
  }

  if (!game || !me) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-16">
        <p className="text-sm text-neutral-400">Loading setup…</p>
      </main>
    )
  }

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-16">
        <p className="text-sm text-neutral-400">Loading setup…</p>
      </main>
    )
  }

  if (loadError || !snapshot) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">Setup phase</h1>
        <div className="rounded-md border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-200">
          {loadError ?? 'Could not load setup state.'}
        </div>
        <p className="text-xs text-neutral-500">Game {game.code}</p>
      </main>
    )
  }

  const sideLabel = snapshot.myTeam.side === 'east' ? 'East' : 'West'
  const homeName =
    snapshot.myTeam.side === 'east' ? 'Biblioteca Municipal' : 'UTAD'

  if (alreadySubmitted) {
    const submittedAtIso = snapshot.myLandmarks
      .map((l) => l.created_at)
      .sort()[0]
    const submittedAt = submittedAtIso ? new Date(submittedAtIso) : null
    const submittedRows = snapshot.myLandmarks
      .map((lm) => {
        const seed = snapshot.myPool.find((s) => s.id === lm.ref)
        const role = KIND_TO_ROLE[lm.kind]
        return { ref: lm.ref, name: seed?.name ?? lm.ref, role }
      })
      .sort((a, b) => {
        const order: Record<string, number> = { real: 0, decoy: 1, empty: 2 }
        const aRank = a.role ? order[a.role] ?? 9 : 9
        const bRank = b.role ? order[b.role] ?? 9 : 9
        if (aRank !== bRank) return aRank - bRank
        return a.name.localeCompare(b.name)
      })

    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-10">
        <header className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="text-2xl font-semibold">Setup phase</h1>
            <code className="rounded-md bg-neutral-900 px-3 py-1 text-base font-mono tracking-[0.3em] text-neutral-100">
              {game.code}
            </code>
          </div>
          <p className="text-sm text-neutral-400">
            Team {sideLabel} — assignment locked in.
          </p>
        </header>

        <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-sm text-neutral-300">
          <p>
            Your team&apos;s flag assignment is locked in. Waiting for the other
            team…
          </p>
          {snapshot.otherTeamDone && (
            <p className="mt-2 text-xs text-neutral-500">
              Other team has also submitted. Game will start shortly.
            </p>
          )}
        </section>

        <section className="flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
          <h2 className="text-base font-medium">Your landmarks</h2>
          <ul className="flex flex-col gap-2">
            {submittedRows.map((row) => (
              <li
                key={row.ref}
                className="flex items-center justify-between gap-3 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
              >
                <span>{row.name}</span>
                <RoleBadge role={row.role} />
              </li>
            ))}
          </ul>
          {submittedAt && (
            <p className="mt-2 text-xs text-neutral-500">
              Submitted at {submittedAt.toLocaleTimeString()}
            </p>
          )}
        </section>

        {/* Pre-arm placed curses on your own candidates while you wait (P2-2). */}
        {me && (
          <PlacedCursePanel
            gameId={game.id}
            myPlayerId={me.id}
            teamCoins={snapshot.myTeam.coins}
            myCandidateLandmarks={snapshot.myLandmarks}
            placedCurses={myPlacedCurses}
          />
        )}
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold">Setup phase</h1>
          <code className="rounded-md bg-neutral-900 px-3 py-1 text-base font-mono tracking-[0.3em] text-neutral-100">
            {game.code}
          </code>
        </div>
        <p className="text-sm text-neutral-400">
          You are Team {sideLabel}. Walk to {homeName} with your team. When
          you&apos;re all at home base, decide together: 5 candidate landmarks,
          1 hides the real flag, 2 are decoys, 2 are empty.
        </p>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-medium">Map — all candidate points</h2>
        <p className="text-xs text-neutral-400">
          Your pool is highlighted; the enemy pool and neutral respawn points are
          shown too. Plan picks with non-overlapping defense zones.
        </p>
        <SetupMap
          mySide={snapshot.myTeam.side}
          myHomeRef={snapshot.myTeam.home_landmark_id}
        />
      </section>

      <section className="flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
        <h2 className="text-base font-medium">Your pool</h2>
        <ul className="flex flex-col gap-2">
          {snapshot.myPool.map((seed) => {
            const current = selections.get(seed.id) ?? null
            return (
              <li
                key={seed.id}
                className="flex flex-col gap-2 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-neutral-100">
                    {seed.name}
                  </span>
                  {seed.notes && (
                    <span className="text-xs text-neutral-500">
                      {seed.notes}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <RoleButton
                    label="—"
                    active={current === null}
                    onClick={() => setRole(seed.id, null)}
                  />
                  {ROLES.map((r) => (
                    <RoleButton
                      key={r}
                      label={ROLE_LABEL[r]}
                      tone={r}
                      active={current === r}
                      onClick={() => setRole(seed.id, r)}
                    />
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <CountsFooter counts={counts} valid={isValid} />
        <Button
          onClick={submit}
          disabled={!isValid || submitting}
          className="w-full py-4 text-base"
        >
          {submitting ? 'Submitting…' : 'Submit flag assignment'}
        </Button>
        {submitError && (
          <div className="rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-200">
            {submitError}
          </div>
        )}
      </section>
    </main>
  )
}

function RoleButton({
  label,
  active,
  tone,
  onClick,
}: {
  label: string
  active: boolean
  tone?: FlagRole
  onClick: () => void
}) {
  const toneActive: Record<FlagRole, string> = {
    real: 'border-emerald-500 bg-emerald-600 text-neutral-50',
    decoy: 'border-amber-500 bg-amber-600 text-neutral-50',
    empty: 'border-neutral-400 bg-neutral-300 text-neutral-900',
  }
  const baseInactive =
    'border-neutral-700 bg-neutral-950 text-neutral-300 hover:bg-neutral-800'
  const activeClass = tone
    ? toneActive[tone]
    : 'border-neutral-400 bg-neutral-100 text-neutral-900'
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'min-w-[64px] rounded-md border px-3 py-1.5 text-xs font-medium transition ' +
        (active ? activeClass : baseInactive)
      }
    >
      {label}
    </button>
  )
}

function CountsFooter({
  counts,
  valid,
}: {
  counts: { real: number; decoy: number; empty: number; unused: number }
  valid: boolean
}) {
  const cls = (n: number, need: number) =>
    n === need ? 'text-neutral-200' : 'text-red-300'
  return (
    <p
      className={
        'text-xs ' +
        (valid ? 'text-neutral-400' : 'text-red-300')
      }
    >
      Selected:{' '}
      <span className={cls(counts.real, ROLE_NEEDED.real)}>
        {counts.real} real (need {ROLE_NEEDED.real})
      </span>{' '}
      ·{' '}
      <span className={cls(counts.decoy, ROLE_NEEDED.decoy)}>
        {counts.decoy} decoys (need {ROLE_NEEDED.decoy})
      </span>{' '}
      ·{' '}
      <span className={cls(counts.empty, ROLE_NEEDED.empty)}>
        {counts.empty} empty (need {ROLE_NEEDED.empty})
      </span>{' '}
      — {counts.unused} unused
    </p>
  )
}

function RoleBadge({ role }: { role: FlagRole | null }) {
  if (!role) {
    return (
      <span className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] uppercase tracking-wider text-neutral-400">
        unknown
      </span>
    )
  }
  const tone: Record<FlagRole, string> = {
    real: 'bg-emerald-700 text-emerald-50',
    decoy: 'bg-amber-700 text-amber-50',
    empty: 'bg-neutral-700 text-neutral-100',
  }
  return (
    <span
      className={
        'rounded px-2 py-0.5 text-[10px] uppercase tracking-wider ' + tone[role]
      }
    >
      {ROLE_LABEL[role]}
    </span>
  )
}
