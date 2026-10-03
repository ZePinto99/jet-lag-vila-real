'use client'

import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/Button'
import { apiGet, apiPost } from '@/lib/api'
import { getDeviceId } from '@/lib/device'
import { createClient } from '@/lib/supabase/client'
import { useGameStore } from '@/store/gameStore'
import { PlacedCursePanel } from '@/components/game/PlacedCursePanel'
import { useI18n, useT } from '@/lib/i18n/context'
import { localizeCatalogField } from '@/lib/i18n/gameCatalog'
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
  loading: () => <SetupMapLoading />,
})

const ROLES: ReadonlyArray<FlagRole> = ['real', 'decoy', 'empty']

const ROLE_NEEDED: Record<FlagRole, number> = {
  real: 1,
  decoy: 2,
  empty: 2,
}

async function uploadSurroundingsPhoto(
  gameId: string,
  teamId: string,
  file: File,
): Promise<string> {
  const supabase = createClient()
  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const unique =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const path = `${gameId}/${teamId}/${unique}.${ext}`
  const { error } = await supabase.storage.from('surroundings-photos').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || 'image/jpeg',
  })
  if (error) throw error
  return path
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
  const { locale, t } = useI18n()
  const game = useGameStore((s) => s.game)
  const me = useGameStore((s) => s.me)
  const teams = useGameStore((s) => s.teams)
  const players = useGameStore((s) => s.players)
  const myPlacedCurses = useGameStore((s) => s.myPlacedCurses)
  const setGame = useGameStore((s) => s.setGame)

  const [snapshot, setSnapshot] = useState<SetupSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selections, setSelections] = useState<Map<string, FlagRole | null>>(new Map())
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [surroundingsPhoto, setSurroundingsPhoto] = useState<File | null>(null)
  const [view, setView] = useState<'map' | 'list'>('map')
  const [selectedMapRef, setSelectedMapRef] = useState<string | null>(null)

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
        setGame(data.game)

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
        setSelectedMapRef((current) =>
          current && data.my_pool.some((seed) => seed.id === current)
            ? current
            : (data.my_pool[0]?.id ?? null),
        )
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
    if (!game || !snapshot || !isValid || !surroundingsPhoto) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const assignments: FlagAssignment[] = []
      for (const [landmark_ref, role] of selections.entries()) {
        if (role) assignments.push({ landmark_ref, role })
      }
      const surroundingsPhotoPath = await uploadSurroundingsPhoto(
        game.id,
        snapshot.myTeam.id,
        surroundingsPhoto,
      )
      const body: FlagSetupRequest = {
        device_id: getDeviceId(),
        assignments,
        surroundings_photo_path: surroundingsPhotoPath,
      }
      const resp = await apiPost<FlagSetupResponse>(`/api/games/${game.id}/flag-setup`, body)
      // If this was the second team, the response already contains the live
      // game. Do not depend on a realtime row update to enter the match.
      setGame(resp.game)
      setSnapshot((prev) =>
        prev
          ? {
              ...prev,
              myLandmarks: resp.my_landmarks,
              otherTeamDone: resp.both_teams_done || prev.otherTeamDone,
            }
          : prev,
      )
    } catch {
      setSubmitError('submit_failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (!game || !me) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-16">
        <p className="text-sm text-neutral-400">{t('common.loading')}</p>
      </main>
    )
  }

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-16">
        <p className="text-sm text-neutral-400">{t('common.loading')}</p>
      </main>
    )
  }

  if (loadError || !snapshot) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">{t('setup.title')}</h1>
        <div className="rounded-md border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-200">
          {t('setup.load_error')}
        </div>
        <p className="text-xs text-neutral-500">
          {t('common.game')} {game.code}
        </p>
      </main>
    )
  }

  const sideLabel = snapshot.myTeam.side === 'east' ? t('common.east') : t('common.west')
  const homeSeed = snapshot.myPool.find((seed) => seed.id === snapshot.myTeam.home_landmark_id)
  const homeName = homeSeed
    ? localizeCatalogField(homeSeed.id, 'name', homeSeed.name, locale)
    : t('setup.home_base')
  const selectedMapSeed = snapshot.myPool.find((seed) => seed.id === selectedMapRef) ?? null

  if (alreadySubmitted) {
    const submittedAtIso = snapshot.myLandmarks.map((l) => l.created_at).sort()[0]
    const submittedAt = submittedAtIso ? new Date(submittedAtIso) : null
    const submittedRows = snapshot.myLandmarks
      .map((lm) => {
        const seed = snapshot.myPool.find((s) => s.id === lm.ref)
        const role = KIND_TO_ROLE[lm.kind]
        return {
          ref: lm.ref,
          name: seed ? localizeCatalogField(seed.id, 'name', seed.name, locale) : lm.ref,
          role,
        }
      })
      .sort((a, b) => {
        const order: Record<string, number> = { real: 0, decoy: 1, empty: 2 }
        const aRank = a.role ? (order[a.role] ?? 9) : 9
        const bRank = b.role ? (order[b.role] ?? 9) : 9
        if (aRank !== bRank) return aRank - bRank
        return a.name.localeCompare(b.name)
      })

    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-10">
        <header className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="text-2xl font-semibold">{t('setup.title')}</h1>
            <code className="rounded-md bg-neutral-900 px-3 py-1 text-base font-mono tracking-[0.3em] text-neutral-100">
              {game.code}
            </code>
          </div>
          <p className="text-sm text-neutral-400">
            {t('setup.team_assignment_locked', { side: sideLabel })}
          </p>
        </header>

        <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 text-sm text-neutral-300">
          <p>
            {t('setup.assignment_locked')} {t('setup.waiting_other')}
          </p>
          {snapshot.otherTeamDone && (
            <p className="mt-2 text-xs text-neutral-500">{t('setup.both_done')}</p>
          )}
        </section>

        <section className="flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
          <h2 className="text-base font-medium">{t('setup.your_landmarks')}</h2>
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
              {t('setup.submitted_at', {
                time: submittedAt.toLocaleTimeString(locale === 'pt' ? 'pt-PT' : 'en-GB'),
              })}
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
            targetTeamSize={(() => {
              const enemyTeam = teams.find((team) => team.id !== snapshot.myTeam.id)
              return enemyTeam
                ? players.filter((player) => player.team_id === enemyTeam.id).length
                : 8
            })()}
          />
        )}
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-5 px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold">{t('setup.title')}</h1>
          <code className="rounded-md bg-neutral-900 px-3 py-1 text-base font-mono tracking-[0.3em] text-neutral-100">
            {game.code}
          </code>
        </div>
        <p className="text-sm text-neutral-400">
          {t('setup.intro', { side: sideLabel, home: homeName })}
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-300">
            {t('setup.step_choose')}
          </p>
          <h2 className="mt-1 text-lg font-semibold text-neutral-100">{t('setup.choose_title')}</h2>
          <p className="mt-1 text-xs leading-relaxed text-neutral-400">
            {t('setup.assignment_rule')}
          </p>
        </div>

        <CountsFooter counts={counts} valid={isValid} />
        <div className="flex gap-1 rounded-lg border border-neutral-800 bg-neutral-900/40 p-1">
          <ViewTab
            label={t('setup.tab_map')}
            active={view === 'map'}
            onClick={() => setView('map')}
          />
          <ViewTab
            label={t('setup.tab_list')}
            active={view === 'list'}
            onClick={() => setView('list')}
          />
        </div>

        {view === 'map' ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-neutral-400">{t('setup.map_hint')}</p>
            <SetupMap
              mySide={snapshot.myTeam.side}
              myHomeRef={snapshot.myTeam.home_landmark_id}
              selections={selections}
              poolIds={snapshot.myPool.map((s) => s.id)}
              selectedRef={selectedMapRef}
              onSelectLandmark={setSelectedMapRef}
            />
            <MapRolePicker
              landmark={selectedMapSeed}
              index={
                selectedMapSeed
                  ? snapshot.myPool.findIndex((seed) => seed.id === selectedMapSeed.id) + 1
                  : null
              }
              isHome={selectedMapSeed?.id === snapshot.myTeam.home_landmark_id}
              current={selectedMapSeed ? (selections.get(selectedMapSeed.id) ?? null) : null}
              onChange={(role) => {
                if (selectedMapSeed) setRole(selectedMapSeed.id, role)
              }}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-2 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
            <h2 className="text-base font-medium">{t('setup.your_pool')}</h2>
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
                        {localizeCatalogField(seed.id, 'name', seed.name, locale)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <RoleButton
                        label={t('setup.role_none')}
                        active={current === null}
                        onClick={() => setRole(seed.id, null)}
                      />
                      {ROLES.map((r) => (
                        <RoleButton
                          key={r}
                          label={t(`common.${r}`)}
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
          </div>
        )}
      </section>

      <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-300">
          {t('setup.step_photo')}
        </p>
        <h2 className="mt-1 text-sm font-medium text-neutral-100">
          {t('setup.surroundings_title')}
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-neutral-400">
          {t('setup.surroundings_hint')}
        </p>
        <label className="mt-3 block cursor-pointer rounded-md border border-dashed border-neutral-600 bg-neutral-950 px-3 py-3 text-center text-xs font-medium text-neutral-200 transition hover:border-neutral-400">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={submitting}
            onChange={(event) => setSurroundingsPhoto(event.target.files?.[0] ?? null)}
          />
          {surroundingsPhoto ? t('setup.surroundings_ready') : t('setup.surroundings_add')}
        </label>
        {!surroundingsPhoto && (
          <p className="mt-2 text-[11px] text-amber-300/80">{t('setup.surroundings_required')}</p>
        )}
      </section>

      <Button
        onClick={submit}
        disabled={!isValid || !surroundingsPhoto || submitting}
        className="w-full py-4 text-base"
      >
        {submitting ? t('common.submitting') : t('setup.submit_assignment')}
      </Button>
      {submitError && (
        <div
          role="alert"
          className="rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-200"
        >
          {t('setup.submit_error')}
        </div>
      )}
    </main>
  )
}

function ViewTab({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'flex-1 rounded-md px-3 py-2 text-sm font-medium transition ' +
        (active ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-300 hover:bg-neutral-800')
      }
    >
      {label}
    </button>
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
  const baseInactive = 'border-neutral-700 bg-neutral-950 text-neutral-300 hover:bg-neutral-800'
  const activeClass = tone ? toneActive[tone] : 'border-neutral-400 bg-neutral-100 text-neutral-900'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'min-w-[64px] rounded-md border px-3 py-1.5 text-xs font-medium transition ' +
        (active ? activeClass : baseInactive)
      }
    >
      {label}
    </button>
  )
}

function MapRolePicker({
  landmark,
  index,
  isHome,
  current,
  onChange,
}: {
  landmark: SeedLandmark | null
  index: number | null
  isHome: boolean
  current: FlagRole | null
  onChange: (role: FlagRole | null) => void
}) {
  const { locale, t } = useI18n()

  if (!landmark) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-700 px-4 py-4 text-center text-sm text-neutral-400">
        {t('setup.select_landmark')}
      </div>
    )
  }

  const currentTone: Record<FlagRole, string> = {
    real: 'bg-emerald-950 text-emerald-200 ring-emerald-800',
    decoy: 'bg-amber-950 text-amber-200 ring-amber-800',
    empty: 'bg-neutral-800 text-neutral-200 ring-neutral-700',
  }

  return (
    <div
      data-testid="setup-map-role-picker"
      className="rounded-xl border border-neutral-800 bg-neutral-900/70 p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">
            {t('setup.selected_landmark')} {index ? `#${index}` : ''}
          </p>
          <h3 className="mt-1 text-sm font-semibold text-neutral-100">
            {localizeCatalogField(landmark.id, 'name', landmark.name, locale)}
          </h3>
          {isHome && (
            <span className="mt-1 inline-flex rounded-full bg-blue-950 px-2 py-0.5 text-[10px] font-medium text-blue-200">
              {t('setup.home_base')}
            </span>
          )}
        </div>
        <span
          className={
            'shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ring-1 ' +
            (current ? currentTone[current] : 'bg-neutral-950 text-neutral-400 ring-neutral-700')
          }
        >
          {current ? t(`common.${current}`) : t('setup.unassigned')}
        </span>
      </div>

      <p className="mt-3 text-xs text-neutral-400">{t('setup.choose_role')}</p>
      <div role="group" aria-label={t('setup.choose_role')} className="mt-2 flex flex-wrap gap-2">
        <RoleButton
          label={t('setup.role_none')}
          active={current === null}
          onClick={() => onChange(null)}
        />
        {ROLES.map((role) => (
          <RoleButton
            key={role}
            label={t(`common.${role}`)}
            tone={role}
            active={current === role}
            onClick={() => onChange(role)}
          />
        ))}
      </div>
    </div>
  )
}

function CountsFooter({
  counts,
  valid,
}: {
  counts: { real: number; decoy: number; empty: number; unused: number }
  valid: boolean
}) {
  const t = useT()
  const assigned = counts.real + counts.decoy + counts.empty
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-neutral-300">
          {t('setup.progress', { count: assigned })}
        </span>
        {valid && (
          <span className="text-[11px] font-semibold text-emerald-300">
            {t('setup.selection_complete')}
          </span>
        )}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <CountPill
          label={t('common.real')}
          count={counts.real}
          needed={ROLE_NEEDED.real}
          tone="real"
        />
        <CountPill
          label={t('common.decoy')}
          count={counts.decoy}
          needed={ROLE_NEEDED.decoy}
          tone="decoy"
        />
        <CountPill
          label={t('common.empty')}
          count={counts.empty}
          needed={ROLE_NEEDED.empty}
          tone="empty"
        />
      </div>
    </div>
  )
}

function CountPill({
  label,
  count,
  needed,
  tone,
}: {
  label: string
  count: number
  needed: number
  tone: FlagRole
}) {
  const complete = count === needed
  const over = count > needed
  const dot: Record<FlagRole, string> = {
    real: 'bg-emerald-400',
    decoy: 'bg-amber-400',
    empty: 'bg-neutral-400',
  }
  return (
    <div
      className={
        'flex items-center justify-between gap-1 rounded-lg border px-2.5 py-2 text-xs ' +
        (over
          ? 'border-red-800 bg-red-950/40 text-red-200'
          : complete
            ? 'border-emerald-900 bg-emerald-950/30 text-neutral-100'
            : 'border-neutral-800 bg-neutral-950 text-neutral-300')
      }
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot[tone]}`} />
        <span className="truncate">{label}</span>
      </span>
      <span className="font-mono font-semibold">
        {count}/{needed}
      </span>
    </div>
  )
}

function RoleBadge({ role }: { role: FlagRole | null }) {
  const t = useT()
  if (!role) {
    return (
      <span className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] uppercase tracking-wider text-neutral-400">
        {t('setup.unassigned')}
      </span>
    )
  }
  const tone: Record<FlagRole, string> = {
    real: 'bg-emerald-700 text-emerald-50',
    decoy: 'bg-amber-700 text-amber-50',
    empty: 'bg-neutral-700 text-neutral-100',
  }
  return (
    <span className={'rounded px-2 py-0.5 text-[10px] uppercase tracking-wider ' + tone[role]}>
      {t(`common.${role}`)}
    </span>
  )
}

function SetupMapLoading() {
  const t = useT()
  return (
    <div className="flex h-72 w-full items-center justify-center rounded-xl border border-neutral-800 bg-neutral-950 text-sm text-neutral-500">
      {t('common.loading')}
    </div>
  )
}
