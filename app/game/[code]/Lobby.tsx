'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher'
import { ConfirmActionModal } from '@/components/game/ConfirmActionModal'
import { useT } from '@/lib/i18n/context'
import { apiPost } from '@/lib/api'
import { getDeviceId } from '@/lib/device'
import { useGameStore } from '@/store/gameStore'
import { useLobbyRealtime } from '@/lib/hooks/useLobbyRealtime'
import { Setup } from './Setup'
import { Live } from './Live'
import type {
  GameByCodeResponse,
  Player,
  RemovePlayerRequest,
  RemovePlayerResponse,
  SetReadyRequest,
  SetReadyResponse,
  StartGameRequest,
  StartGameResponse,
  SwitchTeamRequest,
  SwitchTeamResponse,
  Team,
} from '@/lib/types'

interface LobbyProps {
  initial: GameByCodeResponse
  code: string
}

export function Lobby({ initial, code }: LobbyProps) {
  const router = useRouter()
  const t = useT()
  const setSnapshot = useGameStore((s) => s.setSnapshot)
  const setMe = useGameStore((s) => s.setMe)
  const setGame = useGameStore((s) => s.setGame)
  const game = useGameStore((s) => s.game)
  const teams = useGameStore((s) => s.teams)
  const players = useGameStore((s) => s.players)
  const me = useGameStore((s) => s.me)
  const isHydrated = useGameStore((s) => s.isHydrated)

  const [error, setError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [confirmRemoval, setConfirmRemoval] = useState<{
    targetId: string
    name: string
    isSelf: boolean
  } | null>(null)

  // Initial hydration: identify "me" by device_id from the snapshot.
  useEffect(() => {
    const deviceId = getDeviceId()
    const myPlayer = deviceId
      ? (initial.players.find((p) => p.device_id === deviceId) ?? null)
      : null
    setSnapshot({ ...initial, me: myPlayer })
    // Only on mount or when the lobby code changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.game.id])

  // Re-resolve `me` if players list changes (e.g. server returned a new id).
  useEffect(() => {
    if (!isHydrated) return
    const deviceId = getDeviceId()
    if (!deviceId) return
    const current = players.find((p) => p.device_id === deviceId) ?? null
    // Compare by id to avoid setting state when nothing changed.
    if ((current?.id ?? null) !== (me?.id ?? null)) {
      setMe(current)
    }
  }, [players, me, isHydrated, setMe])

  const phaseRecoveryActive = game == null || game.status === 'lobby' || game.status === 'setup'
  useLobbyRealtime(phaseRecoveryActive ? initial.game.id : null, phaseRecoveryActive ? code : null)

  const teamsBySide = useMemo(() => {
    const west = teams.find((t) => t.side === 'west') ?? null
    const east = teams.find((t) => t.side === 'east') ?? null
    return { west, east }
  }, [teams])

  const playersByTeam = useMemo(() => {
    const grouped = new Map<string, Player[]>()
    for (const p of players) {
      const list = grouped.get(p.team_id) ?? []
      list.push(p)
      grouped.set(p.team_id, list)
    }
    for (const list of grouped.values()) {
      list.sort((a, b) => a.created_at.localeCompare(b.created_at))
    }
    return grouped
  }, [players])

  const allReady = useMemo(() => {
    if (players.length === 0) return false
    return players.every((p) => p.ready)
  }, [players])

  const teamCounts = useMemo(() => {
    const west = teamsBySide.west
    const east = teamsBySide.east
    return {
      west: west ? (playersByTeam.get(west.id)?.length ?? 0) : 0,
      east: east ? (playersByTeam.get(east.id)?.length ?? 0) : 0,
    }
  }, [teamsBySide, playersByTeam])
  const validTeamSizes =
    teamCounts.west === teamCounts.east && teamCounts.west >= 1 && teamCounts.west <= 4
  const mySide = teams.find((tm) => tm.id === me?.team_id)?.side
  const otherTeamFull =
    mySide === 'west' ? teamCounts.east >= 4 : mySide === 'east' ? teamCounts.west >= 4 : false

  const canStart = allReady && validTeamSizes && game?.status === 'lobby'

  async function toggleReady() {
    if (!me || !game) return
    setError(null)
    setPendingAction('ready')
    try {
      const body: SetReadyRequest = {
        player_id: me.id,
        device_id: getDeviceId(),
        ready: !me.ready,
      }
      await apiPost<SetReadyResponse>(`/api/games/${game.id}/ready`, body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown_error')
    } finally {
      setPendingAction(null)
    }
  }

  async function switchTeam() {
    if (!me || !game) return
    setError(null)
    setPendingAction('switch')
    try {
      const body: SwitchTeamRequest = {
        player_id: me.id,
        device_id: getDeviceId(),
      }
      await apiPost<SwitchTeamResponse>(`/api/games/${game.id}/switch-team`, body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown_error')
    } finally {
      setPendingAction(null)
    }
  }

  async function startGame() {
    if (!game) return
    setError(null)
    setPendingAction('start')
    try {
      const body: StartGameRequest = { device_id: getDeviceId() }
      const result = await apiPost<StartGameResponse>(`/api/games/${game.id}/start`, body)
      // Apply the authoritative mutation response immediately. Realtime is a
      // fan-out signal, not something the initiating phone should have to wait
      // for before leaving the lobby.
      setGame(result.game)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown_error')
    } finally {
      setPendingAction(null)
    }
  }

  async function removePlayer(targetId: string) {
    if (!game) return
    const isSelf = targetId === me?.id
    setError(null)
    setPendingAction(isSelf ? 'leave' : `kick:${targetId}`)
    try {
      const body: RemovePlayerRequest = {
        target_player_id: targetId,
        device_id: getDeviceId(),
      }
      await apiPost<RemovePlayerResponse>(`/api/games/${game.id}/remove-player`, body)
      if (isSelf) {
        router.push('/')
      } else {
        setConfirmRemoval(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown_error')
    } finally {
      setPendingAction(null)
    }
  }

  function requestRemovePlayer(targetId: string) {
    const target = players.find((player) => player.id === targetId)
    if (!target) return
    setConfirmRemoval({
      targetId,
      name: target.display_name,
      isSelf: targetId === me?.id,
    })
  }

  if (!game) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-16">
        <p className="text-sm text-neutral-400">{t('common.loading')}</p>
      </main>
    )
  }

  // Player has visited a code they did not join (different device, fresh phone).
  if (isHydrated && !me) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-6 py-16 text-center">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">{game.code}</h1>
          <p className="text-sm text-neutral-400">{t('lobby.not_in_game')}</p>
        </header>
        <Link
          href={`/game/join?code=${encodeURIComponent(game.code)}`}
          className="inline-flex items-center justify-center rounded-lg bg-neutral-100 px-5 py-3 text-sm font-medium text-neutral-900 transition hover:bg-black hover:text-neutral-100"
        >
          {t('lobby.join_this_game')}
        </Link>
        <Link href="/" className="text-sm text-neutral-400 hover:text-neutral-200">
          {t('common.back_to_home')}
        </Link>
      </main>
    )
  }

  if (game.status === 'setup') {
    return <Setup />
  }
  if (
    game.status === 'live' ||
    game.status === 'flag_found' ||
    game.status === 'paused' ||
    game.status === 'finished'
  ) {
    return <Live />
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold">{t('lobby.title')}</h1>
          <div className="flex items-center gap-2">
            <code className="rounded-md bg-neutral-900 px-3 py-1 text-lg font-mono tracking-[0.3em] text-neutral-100">
              {game.code ?? code}
            </code>
            <LanguageSwitcher />
          </div>
        </div>
        <p className="text-sm text-neutral-400">{t('lobby.share_hint')}</p>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TeamColumn
          title={t('lobby.team_west_full')}
          team={teamsBySide.west}
          players={teamsBySide.west ? (playersByTeam.get(teamsBySide.west.id) ?? []) : []}
          meId={me?.id ?? null}
          meIsHost={me?.is_host ?? false}
          onKick={requestRemovePlayer}
          pendingAction={pendingAction}
        />
        <TeamColumn
          title={t('lobby.team_east_full')}
          team={teamsBySide.east}
          players={teamsBySide.east ? (playersByTeam.get(teamsBySide.east.id) ?? []) : []}
          meId={me?.id ?? null}
          meIsHost={me?.is_host ?? false}
          onKick={requestRemovePlayer}
          pendingAction={pendingAction}
        />
      </section>

      {me && (
        <section className="flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-neutral-400">{t('lobby.you_are')}</p>
              <p className="text-lg font-medium">{me.display_name}</p>
            </div>
            <div className="text-right text-sm text-neutral-400">
              <p>
                {teams.find((tm) => tm.id === me.team_id)?.side === 'east'
                  ? t('lobby.on_side_east')
                  : t('lobby.on_side_west')}
              </p>
              <p>{me.ready ? t('common.ready') : t('common.not_ready')}</p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button
              variant={me.ready ? 'secondary' : 'primary'}
              onClick={toggleReady}
              disabled={pendingAction !== null}
              className="flex-1 py-4 text-base"
            >
              {pendingAction === 'ready'
                ? t('common.saving')
                : me.ready
                  ? t('common.not_ready')
                  : t('common.ready')}
            </Button>
            <Button
              variant="secondary"
              onClick={switchTeam}
              disabled={
                me.ready || otherTeamFull || pendingAction !== null || game.status !== 'lobby'
              }
              className="flex-1 py-4 text-base"
            >
              {pendingAction === 'switch' ? t('lobby.switching') : t('lobby.switch_team')}
            </Button>
          </div>
          {otherTeamFull && !me.ready && (
            <p className="text-xs text-neutral-500">{t('lobby.other_team_full')}</p>
          )}
          <button
            onClick={() => requestRemovePlayer(me.id)}
            disabled={pendingAction !== null}
            className="self-end text-xs text-neutral-500 underline-offset-2 hover:text-red-300 hover:underline disabled:opacity-50"
          >
            {pendingAction === 'leave' ? t('lobby.leaving') : t('lobby.leave')}
          </button>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <Button
          onClick={startGame}
          disabled={!canStart || pendingAction !== null}
          className="w-full py-4 text-base"
        >
          {pendingAction === 'start' ? t('lobby.starting') : t('lobby.start_game')}
        </Button>
        {!canStart && (
          <p className="text-xs text-neutral-500">
            {!validTeamSizes
              ? t('lobby.need_team_sizes')
              : !allReady
                ? t('lobby.need_all_ready')
                : null}
          </p>
        )}
      </section>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-200"
        >
          {t('lobby.action_error')}
        </div>
      )}
      <ConfirmActionModal
        open={confirmRemoval !== null}
        title={confirmRemoval?.isSelf ? t('lobby.leave_title') : t('lobby.kick_title')}
        body={
          confirmRemoval?.isSelf
            ? t('lobby.leave_confirm')
            : `${t('lobby.kick_confirm')} ${confirmRemoval?.name ?? ''}`
        }
        confirmLabel={confirmRemoval?.isSelf ? t('lobby.leave_action') : t('lobby.kick_action')}
        busy={pendingAction === 'leave' || pendingAction?.startsWith('kick:')}
        danger
        onConfirm={() => {
          if (confirmRemoval) void removePlayer(confirmRemoval.targetId)
        }}
        onCancel={() => setConfirmRemoval(null)}
      />
    </main>
  )
}

function TeamColumn({
  title,
  team,
  players,
  meId,
  meIsHost,
  onKick,
  pendingAction,
}: {
  title: string
  team: Team | null
  players: Player[]
  meId: string | null
  meIsHost: boolean
  onKick: (playerId: string) => void
  pendingAction: string | null
}) {
  const t = useT()

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-medium">{title}</h2>
        <span className="text-xs text-neutral-500">
          {players.length === 1
            ? t('lobby.players_one')
            : t('lobby.players_many', { n: players.length })}
        </span>
      </div>
      {!team ? (
        <p className="text-sm text-neutral-500">{t('lobby.team_not_initialised')}</p>
      ) : players.length === 0 ? (
        <p className="text-sm text-neutral-500">{t('lobby.no_players')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {players.map((p) => {
            const kicking = pendingAction === `kick:${p.id}`
            const canKick = meIsHost && p.id !== meId
            return (
              <li
                key={p.id}
                className={
                  'flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ' +
                  (p.id === meId
                    ? 'border-neutral-500 bg-neutral-800'
                    : 'border-neutral-800 bg-neutral-900')
                }
              >
                <span className="flex-1">
                  {p.display_name}
                  {p.id === meId && (
                    <span className="ml-2 text-xs text-neutral-400">({t('common.you')})</span>
                  )}
                  {p.is_host && (
                    <span className="ml-2 rounded bg-neutral-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-neutral-200">
                      {t('common.host')}
                    </span>
                  )}
                </span>
                <span
                  aria-label={p.ready ? t('common.ready') : t('common.not_ready')}
                  className={p.ready ? 'text-emerald-400' : 'text-neutral-600'}
                >
                  {p.ready ? '✓' : '·'}
                </span>
                {canKick && (
                  <button
                    onClick={() => onKick(p.id)}
                    disabled={pendingAction !== null}
                    className="rounded px-2 py-1 text-xs text-neutral-500 hover:bg-red-900/40 hover:text-red-200 disabled:opacity-50"
                    aria-label={`${t('lobby.kick_action')} ${p.display_name}`}
                  >
                    {kicking ? '…' : '✕'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
