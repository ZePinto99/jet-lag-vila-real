'use client'

// Live phase view: map, actions, status tabs. Wires together the live-state
// fetch, GPS, presence and event subscription. The GameMap is dynamic-imported
// because Leaflet touches `window` during module init.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import cursesSeed from '@/data/curses.json'
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher'
import { useI18n, useT } from '@/lib/i18n/context'
import { localizeCatalogField } from '@/lib/i18n/gameCatalog'
import type { Locale } from '@/lib/i18n/messages'
import { apiGet, apiPost } from '@/lib/api'
import { cn } from '@/lib/cn'
import { DEFAULT_DURATION_MIN, PROTECTION_WINDOW_MS } from '@/lib/gameConstants'
import { getDeviceId } from '@/lib/device'
import { useGameStore } from '@/store/gameStore'
import { useGPS } from '@/lib/hooks/useGPS'
import { usePresence } from '@/lib/hooks/usePresence'
import { useLiveGameRealtime } from '@/lib/hooks/useLiveGameRealtime'
import { useCamping } from '@/lib/hooks/useCamping'
import { useTagButton } from '@/lib/hooks/useTagButton'
import { useFlagAttemptButton } from '@/lib/hooks/useFlagAttemptButton'
import { useCurseExpiryPoll } from '@/lib/hooks/useCurseExpiryPoll'
import { useChallengeReviewResolution } from '@/lib/hooks/useChallengeReviewResolution'
import { useCurseEnforcement } from '@/lib/hooks/useCurseEnforcement'
import { useGameToasts } from '@/lib/hooks/useGameToasts'
import { useGameMoments } from '@/lib/hooks/useGameMoments'
import { usePlacedCurseTrigger } from '@/lib/hooks/usePlacedCurseTrigger'
import { useWalkingSpeed } from '@/lib/hooks/useWalkingSpeed'
import { useChaseStatus } from '@/lib/hooks/useChaseStatus'
import { useTimeTick } from '@/lib/hooks/useTimeTick'
import { usePushNotifications, type PushNotificationStatus } from '@/lib/hooks/usePushNotifications'
import { isMuted as soundIsMuted, setMuted as soundSetMuted } from '@/lib/sound'
import { ToastLayer } from '@/components/game/ToastLayer'
import { MomentOverlay } from '@/components/game/MomentOverlay'
import { WalkingNudge } from '@/components/game/WalkingNudge'
import { BoundaryNudge } from '@/components/game/BoundaryNudge'
import {
  getMapDisplayPosition,
  getPlayAreaReturnPoint,
  getPlayAreaStateForGps,
  type PlayAreaState,
} from '@/lib/geo/playArea'
import { isPositionFresh } from '@/lib/geo/positionFreshness'
import { ChaseHud } from '@/components/game/ChaseHud'
import { TimeBonusBanner } from '@/components/game/TimeBonusBanner'
import { WeatherPausePanel } from '@/components/game/WeatherPausePanel'
import { PlacedCursePanel } from '@/components/game/PlacedCursePanel'
import { computeNarrowedRefs } from '@/lib/intel/narrowing'
import { getSeedLandmarkByRef } from '@/lib/landmarks'
import { weatherProposalNeedsConfirmation } from '@/lib/weatherPause'
import { useDiscoveredEnemyKinds } from '@/lib/hooks/useDiscoveredEnemyKinds'
import { useEnemyLandmarkLocks } from '@/lib/hooks/useEnemyLandmarkLocks'
import { useActiveChallenges } from '@/lib/hooks/useActiveChallenges'
import { TagButton } from '@/components/game/TagButton'
import { HostRespawnOverride } from '@/components/game/HostRespawnOverride'
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
import { ChallengeReviewPanel } from '@/components/game/ChallengeReviewPanel'
import { ChallengeHistoryList } from '@/components/game/ChallengeHistoryList'
import { ChatPanel } from '@/components/game/ChatPanel'
import { useChat } from '@/lib/hooks/useChat'
import { buildChallengeProofIndex, challengeProofUrl } from '@/lib/challenges/proofs'
import { gameClockNow } from '@/lib/gameClock'
import { resolveLiveActionLock } from '@/lib/liveActionLock'
import type {
  ActiveCurse,
  Card,
  EndByTimeoutResponse,
  Game,
  GameEvent,
  GpsPosition,
  LiveStateResponse,
  Player,
  Team,
} from '@/lib/types'

const GameMap = dynamic(() => import('@/components/map/GameMap'), {
  ssr: false,
  loading: () => <LiveMapLoading />,
})

type Tab = 'map' | 'actions' | 'status' | 'chat'

const CURSE_NAMES = new Map(
  (cursesSeed as Array<{ id: string; name: string }>).map((curse) => [curse.id, curse.name]),
)

// Game length and the opening no-attempts window both come from
// lib/gameConstants.ts so this view, the API routes that enforce them and the
// player guide that explains them never drift apart.

export function Live() {
  const t = useT()
  const game = useGameStore((s) => s.game)
  const teams = useGameStore((s) => s.teams)
  const players = useGameStore((s) => s.players)
  const me = useGameStore((s) => s.me)

  const myTeamLandmarks = useGameStore((s) => s.myTeamLandmarks)
  const enemyLandmarks = useGameStore((s) => s.enemyLandmarks)
  const activeCurses = useGameStore((s) => s.activeCurses)
  const myCurseProofs = useGameStore((s) => s.myCurseProofs)
  const myCards = useGameStore((s) => s.myCards)
  const myPlacedCurses = useGameStore((s) => s.myPlacedCurses)
  const pendingChallengeReviews = useGameStore((s) => s.pendingChallengeReviews)
  const events = useGameStore((s) => s.events)
  const myGps = useGameStore((s) => s.myGps)
  const presence = useGameStore((s) => s.presence)

  const setLiveSnapshot = useGameStore((s) => s.setLiveSnapshot)
  const setGame = useGameStore((s) => s.setGame)
  const upsertTeam = useGameStore((s) => s.upsertTeam)
  const upsertPlayer = useGameStore((s) => s.upsertPlayer)
  const upsertCard = useGameStore((s) => s.upsertCard)
  const addCurseProof = useGameStore((s) => s.addCurseProof)
  const setMyGps = useGameStore((s) => s.setMyGps)
  const setPresenceInStore = useGameStore((s) => s.setPresence)

  const [tab, setTab] = useState<Tab>('map')
  const [snapshotLoading, setSnapshotLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [gpsEnabled, setGpsEnabled] = useState(false)
  const [flagAttemptPanelOpen, setFlagAttemptPanelOpen] = useState(false)
  const [now, setNow] = useState<number>(() => Date.now())
  const [muted, setMutedState] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mapCommand, setMapCommand] = useState<{
    type: 'fit' | 'recenter'
    requestId: number
  } | null>(null)

  // Sync the sound-mute toggle from localStorage after mount (avoids SSR drift).
  useEffect(() => {
    setMutedState(soundIsMuted())
  }, [])
  const toggleMute = useCallback(() => {
    setMutedState((prev) => {
      const next = !prev
      soundSetMuted(next)
      return next
    })
  }, [])

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

  // In-game chat (G22) — ephemeral broadcast, global + per-team channels.
  const chat = useChat(
    game?.id ?? null,
    me?.id ?? null,
    myTeamId,
    me?.display_name ?? t('common.player'),
  )
  const [chatSeen, setChatSeen] = useState(0)
  useEffect(() => {
    if (tab === 'chat') setChatSeen(chat.messages.length)
  }, [tab, chat.messages.length])
  useEffect(() => {
    if ((!gpsEnabled || tab !== 'map') && flagAttemptPanelOpen) {
      setFlagAttemptPanelOpen(false)
    }
  }, [gpsEnabled, tab, flagAttemptPanelOpen])
  const chatUnread = tab === 'chat' ? 0 : Math.max(0, chat.messages.length - chatSeen)

  // Web Push (lock-screen alerts). First-time permission is initiated by the
  // visible opt-in button below so mobile browsers accept the request.
  const pushNotifications = usePushNotifications({
    gameId: game?.id ?? null,
    playerId: me?.id ?? null,
    enabled: game?.status === 'live' || game?.status === 'flag_found',
  })

  // Camping detection (50 m / 2 min rule). Drives the Tag button's
  // camping_locked state and the on-screen warning.
  const gameplayActive = game?.status === 'live' || game?.status === 'flag_found'
  const weatherPaused = game?.status === 'paused'
  const clockNowMs = game ? gameClockNow(game, now) : now
  const camping = useCamping({
    gameId: game?.id ?? null,
    myPlayerId: me?.id ?? null,
    myGps,
    myTeamLandmarks,
    enabled: gameplayActive || weatherPaused,
    gameplayActive,
    clockNowMs,
    wallNowMs: now,
  })

  // Walking-only gentle nudge — flags vehicle-speed movement from my GPS.
  const { speedKmh, speeding } = useWalkingSpeed(myGps)

  // Out-of-bounds warning (RULEBOOK §12.1). Derived, never stored: a boundary
  // warning is advisory, so it must not depend on server round-trips.
  const [playAreaState, setPlayAreaState] = useState<PlayAreaState | null>(null)
  useEffect(() => {
    setPlayAreaState((previous) => {
      const next =
        myGps && isPositionFresh(myGps.updated_at, now)
          ? getPlayAreaStateForGps(myGps, undefined, undefined, previous?.status ?? null)
          : null
      if (
        previous?.status === next?.status &&
        previous?.distanceM === next?.distanceM &&
        previous?.marginM === next?.marginM &&
        previous?.overshootM === next?.overshootM
      ) {
        return previous
      }
      return next
    })
  }, [myGps, now])
  const playAreaReturnTarget = useMemo(
    () =>
      myGps && playAreaState?.status === 'outside'
        ? getPlayAreaReturnPoint(myGps)
        : null,
    [myGps, playAreaState?.status],
  )
  const translatedLiveGpsError = gps.error
    ? t(
        {
          gps_permission_denied: 'gps.error_permission_denied',
          gps_unavailable: 'gps.error_unavailable',
          gps_timeout: 'gps.error_timeout',
          gps_unsupported: 'gps.error_unsupported',
        }[gps.error] ?? 'gps.error_generic',
      )
    : null

  // A short alert cue the moment camping locks the Tag button.
  const prevCampingRef = useRef(camping.status)
  useEffect(() => {
    if (camping.status === 'locked' && prevCampingRef.current !== 'locked') {
      import('@/lib/sound').then((s) => s.playCue('alert')).catch(() => {})
    }
    prevCampingRef.current = camping.status
  }, [camping.status])

  // Tag eligibility — pure derivation from GPS + presence + my own landmarks.
  const tagState = useTagButton({
    myGps,
    myPlayerId: me?.id ?? null,
    myTeamId,
    myTeamLandmarks,
    enemyTeamLandmarks: enemyLandmarks,
    presence,
    respawning: me?.respawning ?? false,
    campingLocked: camping.campingLocked,
    nowMs: now,
  })

  // Which enemy landmarks have my team confirmed (by attempting them)?
  // Drives both the map popups and the "already_discovered" disable reason
  // on the flag-attempt button.
  const discoveredEnemyKinds = useDiscoveredEnemyKinds(events, myTeamId)

  // Per-landmark 15-min lockout state (decoy/empty attempts) → grey-out +
  // countdown on the map.
  const enemyLocks = useEnemyLandmarkLocks(events, myTeamId)

  // Active challenges for the caller's team → gold star markers on the map.
  const challengeMarkers = useActiveChallenges(game?.id ?? null, game?.status ?? 'lobby', events)

  // Intel filter — derive ruled-out enemy refs from my intel cards. The
  // toggle controls whether the map dims them.
  const [intelFilterEnabled, setIntelFilterEnabled] = useState(true)
  const myIntelCards = useMemo<Card[]>(() => myCards.filter((c) => c.kind === 'intel'), [myCards])
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
    nowMs: now,
  })

  // Presence broadcast for my GPS.
  const { presence: presenceFromHook } = usePresence(
    game?.id ?? null,
    me?.id ?? null,
    myTeamId,
    myGps,
  )
  useEffect(() => {
    // Presence payloads are public Realtime data, so never trust their claimed
    // player/team identity. Reconcile them with the server snapshot before any
    // radar, tag, curse, or notification logic consumes them.
    const teamByPlayer = new Map(players.map((player) => [player.id, player.team_id]))
    const verified: typeof presenceFromHook = {}
    for (const [key, entry] of Object.entries(presenceFromHook)) {
      if (key === entry.player_id && teamByPlayer.get(entry.player_id) === entry.team_id) {
        verified[key] = entry
      }
    }
    setPresenceInStore(verified)
  }, [presenceFromHook, players, setPresenceInStore])

  // Curse expiry housekeeping — polls /expire-curses every 20 s while any
  // curses are active on our team. Idempotent on the server.
  useCurseExpiryPoll(game?.id ?? null, gameplayActive ? activeCurses.length : 0)
  useChallengeReviewResolution(game?.id ?? null, gameplayActive)

  // Time bonus: poll the idempotent /time-tick route every 30 s while the game
  // is in play; it credits +20 per elapsed 30-minute interval to both teams.
  // elapsed 30-min interval to both teams.
  useTimeTick(game?.id ?? null, gameplayActive)

  // Curse enforcement (P2-6) — Full Stop locks all actions; [A]/[B]/[L] curses
  // get live readouts / timed prompts in the banner.
  const curseEnforcement = useCurseEnforcement({
    activeCurses,
    myGps,
    myPlayerId: me?.id ?? null,
    myTeamId,
    presence,
    nowMs: clockNowMs,
    wallNowMs: now,
    gameId: game?.id ?? null,
    gameplayActive,
    t,
  })
  const { actionsLocked, lockedLabel, respawnLockedLabel } = resolveLiveActionLock({
    weatherPaused,
    weatherLabel: t('weather.actions_locked'),
    curseLocked: curseEnforcement.actionsLocked,
    curseLabel: curseEnforcement.actionsLockedLabel,
    respawning: me?.respawning ?? false,
    respawnLabel: t('respawn.gameplay_locked'),
  })

  // In-app discovery toasts (P2-5): attempt start/resolve + enemy-proximity.
  const { toasts, dismiss: dismissToast } = useGameToasts({
    events,
    myTeamId,
    myPlayerId: me?.id ?? null,
    players,
    presence,
    myTeamLandmarks,
    ready: !snapshotLoading,
    t,
  })

  // Animated "big moment" popups (capture / tag / trap) — sit above the toasts.
  const { moment, dismiss: dismissMoment } = useGameMoments({
    events,
    myTeamId,
    myPlayerId: me?.id ?? null,
    players,
    ready: !snapshotLoading,
    t,
  })

  // Placed-curse trigger (P2-2): fire a hidden enemy placement when I enter its
  // zone. Server-authoritative; silent if no trap.
  usePlacedCurseTrigger(game?.id ?? null, me?.id ?? null, myGps, enemyLandmarks, gameplayActive)

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

  // End-game chase HUD: live distance from the carrier to their home base and
  // to the nearest hunter. Self-guards via `active` so it's safe to call here.
  const carrierHome = useMemo<{ lat: number; lng: number } | null>(() => {
    const ref = flagCarrierTeam?.home_landmark_id
    const seed = ref ? getSeedLandmarkByRef(ref) : null
    return seed ? { lat: seed.lat, lng: seed.lng } : null
  }, [flagCarrierTeam])
  const chaseStatus = useChaseStatus({
    active: game?.status === 'flag_found',
    carrierPos: flagCarrier ? (presence[flagCarrier.id] ?? null) : null,
    carrierHome,
    carrierTeamId: flagCarrierTeam?.id ?? null,
    presence,
  })
  const iAmOnCarrierTeam =
    flagCarrierTeam != null && myTeam != null && myTeam.id === flagCarrierTeam.id

  const endsAtMs = useMemo<number | null>(() => {
    if (!game?.started_at) return null
    const minutes = game.config?.duration_minutes ?? DEFAULT_DURATION_MIN
    return new Date(game.started_at).getTime() + minutes * 60_000
  }, [game?.started_at, game?.config?.duration_minutes])

  // 30-min flag-attempt protection window (P2-3). Server-derived from
  // started_at so it survives refresh / late join.
  const attemptsUnlockAtMs = useMemo<number | null>(() => {
    if (!game?.started_at) return null
    return new Date(game.started_at).getTime() + PROTECTION_WINDOW_MS
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
    apiPost<EndByTimeoutResponse>(`/api/games/${game.id}/end-by-timeout`, {
      device_id: getDeviceId(),
    })
      .then((result) => {
        // Realtime can miss the terminal games-row update when a player opens
        // the page at the exact timeout boundary. The idempotent API response
        // is authoritative, so apply it immediately instead of leaving that
        // client in a stale live phase until a reload.
        setGame(result.game)
      })
      .catch(() => {
        // Reset so a later tick can retry (network blips, etc.).
        timeoutSubmittedRef.current = false
      })
  }, [game?.id, game?.status, endsAtMs, now, setGame])

  const toggleGps = useCallback(() => {
    setGpsEnabled((v) => !v)
  }, [])

  const issueMapCommand = useCallback((type: 'fit' | 'recenter') => {
    setMapCommand((previous) => ({
      type,
      requestId: (previous?.requestId ?? 0) + 1,
    }))
    setTab('map')
    setSettingsOpen(false)
  }, [])

  if (!game || !me) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-950 text-sm text-neutral-400">
        {t('live.loading_live')}
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
        <h1 className="text-2xl font-semibold">{t('live.title')}</h1>
        <div className="rounded-md border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-200">
          {t('live.load_error')}
        </div>
        <p className="text-xs text-neutral-500">
          {t('common.game')} {game.code}
        </p>
      </main>
    )
  }

  const sideLabel = myTeam.side === 'east' ? t('common.east') : t('common.west')
  const sideColorClass = myTeam.side === 'east' ? 'text-pink-300' : 'text-blue-300'

  const iAmFlagCarrier = Boolean(flagCarrier && flagCarrier.id === me.id)
  const isFlagFound = game.status === 'flag_found'
  const weatherConfirmationNeeded = weatherProposalNeedsConfirmation(game, myTeam.id, now)
  const isGameOver = game.status === 'finished'

  // 30-min flag-attempt protection window: lock the Attempt button and show a
  // header countdown while the window is open.
  const withinProtection = attemptsUnlockAtMs != null && clockNowMs < attemptsUnlockAtMs
  const flagAttemptLockedLabel = actionsLocked
    ? lockedLabel
    : withinProtection
      ? t('attempt.locked_window', { time: mmss(attemptsUnlockAtMs! - clockNowMs) })
      : null

  return (
    <main className="relative flex h-dvh min-h-0 flex-col overflow-hidden bg-neutral-950 text-neutral-100">
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
          <span
            className={cn('tabular-nums', myTeam.coins < 0 && 'font-semibold text-red-300')}
          >
            {myTeam.coins} {t('common.coins')}
          </span>
          <Countdown endsAtMs={endsAtMs} nowMs={clockNowMs} />
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label={t('settings.open')}
            title={t('settings.open')}
            className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-base leading-none text-neutral-200 hover:bg-neutral-800"
          >
            ⚙
          </button>
        </div>
      </header>

      {settingsOpen && (
        <LiveSettingsMenu
          game={game}
          myPlayerId={me.id}
          myTeam={myTeam}
          nowMs={now}
          onGameUpdate={setGame}
          notificationStatus={pushNotifications.status}
          enableNotifications={pushNotifications.enable}
          muted={muted}
          onToggleMute={toggleMute}
          gpsEnabled={gpsEnabled}
          onToggleGps={toggleGps}
          gpsPosition={gps.position}
          gpsError={gps.error}
          intelFilterEnabled={intelFilterEnabled}
          narrowedCount={narrowedOutRefs?.size ?? 0}
          onToggleIntelFilter={() => setIntelFilterEnabled((value) => !value)}
          onMapCommand={issueMapCommand}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* A pending vote is gameplay state, not a hidden preference. Keep the
          request action in Settings, but surface the other team's live vote
          prominently so it can actually be confirmed before it expires. */}
      {weatherConfirmationNeeded && !settingsOpen && (
        <WeatherPausePanel
          game={game}
          myPlayerId={me.id}
          myTeam={myTeam}
          nowMs={now}
          onGameUpdate={setGame}
        />
      )}

      {weatherPaused && (
        <div className="border-b border-sky-700 bg-sky-950/80 px-4 py-2 text-center text-xs font-semibold text-sky-100">
          {t('weather.paused_title')}
        </div>
      )}

      {/* Banners — flag carrier banner takes priority over the generic
          "flag found" banner so the carrier always sees their own
          run-home UI. */}
      {isFlagFound && iAmFlagCarrier && (
        <FlagCarrierBanner
          gameId={game.id}
          myPlayerId={me.id}
          myTeam={myTeam}
          myGps={myGps}
          lockedLabel={lockedLabel}
        />
      )}
      {isFlagFound && !iAmFlagCarrier && flagCarrier && (
        <FlagFoundBanner carrier={flagCarrier} carrierTeam={flagCarrierTeam} myTeam={myTeam} />
      )}

      {/* Cinematic chase HUD — live distance-to-home + nearest hunter for both
          teams during the run-home phase. */}
      {isFlagFound && <ChaseHud status={chaseStatus} iAmOnCarrierTeam={iAmOnCarrierTeam} t={t} />}

      {/* Flag-attempt protection window countdown (first 30 min). */}
      {withinProtection && !isGameOver && (
        <div className="border-b border-sky-800/60 bg-sky-950/40 px-4 py-1.5 text-center text-[11px] font-medium text-sky-200">
          🔒 {t('attempt.window_header', { time: mmss(attemptsUnlockAtMs! - clockNowMs) })}
        </div>
      )}

      {/* Next +20 time-bonus countdown strip. */}
      {!isGameOver && !withinProtection && (
        <TimeBonusBanner
          startedAt={game.started_at}
          nowMs={clockNowMs}
          durationMinutes={game.config?.duration_minutes ?? 180}
          t={t}
        />
      )}

      {/* Active curses banner — sits below carrier/flag-found banners so the
          most game-critical state stays on top, and above the respawn banner. */}
      <ActiveCursesBanner
        activeCurses={activeCurses}
        nowMs={clockNowMs}
        actionsLocked={actionsLocked}
        actionsLockedLabel={lockedLabel}
        byCurseId={curseEnforcement.byCurseId}
        gameId={game.id}
        myPlayerId={me.id}
        proofReceipts={myCurseProofs}
        onProofSubmitted={addCurseProof}
      />

      {/* Camping banner (P8). Both the 90 s warning and the 120 s lock are
          counted server-side, so the countdowns here are correct immediately
          after a reload rather than restarting from zero. It used to live inside
          the map tab only, which meant a defender sitting on the actions or
          status tab got no warning at all and then found Tag dead. */}
      {!isGameOver && camping.status !== 'idle' && (
        <div
          role="alert"
          className={cn(
            'border-b px-4 py-2 text-xs font-medium',
            camping.status === 'locked'
              ? 'border-red-700 bg-red-900/50 text-red-100'
              : 'border-amber-700 bg-amber-900/40 text-amber-100',
          )}
        >
          {camping.status === 'locked'
            ? camping.secondsUntilUnlock == null || camping.secondsUntilUnlock <= 0
              ? t('camping.locked', { s: camping.cooldownThresholdSeconds })
              : t('camping.locked_progress', { s: camping.secondsUntilUnlock })
            : camping.secondsUntilLock <= 0
              ? t('camping.warning_imminent')
              : t('camping.warning', { s: camping.secondsUntilLock })}
        </div>
      )}

      {/* Respawn banner — shows above tabs whenever the local player is
          respawning. Visible from any tab so the player can't miss it. */}
      <RespawnBanner
        gameId={game.id}
        myPlayerId={me.id}
        myGps={myGps}
        respawning={me.respawning}
        respawnTargetRef={me.respawn_target_ref}
        respawnArrived={me.respawn_arrived}
        lockedLabel={respawnLockedLabel}
        onPlayerUpdate={upsertPlayer}
      />

      {/* Tab content */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
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
              mapCommand={mapCommand}
              myIntelCards={myIntelCards}
              myTeamHomeLng={myTeamHomeLng}
              attemptsLocked={withinProtection}
              enemyLocks={enemyLocks}
              nowMs={clockNowMs}
              wallNowMs={now}
              boundaryState={playAreaState}
              challenges={challengeMarkers}
            />
            {/* Context rail: a compact approach/defense cue most of the time,
                expanding only when a flag attempt is actually usable. Tag is
                global below because it must work from every tab. */}
            <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[1000] flex flex-col items-center gap-2 px-4">
              {!gpsEnabled ? (
                <button
                  type="button"
                  onClick={toggleGps}
                  className="pointer-events-auto rounded-full border border-cyan-400/50 bg-neutral-950/95 px-5 py-3 text-sm font-semibold text-cyan-100 shadow-xl backdrop-blur"
                >
                  ◎ {t('live.enable_gps')}
                </button>
              ) : gps.error ? (
                <div
                  role="alert"
                  className="rounded-full border border-amber-700 bg-neutral-950/90 px-4 py-2 text-xs text-amber-100 shadow-lg backdrop-blur"
                >
                  {t('settings.gps_error', {
                    error: translatedLiveGpsError ?? t('gps.error_generic'),
                  })}
                </div>
              ) : !myGps ? (
                <div
                  role="status"
                  className="rounded-full border border-neutral-700 bg-neutral-950/90 px-4 py-2 text-xs text-neutral-300 shadow-lg backdrop-blur"
                >
                  {t('settings.gps_acquiring')}
                </div>
              ) : !isPositionFresh(myGps.updated_at, now) || !playAreaState ? (
                <div
                  role="status"
                  className="rounded-full border border-neutral-700 bg-neutral-950/90 px-4 py-2 text-xs text-neutral-300 shadow-lg backdrop-blur"
                >
                  {t('settings.gps_updating')}
                </div>
              ) : (
                <>
                  {flagAttemptPanelOpen || (!tagState.enabled && flagAttemptState.visible) ? (
                    <FlagAttemptButton
                      gameId={game.id}
                      myPlayerId={me.id}
                      myGpsPos={myGps}
                      meState={flagAttemptState}
                      lockedLabel={flagAttemptLockedLabel}
                      onPanelOpenChange={setFlagAttemptPanelOpen}
                    />
                  ) : gameplayActive && !tagState.enabled && tagState.visible ? (
                    <div className="rounded-full border border-blue-400/30 bg-neutral-950/80 px-3 py-1.5 text-[11px] font-medium text-blue-100 shadow-md backdrop-blur">
                      ◉ {t('tag.zone_ready')}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        )}

        {tab === 'actions' && (
          <ActionsTab
            gameId={game.id}
            myPlayerId={me.id}
            myTeamId={myTeam.id}
            gameStatus={game.status}
            coins={myTeam.coins}
            sideLabel={sideLabel}
            myCards={myCards}
            myGps={myGps}
            respawning={me.respawning}
            actionsLocked={actionsLocked}
            myTeamLandmarks={myTeamLandmarks}
            placedCurses={myPlacedCurses}
            pendingChallengeReviews={pendingChallengeReviews}
            events={events}
            enemyTeamSize={players.filter((player) => player.team_id === enemyTeam.id).length}
            onIntelPurchased={(purchase) => {
              upsertCard(purchase.card)
              upsertTeam({ ...myTeam, coins: purchase.team_coins })
            }}
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
            myGps={myGps}
            events={events}
            players={players}
            nowMs={clockNowMs}
            actionsLocked={actionsLocked}
          />
        )}

        {tab === 'chat' && (
          <ChatPanel
            messages={chat.messages}
            send={chat.send}
            connected={chat.connected}
            myPlayerId={me.id}
            teamColorClass={sideColorClass}
            actionsLocked={actionsLocked}
            lockedReason={lockedLabel}
          />
        )}
      </div>

      {/* Tag is a reflex action, so when a valid raider is within 5 m it must
          be reachable from Actions, Status and Chat as well as the map. */}
      {gameplayActive && tagState.enabled && !flagAttemptPanelOpen && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[calc(3.25rem+env(safe-area-inset-bottom))] z-[1100] flex justify-center px-4">
          <TagButton
            gameId={game.id}
            myPlayerId={me.id}
            myGpsPos={myGps}
            meState={tagState}
            lockedLabel={lockedLabel}
          />
        </div>
      )}

      {/* Bottom tab bar */}
      <nav className="grid shrink-0 grid-cols-4 border-t border-neutral-800 bg-neutral-950 pb-[max(env(safe-area-inset-bottom),0px)]">
        <TabButton label={t('live.tab_map')} active={tab === 'map'} onClick={() => setTab('map')} />
        <TabButton
          label={t('live.tab_actions')}
          active={tab === 'actions'}
          onClick={() => setTab('actions')}
        />
        <TabButton
          label={t('live.tab_status')}
          active={tab === 'status'}
          onClick={() => setTab('status')}
        />
        <TabButton
          label={t('chat.tab')}
          active={tab === 'chat'}
          onClick={() => setTab('chat')}
          badge={chatUnread}
        />
      </nav>

      {/* In-app discovery toasts (top-center, foregrounded only). */}
      <ToastLayer toasts={toasts} onDismiss={dismissToast} />

      <MomentOverlay moment={moment} onDismiss={dismissMoment} />

      {/* Walking-only gentle nudge (top-center, over the map). */}
      <WalkingNudge speeding={gameplayActive && speeding} speedKmh={speedKmh} t={t} />

      {/* Out-of-bounds warning, just below the walking nudge (RULEBOOK §12.1). */}
      <BoundaryNudge
        state={gameplayActive ? playAreaState : null}
        returnTarget={gameplayActive ? playAreaReturnTarget : null}
      />

      {/* Game-over screen — fixed/full-screen, sits over everything else. */}
      {isGameOver && (
        <GameOverOverlay
          gameId={game.id}
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

function LiveSettingsMenu({
  game,
  myPlayerId,
  myTeam,
  nowMs,
  onGameUpdate,
  notificationStatus,
  enableNotifications,
  muted,
  onToggleMute,
  gpsEnabled,
  onToggleGps,
  gpsPosition,
  gpsError,
  intelFilterEnabled,
  narrowedCount,
  onToggleIntelFilter,
  onMapCommand,
  onClose,
}: {
  game: Game
  myPlayerId: string
  myTeam: Team
  nowMs: number
  onGameUpdate: (game: Game) => void
  notificationStatus: PushNotificationStatus
  enableNotifications: () => void
  muted: boolean
  onToggleMute: () => void
  gpsEnabled: boolean
  onToggleGps: () => void
  gpsPosition: GpsPosition | null
  gpsError: string | null
  intelFilterEnabled: boolean
  narrowedCount: number
  onToggleIntelFilter: () => void
  onMapCommand: (type: 'fit' | 'recenter') => void
  onClose: () => void
}) {
  const t = useT()
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeButtonRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const translatedGpsError = gpsError
    ? t(
        {
          gps_permission_denied: 'gps.error_permission_denied',
          gps_unavailable: 'gps.error_unavailable',
          gps_timeout: 'gps.error_timeout',
          gps_unsupported: 'gps.error_unsupported',
        }[gpsError] ?? 'gps.error_generic',
      )
    : null

  const gpsStatus = gpsEnabled
    ? gpsError
      ? t('settings.gps_error', { error: translatedGpsError ?? t('gps.error_generic') })
      : !gpsPosition
        ? t('settings.gps_acquiring')
        : isPositionFresh(gpsPosition.updated_at, nowMs) &&
            getPlayAreaStateForGps(gpsPosition) !== null
          ? t('settings.gps_accuracy', { m: Math.round(gpsPosition.accuracy) })
          : t('settings.gps_updating')
    : t('live.gps_off')

  const usableGpsPosition =
    gpsPosition &&
    isPositionFresh(gpsPosition.updated_at, nowMs) &&
    getPlayAreaStateForGps(gpsPosition) !== null
      ? gpsPosition
      : null

  return (
    <div
      className="fixed inset-0 z-[3000] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="live-settings-title"
        className="flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-neutral-700 bg-neutral-950 shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
          <h2 id="live-settings-title" className="text-lg font-semibold text-neutral-100">
            {t('settings.title')}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            {t('settings.preferences')}
          </h3>
          <div className="mt-2 divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-neutral-900/50">
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <span className="text-sm text-neutral-200">{t('settings.language')}</span>
              <LanguageSwitcher />
            </div>
            <SettingsToggleRow
              label={t('settings.sound')}
              value={!muted}
              onToggle={onToggleMute}
              onLabel={t('sound.mute')}
              offLabel={t('sound.unmute')}
            />
            <NotificationOptIn status={notificationStatus} enable={enableNotifications} />
          </div>

          <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
            {t('settings.map')}
          </h3>
          <div className="mt-2 divide-y divide-neutral-800 rounded-xl border border-neutral-800 bg-neutral-900/50">
            <SettingsToggleRow
              label={t('settings.gps')}
              description={gpsStatus}
              value={gpsEnabled}
              onToggle={onToggleGps}
              onLabel={t('live.disable_gps')}
              offLabel={t('live.enable_gps')}
            />
            <SettingsToggleRow
              label={t('settings.intel_filter')}
              description={
                narrowedCount > 0
                  ? t('settings.intel_filter_hint')
                  : t('settings.intel_filter_unavailable')
              }
              value={intelFilterEnabled}
              onToggle={onToggleIntelFilter}
              onLabel={t('map.intel_filter_on', { n: narrowedCount })}
              offLabel={t('map.intel_filter_off')}
            />
            <div className="grid grid-cols-2 gap-2 p-3">
              <button
                type="button"
                onClick={() => onMapCommand('fit')}
                className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-xs font-medium text-neutral-100 hover:border-neutral-600 hover:bg-neutral-900"
              >
                {t('map.fit_vila_real')}
              </button>
              <button
                type="button"
                onClick={() => onMapCommand('recenter')}
                disabled={!usableGpsPosition}
                className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2.5 text-xs font-medium text-neutral-100 hover:border-neutral-600 hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {usableGpsPosition && getMapDisplayPosition(usableGpsPosition).isClamped
                  ? t('map.show_return_edge')
                  : t('map.recenter_on_me')}
              </button>
            </div>
          </div>

          {/* The guide is most wanted mid-game, when a rule is in dispute. It
              opens in a new tab so an argument never costs anyone their live
              game state. */}
          <a
            href="/guide"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-sky-900 bg-sky-950/40 px-4 py-3 transition hover:border-sky-700 hover:bg-sky-900/40"
          >
            <span className="text-sm font-medium text-sky-100">{t('landing.player_guide')}</span>
            <span aria-hidden="true" className="text-sky-400">
              ↗
            </span>
          </a>

          <div className="mt-5 overflow-hidden rounded-xl border border-neutral-800">
            <WeatherPausePanel
              game={game}
              myPlayerId={myPlayerId}
              myTeam={myTeam}
              nowMs={nowMs}
              onGameUpdate={onGameUpdate}
              embedded
            />
          </div>
        </div>
      </section>
    </div>
  )
}

function SettingsToggleRow({
  label,
  description,
  value,
  onToggle,
  onLabel,
  offLabel,
}: {
  label: string
  description?: string
  value: boolean
  onToggle: () => void
  onLabel: string
  offLabel: string
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm text-neutral-200">{label}</p>
        {description && <p className="mt-0.5 text-[11px] text-neutral-500">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={value ? onLabel : offLabel}
        title={value ? onLabel : offLabel}
        onClick={onToggle}
        className={cn(
          'relative h-7 w-12 shrink-0 rounded-full border transition',
          value ? 'border-emerald-400 bg-emerald-500/80' : 'border-neutral-700 bg-neutral-800',
        )}
      >
        <span
          className={cn(
            'absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform',
            value ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </button>
    </div>
  )
}

function NotificationOptIn({
  status,
  enable,
}: {
  status: PushNotificationStatus
  enable: () => void
}) {
  const t = useT()
  if (status === 'enabled') {
    return (
      <div className="px-4 py-3 text-sm text-neutral-200">
        <p>{t('settings.notifications')}</p>
        <p className="mt-0.5 text-[11px] text-emerald-300">{t('settings.notifications_on')}</p>
      </div>
    )
  }
  if (status === 'unsupported' || status === 'unconfigured') {
    return (
      <div className="px-4 py-3 text-sm text-neutral-200">
        <p>{t('settings.notifications')}</p>
        <p className="mt-0.5 text-[11px] text-neutral-500">
          {t('settings.notifications_unavailable')}
        </p>
      </div>
    )
  }
  if (status === 'denied') {
    return (
      <div className="px-4 py-3 text-sm text-neutral-200">
        <p>{t('settings.notifications')}</p>
        <p role="alert" className="mt-0.5 text-[11px] text-amber-300">
          {t('push.denied')}
        </p>
      </div>
    )
  }
  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-neutral-200"
      role="status"
      aria-live="polite"
    >
      <div>
        <p>{t('settings.notifications')}</p>
        {status === 'error' && <p className="mt-0.5 text-[11px] text-red-300">{t('push.error')}</p>}
      </div>
      <button
        type="button"
        onClick={enable}
        disabled={status === 'enabling'}
        aria-busy={status === 'enabling'}
        className="shrink-0 rounded-md bg-sky-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
      >
        {status === 'enabling' ? t('push.enabling') : t('push.enable')}
      </button>
    </div>
  )
}

function TabButton({
  label,
  active,
  onClick,
  badge = 0,
}: {
  label: string
  active: boolean
  onClick: () => void
  badge?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'relative px-3 py-3 text-center text-sm font-medium transition',
        active
          ? 'bg-neutral-900 text-neutral-100'
          : 'text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200',
      )}
    >
      {label}
      {badge > 0 && (
        <span className="absolute right-2 top-1.5 min-w-[16px] rounded-full bg-emerald-500 px-1 text-[10px] font-bold leading-4 text-neutral-950">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  )
}

function Countdown({ endsAtMs, nowMs }: { endsAtMs: number | null; nowMs: number }) {
  if (!endsAtMs) return <span className="text-neutral-500">--:--</span>
  const remainingMs = Math.max(0, endsAtMs - nowMs)
  const h = Math.floor(remainingMs / 3_600_000)
  const m = Math.floor((remainingMs % 3_600_000) / 60_000)
  const s = Math.floor((remainingMs % 60_000) / 1000)
  const text = h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`
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

function LiveMapLoading() {
  const t = useT()
  return (
    <div className="flex h-full w-full items-center justify-center bg-neutral-950 text-sm text-neutral-500">
      {t('common.loading')}
    </div>
  )
}

function mmss(remainingMs: number): string {
  const rem = Math.max(0, remainingMs)
  const m = Math.floor(rem / 60_000)
  const s = Math.floor((rem % 60_000) / 1000)
  return `${m}:${pad2(s)}`
}

function ActionsTab({
  gameId,
  myPlayerId,
  myTeamId,
  gameStatus,
  coins,
  sideLabel,
  myCards,
  myGps,
  respawning,
  actionsLocked,
  myTeamLandmarks,
  placedCurses,
  pendingChallengeReviews,
  events,
  enemyTeamSize,
  onIntelPurchased,
}: {
  gameId: string
  myPlayerId: string
  myTeamId: string
  gameStatus: import('@/lib/types').GameStatus
  coins: number
  sideLabel: string
  myCards: Card[]
  myGps: import('@/lib/types').GpsPosition | null
  respawning: boolean
  actionsLocked: boolean
  myTeamLandmarks: import('@/lib/types').Landmark[]
  placedCurses: import('@/lib/types').PlacedCurse[]
  pendingChallengeReviews: Card[]
  events: GameEvent[]
  enemyTeamSize: number
  onIntelPurchased: (purchase: import('@/lib/types').BuyIntelResponse) => void
}) {
  const t = useT()
  const myIntelCards = myCards.filter((c) => c.kind === 'intel')
  return (
    <section className="mx-auto flex h-full max-w-2xl flex-col gap-4 overflow-y-auto px-6 py-6">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
        <p className="text-xs uppercase tracking-wider text-neutral-500">
          {t('status.team_balance', { side: sideLabel })}
        </p>
        <p
          className={cn('mt-1 text-3xl font-semibold tabular-nums', coins < 0 && 'text-red-300')}
        >
          {coins}
        </p>
        <p className="text-xs text-neutral-500">{t('common.coins')}</p>
        {coins < 0 && <p className="mt-2 text-xs text-red-300">{t('status.coins_debt')}</p>}
      </div>

      <IntelPurchasePanel
        gameId={gameId}
        myPlayerId={myPlayerId}
        gameStatus={gameStatus}
        teamCoins={coins}
        myIntelCards={myIntelCards}
        myGps={myGps}
        actionsLocked={actionsLocked}
        onPurchased={onIntelPurchased}
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
        targetTeamSize={enemyTeamSize}
      />

      <ChallengesPanel
        gameId={gameId}
        gameStatus={gameStatus}
        myPlayerId={myPlayerId}
        myTeamId={myTeamId}
        myGps={myGps}
        respawning={respawning}
        actionsLocked={actionsLocked}
        events={events}
      />

      <ChallengeReviewPanel
        gameId={gameId}
        myPlayerId={myPlayerId}
        myTeamId={myTeamId}
        events={events}
        pendingReviews={pendingChallengeReviews}
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
  myGps,
  events,
  players,
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
  myGps: import('@/lib/types').GpsPosition | null
  events: GameEvent[]
  players: Player[]
  nowMs: number
  actionsLocked: boolean
}) {
  const { t, locale } = useI18n()
  const challengeProofs = useMemo(() => buildChallengeProofIndex(events), [events])
  return (
    <section className="mx-auto flex h-full max-w-2xl flex-col gap-4 overflow-y-auto px-6 py-6">
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-5">
        <p className="text-xs uppercase tracking-wider text-neutral-500">
          {t('common.team')} {t(myTeam.side === 'east' ? 'common.east' : 'common.west')}
        </p>
        <p
          className={cn(
            'mt-1 text-3xl font-semibold tabular-nums',
            myTeam.coins < 0 && 'text-red-300',
          )}
        >
          {myTeam.coins}
        </p>
        <p className="text-xs text-neutral-500">{t('common.coins')}</p>
        {myTeam.coins < 0 && (
          <p className="mt-2 text-xs text-red-300">{t('status.coins_debt')}</p>
        )}
      </div>

      <HardenFlagButton
        gameId={gameId}
        myPlayerId={myPlayerId}
        gameStatus={gameStatus}
        myTeamLandmarks={myTeamLandmarks}
        teamCoins={myTeam.coins}
        actionsLocked={actionsLocked}
      />

      {/* P7 second exit: the host can release a player whose GPS will not
          confirm. Self-hiding — renders nothing unless the viewer is the host
          and someone is actually respawning. */}
      <HostRespawnOverride
        gameId={gameId}
        myPlayerId={myPlayerId}
        isHost={players.find((p) => p.id === myPlayerId)?.is_host ?? false}
        players={players}
      />

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
        <h2 className="text-sm font-medium text-neutral-100">{t('status.curses_on_us')}</h2>
        {activeCurses.length === 0 ? (
          <p className="mt-2 text-xs text-neutral-500">{t('status.none')}</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1.5">
            {activeCurses.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 rounded border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs"
              >
                <span className="text-neutral-200">
                  {localizeCatalogField(
                    c.curse_ref,
                    'name',
                    CURSE_NAMES.get(c.curse_ref) ?? c.curse_ref,
                    locale,
                  )}
                </span>
                <span className="text-neutral-400">
                  {c.expires_at
                    ? formatTimeRemaining(new Date(c.expires_at).getTime(), nowMs, t)
                    : t('curse.no_timer')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <IntelCardDisplay myCards={myCards} myGps={myGps} />

      <CurseHistoryList events={events} myTeamId={myTeam.id} />

      <ChallengeHistoryList events={events} myTeamId={myTeam.id} />

      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
        <h2 className="text-sm font-medium text-neutral-100">{t('status.timeline_short')}</h2>
        {events.length === 0 ? (
          <p className="mt-2 text-xs text-neutral-500">{t('status.timeline_empty')}</p>
        ) : (
          <ol className="mt-2 flex flex-col gap-1">
            {events.map((e) => {
              const proofUrl = challengeProofUrl(e, challengeProofs)
              return (
                <li
                  key={e.id}
                  className="flex items-baseline gap-2 rounded px-2 py-1 text-xs odd:bg-neutral-900/40"
                >
                  <span className="font-mono text-[10px] text-neutral-500">
                    {formatClock(e.created_at)}
                  </span>
                  <span className="font-medium text-neutral-200">
                    {eventTypeLabel(e, locale)}
                  </span>
                  <span className="text-neutral-400">
                    {summariseEvent(e, players, t)}
                    {proofUrl && (
                      <a
                        href={proofUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-2 text-sky-300 underline"
                      >
                        {t('challenge.view_photo')}
                      </a>
                    )}
                  </span>
                </li>
              )
            })}
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

function formatTimeRemaining(
  endsMs: number,
  nowMs: number,
  t: (key: string, tokens?: Record<string, string | number>) => string,
): string {
  const rem = Math.max(0, endsMs - nowMs)
  if (rem === 0) return t('common.expired')
  const m = Math.floor(rem / 60_000)
  const s = Math.floor((rem % 60_000) / 1000)
  return `${m}m ${pad2(s)}s`
}

function summariseEvent(
  e: GameEvent,
  players: Player[],
  t: (key: string, tokens?: Record<string, string | number>) => string,
): string {
  const actor = e.actor_player_id
    ? (players.find((p) => p.id === e.actor_player_id)?.display_name ?? t('status.someone'))
    : t('status.system')
  return t('status.event_by', { actor })
}

function eventTypeLabel(event: GameEvent, locale: Locale): string {
  const { type, payload } = event
  if (type === 'coins_deducted' && payload.reason === 'decoy_penalty') {
    const amount = typeof payload.amount === 'number' ? ` (−${payload.amount})` : ''
    return `${locale === 'pt' ? 'Multa por engano' : 'Decoy fine'}${amount}`
  }
  const labelsPt: Record<string, string> = {
    player_joined: 'Jogador entrou',
    player_left: 'Jogador saiu',
    player_ready: 'Jogador pronto',
    game_started: 'Preparação iniciada',
    game_live: 'Jogo iniciado',
    game_paused: 'Jogo em pausa',
    game_resumed: 'Jogo retomado',
    game_won: 'Jogo ganho',
    game_ended_by_timeout: 'Jogo terminado por tempo',
    flags_assigned: 'Bandeiras atribuídas',
    challenge_completed: 'Desafio concluído',
    challenge_submitted: 'Desafio submetido',
    challenge_rejected: 'Desafio rejeitado',
    challenge_auto_accepted: 'Desafio aceite automaticamente',
    curse_cast: 'Maldição lançada',
    curse_expired: 'Maldição terminada',
    curse_completed: 'Maldição concluída',
    curse_roll_failed: 'Lançamento de maldição falhou',
    curse_proof_submitted: 'Prova de maldição submetida',
    flag_attempt_started: 'Tentativa de bandeira iniciada',
    flag_attempt: 'Tentativa de bandeira',
    flag_found: 'Bandeira encontrada',
    game_finished: 'Jogo terminado',
    intel_bought: 'Carta de intel comprada',
    intel_purchased: 'Carta de intel comprada',
    intel_lost: 'Carta de intel perdida',
    coin_drain: 'Dreno de moedas',
    coins_deducted: 'Moedas gastas',
    coins_credited: 'Moedas recebidas',
    tag: 'Jogador apanhado',
    player_respawning_set: 'Regresso ao jogo iniciado',
    player_respawn_arrived: 'Ponto de regresso alcançado',
    player_respawning_cleared: 'Regresso ao jogo concluído',
    // Migrations 0053/0055 emit these three; without a label here PT fell
    // through to raw English and EN read as title-cased snake_case.
    player_respawn_timed_out: 'Regresso automático ao jogo (10 min)',
    player_respawn_host_cleared: 'Regresso autorizado pelo anfitrião',
    flag_carrier_stripped: 'Bandeira perdida na captura',
    placed_curse_armed: 'Armadilha preparada',
    placed_curse_triggered: 'Armadilha ativada',
    flag_hardened: 'Bandeira reforçada',
    time_bonus_awarded: 'Bónus de tempo atribuído',
    time_bonus: 'Bónus de tempo atribuído',
  }
  const labelsEn: Record<string, string> = {
    player_respawn_timed_out: 'Respawn timed out (10 min)',
    player_respawn_host_cleared: 'Respawn released by host',
    flag_carrier_stripped: 'Flag dropped on tag',
  }
  if (locale === 'pt' && labelsPt[type]) return labelsPt[type]
  if (labelsEn[type]) return labelsEn[type]
  return type
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
