'use client'

// Live phase view: map, actions, status tabs. Wires together the live-state
// fetch, GPS, presence and event subscription. The GameMap is dynamic-imported
// because Leaflet touches `window` during module init.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/Button'
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher'
import { useT } from '@/lib/i18n/context'
import { apiGet, apiPost } from '@/lib/api'
import { cn } from '@/lib/cn'
import { getDeviceId } from '@/lib/device'
import { useGameStore } from '@/store/gameStore'
import { useGPS } from '@/lib/hooks/useGPS'
import { usePresence } from '@/lib/hooks/usePresence'
import { useLiveGameRealtime } from '@/lib/hooks/useLiveGameRealtime'
import { useCamping } from '@/lib/hooks/useCamping'
import { useTagButton } from '@/lib/hooks/useTagButton'
import { useFlagAttemptButton } from '@/lib/hooks/useFlagAttemptButton'
import { useCurseExpiryPoll } from '@/lib/hooks/useCurseExpiryPoll'
import { useCurseEnforcement } from '@/lib/hooks/useCurseEnforcement'
import { useGameToasts } from '@/lib/hooks/useGameToasts'
import { usePlacedCurseTrigger } from '@/lib/hooks/usePlacedCurseTrigger'
import { ToastLayer } from '@/components/game/ToastLayer'
import { PlacedCursePanel } from '@/components/game/PlacedCursePanel'
import { computeNarrowedRefs } from '@/lib/intel/narrowing'
import { getSeedLandmarkByRef } from '@/lib/landmarks'
import { useDiscoveredEnemyKinds } from '@/lib/hooks/useDiscoveredEnemyKinds'
import { TagButton } from '@/components/game/TagButton'
import { RespawnBanner } from '@/components/game/RespawnBanner'
import { FlagAttemptButton } from '@/components/game/FlagAttemptButton'
import { FlagCarrierBanner } from '@/components/game/FlagCarrierBanner'
import { FlagFoundBanner } from '@/components/game/FlagFoundBanner'
import { GameOverOverlay } from '@/components/game/GameOverOverlay'
import { HardenFlagButton } from '@/components/game/HardenFlagButton'
import { IntelPurchasePanel } from '@/components/game/IntelPurchasePanel'
import { IntelCardDisplay } from '@/components/game/IntelCardDisplay'
import { CursePurchasePanel } from '@/components/game/CursePurchasePanel'
import { ActiveCursesBanner } from '@/components/game/ActiveCursesBanner'
import { CurseHistoryList } from '@/components/game/CurseHistoryList'
import { ChallengesPanel } from '@/components/game/ChallengesPanel'
import { ChallengeHistoryList } from '@/components/game/ChallengeHistoryList'
import type {
  ActiveCurse,
  Card,
  GameEvent,
  LiveStateResponse,
  Player,
  Team,
} from '@/lib/types'

const GameMap = dynamic(() => import('@/components/map/GameMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-neutral-950 text-sm text-neutral-500">
      Loading map…
    </div>
  ),
})

type Tab = 'map' | 'actions' | 'status'

const DEFAULT_DURATION_MIN = 180 // 3 hours per RULEBOOK §4.2
const ATTEMPT_PROTECTION_MIN = 30 // RULEBOOK §5.2 — no flag attempts in first 30 min

export function Live() {
  const t = useT()
  const game = useGameStore((s) => s.game)
  const teams = useGameStore((s) => s.teams)
  const players = useGameStore((s) => s.players)
  const me = useGameStore((s) => s.me)

  const myTeamLandmarks = useGameStore((s) => s.myTeamLandmarks)
  const enemyLandmarks = useGameStore((s) => s.enemyLandmarks)
  const activeCurses = useGameStore((s) => s.activeCurses)
  const myCards = useGameStore((s) => s.myCards)
  const myPlacedCurses = useGameStore((s) => s.myPlacedCurses)
  const events = useGameStore((s) => s.events)
  const myGps = useGameStore((s) => s.myGps)
  const presence = useGameStore((s) => s.presence)

  const setLiveSnapshot = useGameStore((s) => s.setLiveSnapshot)
  const setMyGps = useGameStore((s) => s.setMyGps)
  const setPresenceInStore = useGameStore((s) => s.setPresence)

  const [tab, setTab] = useState<Tab>('map')
  const [snapshotLoading, setSnapshotLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [gpsEnabled, setGpsEnabled] = useState(false)
  const [now, setNow] = useState<number>(() => Date.now())

  // 1s ticking clock for countdowns.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  // Fetch the live snapshot on mount / game id change.
  useEffect(() => {
    if (!game?.id) return
    let cancelled = false
    setSnapshotLoading(true)
    setLoadError(null)
    ;(async () => {
      try {
        const deviceId = getDeviceId()
        const data = await apiGet<LiveStateResponse>(
          `/api/games/${game.id}/live-state?device_id=${encodeURIComponent(deviceId)}`,
        )
        if (cancelled) return
        setLiveSnapshot(data)
      } catch (err) {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'unknown_error')
      } finally {
        if (!cancelled) setSnapshotLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [game?.id, setLiveSnapshot])

  // GPS — only after the user opts in.
  const gps = useGPS(gpsEnabled)
  useEffect(() => {
    if (!gpsEnabled) {
      setMyGps(null)
      return
    }
    if (!gps.position) return
    setMyGps(gps.position)
  }, [gpsEnabled, gps.position, setMyGps])

  // Realtime subscriptions (events + team/game/cards updates).
  const myTeamId = me?.team_id ?? null
  useLiveGameRealtime(game?.id ?? null, myTeamId)

  // Camping detection (50 m / 2 min rule). Drives the Tag button's
  // camping_locked state and the on-screen warning.
  const camping = useCamping({ myGps, myTeamLandmarks })

  // Tag eligibility — pure derivation from GPS + presence + my own landmarks.
  const tagState = useTagButton({
    myGps,
    myPlayerId: me?.id ?? null,
    myTeamId,
    myTeamLandmarks,
    presence,
    respawning: me?.respawning ?? false,
    campingLocked: camping.campingLocked,
  })

  // Which enemy landmarks have my team confirmed (by attempting them)?
  // Drives both the map popups and the "already_discovered" disable reason
  // on the flag-attempt button.
  const discoveredEnemyKinds = useDiscoveredEnemyKinds(events, myTeamId)

  // Intel filter — derive ruled-out enemy refs from my intel cards. The
  // toggle controls whether the map dims them.
  const [intelFilterEnabled, setIntelFilterEnabled] = useState(false)
  const myIntelCards = useMemo<Card[]>(
    () => myCards.filter((c) => c.kind === 'intel'),
    [myCards],
  )
  const myTeamFromStore = useMemo<Team | null>(() => {
    if (!me) return null
    return teams.find((t) => t.id === me.team_id) ?? null
  }, [teams, me])
  const myTeamHomeLng = useMemo<number | null>(() => {
    if (!myTeamFromStore?.home_landmark_id) return null
    const seed = getSeedLandmarkByRef(myTeamFromStore.home_landmark_id)
    return seed?.lng ?? null
  }, [myTeamFromStore])
  const narrowedOutRefs = useMemo(
    () =>
      computeNarrowedRefs({
        intelCards: myIntelCards,
        enemyLandmarks,
        myTeamHomeLng,
        seedLookup: (ref) => getSeedLandmarkByRef(ref) ?? null,
      }),
    [myIntelCards, enemyLandmarks, myTeamHomeLng],
  )

  // Flag-attempt eligibility — proximity check vs enemy candidate landmarks.
  const flagAttemptState = useFlagAttemptButton({
    myGps,
    enemyLandmarks,
    respawning: me?.respawning ?? false,
    gameStatus: game?.status ?? 'lobby',
    discoveredEnemyKinds,
  })

  // Presence broadcast for my GPS.
  const { presence: presenceFromHook } = usePresence(
    game?.id ?? null,
    me?.id ?? null,
    myTeamId,
    myGps,
  )
  useEffect(() => {
    setPresenceInStore(presenceFromHook)
  }, [presenceFromHook, setPresenceInStore])

  // Curse expiry housekeeping — polls /expire-curses every 20 s while any
  // curses are active on our team. Idempotent on the server.
  useCurseExpiryPoll(game?.id ?? null, activeCurses.length)

  // Curse enforcement (P2-6) — Full Stop locks all actions; [A]/[B]/[L] curses
  // get live readouts / timed prompts in the banner.
  const curseEnforcement = useCurseEnforcement({
    activeCurses,
    myGps,
    myTeamId,
    presence,
    nowMs: now,
    t,
  })
  const actionsLocked = curseEnforcement.actionsLocked
  const lockedLabel = actionsLocked ? t('curse.actions_locked') : null

  // In-app discovery toasts (P2-5): attempt start/resolve + enemy-proximity.
  const { toasts, dismiss: dismissToast } = useGameToasts({
    events,
    myTeamId,
    myPlayerId: me?.id ?? null,
    players,
    presence,
    myTeamLandmarks,
    t,
  })

  // Placed-curse trigger (P2-2): fire a hidden enemy placement when I enter its
  // zone. Server-authoritative; silent if no trap.
  usePlacedCurseTrigger(
    game?.id ?? null,
    me?.id ?? null,
    myGps,
    enemyLandmarks,
    game?.status === 'live' || game?.status === 'flag_found',
  )

  const myTeam = useMemo<Team | null>(() => {
    if (!me) return null
    return teams.find((t) => t.id === me.team_id) ?? null
  }, [teams, me])

  const enemyTeam = useMemo<Team | null>(() => {
    if (!myTeam) return null
    return teams.find((t) => t.id !== myTeam.id) ?? null
  }, [teams, myTeam])

  const flagCarrier = useMemo<Player | null>(() => {
    return players.find((p) => p.flag_carrier) ?? null
  }, [players])

  const flagCarrierTeam = useMemo<Team | null>(() => {
    if (!flagCarrier) return null
    return teams.find((t) => t.id === flagCarrier.team_id) ?? null
  }, [teams, flagCarrier])

  const endsAtMs = useMemo<number | null>(() => {
    if (!game?.started_at) return null
    const minutes = game.config?.duration_minutes ?? DEFAULT_DURATION_MIN
    return new Date(game.started_at).getTime() + minutes * 60_000
  }, [game?.started_at, game?.config?.duration_minutes])

  // 30-min flag-attempt protection window (P2-3). Server-derived from
  // started_at so it survives refresh / late join.
  const attemptsUnlockAtMs = useMemo<number | null>(() => {
    if (!game?.started_at) return null
    return new Date(game.started_at).getTime() + ATTEMPT_PROTECTION_MIN * 60_000
  }, [game?.started_at])

  // Auto-end on 3-hour timeout. Fire-once guarded by a ref so the 1 Hz
  // clock tick doesn't spam the endpoint. The server route is idempotent
  // (returns the finished snapshot if it has already run).
  const timeoutSubmittedRef = useRef(false)
  useEffect(() => {
    if (!game?.id || !endsAtMs) return
    if (game.status !== 'live' && game.status !== 'flag_found') return
    if (now < endsAtMs) return
    if (timeoutSubmittedRef.current) return
    timeoutSubmittedRef.current = true
    apiPost(`/api/games/${game.id}/end-by-timeout`, {
      device_id: getDeviceId(),
    }).catch(() => {
      // Reset so a later tick can retry (network blips, etc.).
      timeoutSubmittedRef.current = false
    })
  }, [game?.id, game?.status, endsAtMs, now])

  const toggleGps = useCallback(() => {
    setGpsEnabled((v) => !v)
  }, [])

  if (!game || !me) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-sm text-neutral-400">
        Loading live game…
      </main>
    )
  }

  if (snapshotLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-sm text-neutral-400">
        {t('live.loading_live')}
      </main>
    )
  }

  if (loadError || !myTeam || !enemyTeam) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold">Live phase</h1>
        <div className="rounded-md border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-200">
          {loadError ?? 'Could not load live state.'}
        </div>
        <p className="text-xs text-neutral-500">Game {game.code}</p>
      </main>
    )
  }

  const sideLabel = myTeam.side === 'east' ? t('common.east') : t('common.west')
  const sideColorClass =
    myTeam.side === 'east' ? 'text-pink-300' : 'text-blue-300'

  const iAmFlagCarrier = Boolean(flagCarrier && flagCarrier.id === me.id)
  const isFlagFound = game.status === 'flag_found'
  const isGameOver = game.status === 'finished'

  // 30-min flag-attempt protection window: lock the Attempt button and show a
  // header countdown while the window is open.
  const withinProtection =
    attemptsUnlockAtMs != null && now < attemptsUnlockAtMs
  const flagAttemptLockedLabel = actionsLocked
    ? lockedLabel
    : withinProtection
      ? t('attempt.locked_window', { time: mmss(attemptsUnlockAtMs! - now) })
      : null

  return (
    <main className="flex min-h-screen flex-col bg-neutral-950 text-neutral-100">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 border-b border-neutral-800 bg-neutral-950/95 px-4 py-2 backdrop-blur">
        <div className="flex items-baseline gap-3">
          <code className="rounded bg-neutral-900 px-2 py-0.5 font-mono text-sm tracking-[0.2em] text-neutral-100">
            {game.code}
          </code>
          <span className={cn('text-xs font-medium', sideColorClass)}>
            {t('common.team')} {sideLabel}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-neutral-400">
          <span>{myTeam.coins} {t('common.coins')}</span>
          <Countdown endsAtMs={endsAtMs} nowMs={now} />
          <LanguageSwitcher />
        </div>
      </header>

      {/* Banners — flag carrier banner takes priority over the generic
          "flag found" banner so the carrier always sees their own
          run-home UI. */}
      {isFlagFound && iAmFlagCarrier && (
        <FlagCarrierBanner
          gameId={game.id}
          myPlayerId={me.id}
          myTeam={myTeam}
          myGps={myGps}
        />
      )}
      {isFlagFound && !iAmFlagCarrier && flagCarrier && (
        <FlagFoundBanner
          carrier={flagCarrier}
          carrierTeam={flagCarrierTeam}
          myTeam={myTeam}
        />
      )}

      {/* Flag-attempt protection window countdown (first 30 min). */}
      {withinProtection && !isGameOver && (
        <div className="border-b border-sky-800/60 bg-sky-950/40 px-4 py-1.5 text-center text-[11px] font-medium text-sky-200">
          🔒 {t('attempt.window_header', { time: mmss(attemptsUnlockAtMs! - now) })}
        </div>
      )}

      {/* Active curses banner — sits below carrier/flag-found banners so the
          most game-critical state stays on top, and above the respawn banner. */}
      <ActiveCursesBanner
        activeCurses={activeCurses}
        nowMs={now}
        actionsLocked={actionsLocked}
        byCurseId={curseEnforcement.byCurseId}
      />

      {/* Respawn banner — shows above tabs whenever the local player is
          respawning. Visible from any tab so the player can't miss it. */}
      <RespawnBanner
        gameId={game.id}
        myPlayerId={me.id}
        myGps={myGps}
        respawning={me.respawning}
      />

      {/* Tab content */}
      <div className="relative flex-1 overflow-hidden">
        {tab === 'map' && (
          <div className="absolute inset-0">
            <GameMap
              myTeamLandmarks={myTeamLandmarks}
              enemyLandmarks={enemyLandmarks}
              myTeam={myTeam}
              enemyTeam={enemyTeam}
              myGps={myGps}
              presence={presence}
              myPlayerId={me.id}
              discoveredEnemyKinds={discoveredEnemyKinds}
              narrowedOutRefs={narrowedOutRefs}
              intelFilterEnabled={intelFilterEnabled}
              onToggleIntelFilter={() => setIntelFilterEnabled((v) => !v)}
              myIntelCards={myIntelCards}
              myTeamHomeLng={myTeamHomeLng}
              attemptsLocked={withinProtection}
            />
            <MapOverlay
              gpsEnabled={gpsEnabled}
              onToggleGps={toggleGps}
              accuracy={gps.position?.accuracy ?? null}
              error={gps.error}
            />
            {/* Camping warning rides at the top of the map; the Tag button at
                the bottom-center. Both pointer-events-none on the wrapper so
                taps fall through to the map outside the button itself. */}
            {camping.status !== 'idle' && (
              <div className="pointer-events-none absolute left-1/2 top-3 z-[400] -translate-x-1/2 rounded-md bg-amber-900/80 px-3 py-1 text-[11px] font-medium text-amber-100 shadow">
                {camping.status === 'locked'
                  ? 'Camping locked — leave own landmark for 60 s to reset'
                  : `Camping warning — ${camping.lockThresholdSeconds - camping.secondsInZone}s until tag disabled`}
              </div>
            )}
            {/* Bottom-anchored action stack: Tag at the top of the stack
                (most reflex-driven), Flag Attempt below. The pointer-events
                wrapper is set on each child so map taps still register
                between the buttons. */}
            <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[400] flex flex-col items-center gap-2 px-4">
              <TagButton
                gameId={game.id}
                myPlayerId={me.id}
                myGpsPos={myGps}
                meState={tagState}
                lockedLabel={lockedLabel}
              />
              <FlagAttemptButton
                gameId={game.id}
                myPlayerId={me.id}
                myGpsPos={myGps}
                meState={flagAttemptState}
                lockedLabel={flagAttemptLockedLabel}
              />
            </div>
          </div>
        )}

        {tab === 'actions' && (
          <ActionsTab
            gameId={game.id}
            myPlayerId={me.id}
            gameStatus={game.status}
            coins={myTeam.coins}
            sideLabel={sideLabel}
            myCards={myCards}
            myGps={myGps}
            respawning={me.respawning}
            actionsLocked={actionsLocked}
            myTeamLandmarks={myTeamLandmarks}
            placedCurses={myPlacedCurses}
          />
        )}

        {tab === 'status' && (
          <StatusTab
            gameId={game.id}
            gameStatus={game.status}
            myPlayerId={me.id}
            myTeam={myTeam}
            myTeamLandmarks={myTeamLandmarks}
            activeCurses={activeCurses}
            myCards={myCards}
            events={events}
            players={players}
            teams={teams}
            nowMs={now}
            actionsLocked={actionsLocked}
          />
        )}
      </div>

      {/* Bottom tab bar */}
      <nav className="grid grid-cols-3 border-t border-neutral-800 bg-neutral-950">
        <TabButton label={t('live.tab_map')} active={tab === 'map'} onClick={() => setTab('map')} />
        <TabButton label={t('live.tab_actions')} active={tab === 'actions'} onClick={() => setTab('actions')} />
        <TabButton label={t('live.tab_status')} active={tab === 'status'} onClick={() => setTab('status')} />
      </nav>

      {/* In-app discovery toasts (top-center, foregrounded only). */}
      <ToastLayer toasts={toasts} onDismiss={dismissToast} />

      {/* Game-over screen — fixed/full-screen, sits over everything else. */}
      {isGameOver && (
        <GameOverOverlay
          events={events}
          teams={teams}
          players={players}
          myTeamId={myTeam.id}
          onViewTimeline={() => setTab('status')}
        />
      )}
    </main>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TabButton({
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
      className={cn(
        'px-3 py-3 text-center text-sm font-medium transition',
        active
          ? 'bg-neutral-900 text-neutral-100'
          : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200',
      )}
    >
      {label}
    </button>
  )
}

function Countdown({
  endsAtMs,
  nowMs,
}: {
  endsAtMs: number | null
  nowMs: number
}) {
  if (!endsAtMs) return <span className="text-neutral-500">--:--</span>
  const remainingMs = Math.max(0, endsAtMs - nowMs)
  const h = Math.floor(remainingMs / 3_600_000)
  const m = Math.floor((remainingMs % 3_600_000) / 60_000)
  const s = Math.floor((remainingMs % 60_000) / 1000)
  const text =
    h > 0
      ? `${h}:${pad2(m)}:${pad2(s)}`
      : `${pad2(m)}:${pad2(s)}`
  return (
    <span
      className={cn(
        'font-mono tabular-nums',
        remainingMs <= 0
          ? 'text-red-300'
          : remainingMs < 10 * 60_000
            ? 'text-amber-300'
            : 'text-neutral-200',
      )}
    >
      {text}
    </span>
  )
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function mmss(remainingMs: number): string {
  const rem = Math.max(0, remainingMs)
  const m = Math.floor(rem / 60_000)
  const s = Math.floor((rem % 60_000) / 1000)
  return `${m}:${pad2(s)}`
}

function MapOverlay({
  gpsEnabled,
  onToggleGps,
  accuracy,
  error,
}: {
  gpsEnabled: boolean
  onToggleGps: () => void
  accuracy: number | null
  error: string | null
}) {
  const t = useT()
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-[400] flex flex-col items-start gap-2">
      <Button
        variant={gpsEnabled ? 'secondary' : 'primary'}
        onClick={onToggleGps}
        className="pointer-events-auto py-2 text-xs"
      >
        {gpsEnabled ? t('live.gps_on') : t('live.enable_gps')}
      </Button>
      {gpsEnabled && (
        <div className="pointer-events-none rounded bg-neutral-950/80 px-2 py-1 text-[11px] text-neutral-300">
          {error
            ? `GPS error: ${error}`
            : accuracy != null
              ? `accuracy ±${Math.round(accuracy)} m`
              : 'acquiring…'}
        </div>
      )}
    </div>
  )
}

function ActionsTab({
  gameId,
  myPlayerId,
  gameStatus,
  coins,
  sideLabel,
  myCards,
  myGps,
  respawning,
  actionsLocked,
  myTeamLandmarks,
  placedCurses,
}: {
  gameId: string
  myPlayerId: string
  gameStatus: import('@/lib/types').GameStatus
  coins: number
  sideLabel: string
  myCards: Card[]
  myGps: import('@/lib/types').GpsPosition | null
  respawning: boolean
  actionsLocked: boolean
  myTeamLandmarks: import('@/lib/types').Landmark[]
  placedCurses: import('@/lib/types').PlacedCurse[]
}) {
  const myIntelCards = myCards.filter((c) => c.kind === 'intel')
  return (
    <section className="mx-auto flex h-full max-w-2xl flex-col gap-4 overflow-y-auto px-6 py-6">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
        <p className="text-xs uppercase tracking-wider text-neutral-500">
          Team {sideLabel} balance
        </p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{coins}</p>
        <p className="text-xs text-neutral-500">coins</p>
      </div>

      <IntelPurchasePanel
        gameId={gameId}
        myPlayerId={myPlayerId}
        gameStatus={gameStatus}
        teamCoins={coins}
        myIntelCards={myIntelCards}
        myGps={myGps}
        actionsLocked={actionsLocked}
      />

      <CursePurchasePanel
        gameId={gameId}
        gameStatus={gameStatus}
        teamCoins={coins}
        myPlayerId={myPlayerId}
        actionsLocked={actionsLocked}
      />

      <PlacedCursePanel
        gameId={gameId}
        myPlayerId={myPlayerId}
        teamCoins={coins}
        myCandidateLandmarks={myTeamLandmarks}
        placedCurses={placedCurses}
        actionsLocked={actionsLocked}
      />

      <ChallengesPanel
        gameId={gameId}
        gameStatus={gameStatus}
        myPlayerId={myPlayerId}
        myGps={myGps}
        respawning={respawning}
        actionsLocked={actionsLocked}
      />
    </section>
  )
}

function StatusTab({
  gameId,
  gameStatus,
  myPlayerId,
  myTeam,
  myTeamLandmarks,
  activeCurses,
  myCards,
  events,
  players,
  teams,
  nowMs,
  actionsLocked,
}: {
  gameId: string
  gameStatus: import('@/lib/types').GameStatus
  myPlayerId: string
  myTeam: Team
  myTeamLandmarks: import('@/lib/types').Landmark[]
  activeCurses: ActiveCurse[]
  myCards: Card[]
  events: GameEvent[]
  players: Player[]
  teams: Team[]
  nowMs: number
  actionsLocked: boolean
}) {
  return (
    <section className="mx-auto flex h-full max-w-2xl flex-col gap-4 overflow-y-auto px-6 py-6">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
        <p className="text-xs uppercase tracking-wider text-neutral-500">
          Team {myTeam.side === 'east' ? 'East' : 'West'}
        </p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{myTeam.coins}</p>
        <p className="text-xs text-neutral-500">coins</p>
      </div>

      <HardenFlagButton
        gameId={gameId}
        myPlayerId={myPlayerId}
        gameStatus={gameStatus}
        myTeamLandmarks={myTeamLandmarks}
        teamCoins={myTeam.coins}
        actionsLocked={actionsLocked}
      />

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
        <h2 className="text-sm font-medium text-neutral-100">Curses on us</h2>
        {activeCurses.length === 0 ? (
          <p className="mt-2 text-xs text-neutral-500">None.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {activeCurses.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs"
              >
                <span className="font-mono text-neutral-200">{c.curse_ref}</span>
                <span className="text-neutral-400">
                  {c.expires_at
                    ? formatTimeRemaining(new Date(c.expires_at).getTime(), nowMs)
                    : 'no timer'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <IntelCardDisplay myCards={myCards} />

      <CurseHistoryList events={events} myTeamId={myTeam.id} />

      <ChallengeHistoryList events={events} myTeamId={myTeam.id} />

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
        <h2 className="text-sm font-medium text-neutral-100">Timeline</h2>
        {events.length === 0 ? (
          <p className="mt-2 text-xs text-neutral-500">No events yet.</p>
        ) : (
          <ol className="mt-2 flex flex-col gap-1">
            {events.map((e) => (
              <li
                key={e.id}
                className="flex items-baseline gap-2 rounded px-2 py-1 text-xs odd:bg-neutral-900/40"
              >
                <span className="font-mono text-[10px] text-neutral-500">
                  {formatClock(e.created_at)}
                </span>
                <span className="font-medium text-neutral-200">{e.type}</span>
                <span className="text-neutral-400">
                  {summariseEvent(e, players, teams)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatClock(iso: string): string {
  const d = new Date(iso)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function formatTimeRemaining(endsMs: number, nowMs: number): string {
  const rem = Math.max(0, endsMs - nowMs)
  if (rem === 0) return 'expired'
  const m = Math.floor(rem / 60_000)
  const s = Math.floor((rem % 60_000) / 1000)
  return `${m}m ${pad2(s)}s`
}

function summariseEvent(
  e: GameEvent,
  players: Player[],
  _teams: Team[],
): string {
  const actor = e.actor_player_id
    ? players.find((p) => p.id === e.actor_player_id)?.display_name ?? 'someone'
    : 'system'
  const keys = Object.keys(e.payload)
  if (keys.length === 0) return `by ${actor}`
  // Render up to 3 short scalar keys for a one-liner; pretty JSON for deep ones.
  const scalars = keys
    .filter((k) => {
      const v = (e.payload as Record<string, unknown>)[k]
      return v == null || ['string', 'number', 'boolean'].includes(typeof v)
    })
    .slice(0, 3)
    .map((k) => `${k}=${String((e.payload as Record<string, unknown>)[k])}`)
    .join(' ')
  return `by ${actor}${scalars ? ' · ' + scalars : ''}`
}

