'use client'

// Full-bleed end-game screen shown when game.status === 'finished'.
// Renders the winner banner, the per-team score breakdown (RULEBOOK §13.2),
// a short highlights reel, and the full event timeline.

import Link from 'next/link'
import { useEffect, useId, useMemo, useState } from 'react'
import { cn } from '@/lib/cn'
import { apiGet } from '@/lib/api'
import { getDeviceId } from '@/lib/device'
import { computeScores } from '@/lib/results/scoring'
import { useT } from '@/lib/i18n/context'
import { MatchRecap } from '@/components/game/MatchRecap'
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher'
import { buildChallengeProofIndex, challengeProofUrl } from '@/lib/challenges/proofs'
import { useModalDialog } from '@/lib/hooks/useModalDialog'
import type {
  GameEvent,
  GameResultsResponse,
  Player,
  Team,
  TeamScore,
  WinReason,
} from '@/lib/types'

interface GameOverOverlayProps {
  events: GameEvent[]
  teams: Team[]
  players: Player[]
  myTeamId: string | null
  onViewTimeline: () => void
  gameId?: string | null
}

function findGameWonPayload(
  events: GameEvent[],
): { winner_team_id: string | null; reason: WinReason } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type !== 'game_won' && e.type !== 'game_ended_by_timeout') continue
    const p = e.payload as { winner_team_id?: string | null; reason?: WinReason }
    return {
      winner_team_id: p.winner_team_id ?? null,
      reason: p.reason ?? (e.type === 'game_won' ? 'flag_returned' : 'timeout_points'),
    }
  }
  return null
}

type Translate = (key: string, tokens?: Record<string, string | number>) => string
const keepResultsOpen = () => undefined

function teamLabel(team: Team | undefined, t?: Translate): string {
  if (!team) return `${t?.('common.team') ?? 'Team'} ?`
  if (!t) return `Team ${team.side === 'east' ? 'East' : 'West'}`
  return `${t('common.team')} ${t(team.side === 'east' ? 'common.east' : 'common.west')}`
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function eventOneLiner(e: GameEvent, teams: Team[], players: Player[]): string {
  const teamOf = (id: string | undefined) => teams.find((t) => t.id === id)
  const playerOf = (id: string | undefined) => players.find((p) => p.id === id)
  const p = e.payload as Record<string, unknown>
  switch (e.type) {
    case 'player_joined':
      return `${playerOf(p.player_id as string)?.display_name ?? 'someone'} joined`
    case 'game_started':
      return 'Game session started'
    case 'flags_assigned':
      return `${teamLabel(teamOf(p.team_id as string))} placed their flags`
    case 'game_live':
      return 'Live phase started'
    case 'flag_attempt': {
      const t = teamLabel(teamOf(p.team_id as string))
      return `${t} attempted ${p.landmark_ref} → ${p.result}`
    }
    case 'flag_found':
      return `${teamLabel(teamOf(p.team_id as string))} FOUND the real flag`
    case 'tag': {
      const defender = playerOf(p.defender_player_id as string)
      const raider = playerOf(p.raider_player_id as string)
      return `${defender?.display_name ?? 'defender'} tagged ${raider?.display_name ?? 'raider'}`
    }
    case 'curse_cast':
      return `${teamLabel(teamOf(p.buyer_team_id as string))} cast ${p.curse_ref} (${p.tier})`
    case 'curse_expired':
      return `Curse ${p.curse_ref} expired`
    case 'intel_purchased':
      return `${teamLabel(teamOf(p.team_id as string))} bought ${p.intel_ref}`
    case 'intel_lost':
      return `${teamLabel(teamOf(p.team_id as string))} lost intel ${p.ref}`
    case 'challenge_completed': {
      const t = teamLabel(teamOf(p.team_id as string))
      const bonus = p.first_blood ? ' (FIRST BLOOD)' : ''
      return `${t} completed ${p.challenge_ref}${bonus}`
    }
    case 'coins_credited':
      return `${teamLabel(teamOf(p.team_id as string))} +${p.amount}c (${p.reason})`
    case 'coins_deducted':
      return `${teamLabel(teamOf(p.team_id as string))} -${p.amount}c (${p.reason})`
    case 'flag_hardened':
      return `${teamLabel(teamOf(p.team_id as string))} hardened their flag`
    case 'game_won':
      return `Team won (${(p.reason as string) ?? 'flag_returned'})`
    case 'game_ended_by_timeout':
      return `Game ended by timeout`
    default:
      return e.type
  }
}

function reasonLabel(reason: WinReason, t: Translate): string {
  switch (reason) {
    case 'flag_returned':
      return t('gameover.reason_flag_returned')
    case 'timeout_points':
      return t('gameover.reason_timeout_points')
    case 'timeout_tiebreaker':
      return t('gameover.reason_timeout_tiebreaker')
    case 'timeout_tied':
      return t('gameover.reason_timeout_tied')
    case 'timeout_coin_flip':
      return t('gameover.reason_timeout_coin_flip')
  }
}

function ScoreColumn({
  team,
  score,
  isWinner,
  isMine,
}: {
  team: Team | undefined
  score: TeamScore | undefined
  isWinner: boolean
  isMine: boolean
}) {
  const t = useT()
  if (!team || !score) return null
  const accent = team.side === 'west' ? 'border-blue-700' : 'border-pink-700'
  const accentText = team.side === 'west' ? 'text-blue-300' : 'text-pink-300'
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border bg-neutral-900/60 p-4',
        isWinner ? 'border-emerald-600 ring-2 ring-emerald-700/50' : accent,
      )}
    >
      <div className="flex items-baseline justify-between">
        <h3 className={cn('text-base font-semibold', accentText)}>{teamLabel(team, t)}</h3>
        <div className="flex items-baseline gap-2">
          {isMine && (
            <span className="text-[10px] uppercase tracking-wider text-neutral-500">{t('common.you')}</span>
          )}
          {isWinner && (
            <span className="rounded bg-emerald-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-emerald-50">
              {t('gameover.winner_badge')}
            </span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 text-sm">
        <span className="text-neutral-400">{t('gameover.row_real_flag')}</span>
        <span className="text-neutral-300 tabular-nums">{score.found_real_flag ? '1' : '0'}</span>
        <span className="text-right tabular-nums text-neutral-100">
          {score.flag_points.toFixed(1)}
        </span>

        <span className="text-neutral-400">{t('gameover.row_challenges')}</span>
        <span className="text-neutral-300 tabular-nums">{score.challenges_completed}</span>
        <span className="text-right tabular-nums text-neutral-100">
          {score.challenge_points.toFixed(1)}
        </span>

        <span className="text-neutral-400">{t('gameover.row_tags')}</span>
        <span className="text-neutral-300 tabular-nums">{score.tags_made}</span>
        <span className="text-right tabular-nums text-neutral-100">
          {score.tag_points.toFixed(1)}
        </span>

        <span className="text-neutral-400">{t('gameover.row_curses')}</span>
        <span className="text-neutral-300 tabular-nums">{score.curses_cast}</span>
        <span className="text-right tabular-nums text-neutral-100">
          {score.curse_points.toFixed(1)}
        </span>

        <span className="text-neutral-400">{t('gameover.row_coins')}</span>
        <span className="text-neutral-300 tabular-nums">{score.coins_remaining}</span>
        <span className="text-right tabular-nums text-neutral-100">
          {score.coin_points.toFixed(1)}
        </span>
      </div>
      <div className="flex items-baseline justify-between border-t border-neutral-800 pt-2">
        <span className="text-sm font-semibold text-neutral-200">{t('gameover.row_total')}</span>
        <span className="text-xl font-bold tabular-nums text-neutral-50">
          {score.total.toFixed(1)}
        </span>
      </div>
    </div>
  )
}

export function GameOverOverlay({
  events,
  teams,
  players,
  myTeamId,
  onViewTimeline,
  gameId = null,
}: GameOverOverlayProps) {
  const t = useT()
  const titleId = useId()
  const [showFullTimeline, setShowFullTimeline] = useState(false)
  const [authoritative, setAuthoritative] = useState<GameResultsResponse | null>(null)
  const [authoritativeEvents, setAuthoritativeEvents] = useState<GameEvent[] | null>(null)
  const [resultsError, setResultsError] = useState<string | null>(null)
  const dialogRef = useModalDialog({ open: true, busy: true, onCancel: keepResultsOpen })

  useEffect(() => {
    if (!gameId) return
    let cancelled = false
    ;(async () => {
      try {
        const deviceId = getDeviceId()
        const newestFirst: GameEvent[] = []
        const seenOffsets = new Set<number>()
        let offset: number | null = 0
        let first: GameResultsResponse | null = null
        while (offset != null) {
          if (seenOffsets.has(offset)) throw new Error('invalid_results_pagination')
          seenOffsets.add(offset)
          const page: GameResultsResponse = await apiGet<GameResultsResponse>(
            `/api/games/${gameId}/results?device_id=${encodeURIComponent(deviceId)}&offset=${offset}&limit=100`,
          )
          if (!first) first = page
          newestFirst.push(...page.timeline_events)
          offset = page.timeline_next_offset
        }
        if (!cancelled && first) {
          setAuthoritative(first)
          setAuthoritativeEvents(newestFirst.reverse())
        }
      } catch (error) {
        if (!cancelled) {
          setResultsError(error instanceof Error ? error.message : 'results_load_failed')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [gameId])

  const completeEvents = authoritativeEvents ?? events
  const scores = useMemo(
    () => authoritative?.scores ?? computeScores({ events: completeEvents, teams, players }),
    [authoritative, completeEvents, teams, players],
  )
  const won = authoritative
    ? { winner_team_id: authoritative.winner_team_id, reason: authoritative.reason }
    : findGameWonPayload(completeEvents)
  const winner = won?.winner_team_id
    ? (teams.find((t) => t.id === won.winner_team_id) ?? null)
    : null
  const youWon = winner != null && myTeamId != null && winner.id === myTeamId
  const reason: WinReason = won?.reason ?? 'flag_returned'

  const westScore = scores.find((s) => s.team_side === 'west')
  const eastScore = scores.find((s) => s.team_side === 'east')
  const westTeam = teams.find((t) => t.side === 'west')
  const eastTeam = teams.find((t) => t.side === 'east')

  const recent = useMemo(() => {
    return [...completeEvents].slice(-20).reverse()
  }, [completeEvents])
  const displayedEvents = useMemo(
    () => showFullTimeline ? [...completeEvents].reverse() : recent,
    [completeEvents, recent, showFullTimeline],
  )
  const challengeProofs = useMemo(
    () => buildChallengeProofIndex(completeEvents),
    [completeEvents],
  )

  return (
    <div
      className="fixed inset-0 z-[1000] overflow-y-auto bg-neutral-950/95 backdrop-blur"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        ref={dialogRef}
        className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-8"
      >
        <div className="flex justify-end">
          <LanguageSwitcher />
        </div>
        <header className="text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-neutral-400">{t('gameover.tag')}</p>
          <h1
            id={titleId}
            tabIndex={-1}
            data-dialog-autofocus
            className={cn(
              'mt-2 text-4xl font-bold tracking-tight',
              winner == null ? 'text-neutral-200' : youWon ? 'text-emerald-300' : 'text-red-300',
            )}
          >
            {winner
              ? t('gameover.wins', { team: teamLabel(winner, t) })
              : t('gameover.tie')}
          </h1>
          <p className="mt-1 text-sm text-neutral-400">{reasonLabel(reason, t)}</p>
          {winner && myTeamId && (
            <p className="mt-1 text-sm text-neutral-500">
              {youWon ? t('gameover.you_won') : t('gameover.you_lost')}
            </p>
          )}
        </header>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ScoreColumn
            team={westTeam}
            score={westScore}
            isWinner={winner?.id === westTeam?.id}
            isMine={myTeamId != null && myTeamId === westTeam?.id}
          />
          <ScoreColumn
            team={eastTeam}
            score={eastScore}
            isWinner={winner?.id === eastTeam?.id}
            isMine={myTeamId != null && myTeamId === eastTeam?.id}
          />
        </section>

        {/* Narrative recap: MVP, first blood, highlight beats. */}
        <MatchRecap
          events={completeEvents}
          players={players}
          teams={teams}
          myTeamId={myTeamId ?? ''}
          t={t}
        />

        <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-300">
            {showFullTimeline ? t('status.timeline') : t('gameover.recent_events')}
          </h2>
          <ol className="flex flex-col gap-1 text-xs text-neutral-300">
            {displayedEvents.length === 0 && <li className="text-neutral-500">{t('gameover.no_events')}</li>}
            {displayedEvents.map((e) => {
              const proofUrl = challengeProofUrl(e, challengeProofs)
              return (
                <li key={e.id} className="flex gap-2">
                  <span className="w-20 shrink-0 text-neutral-500 tabular-nums">
                    {fmtTime(e.created_at)}
                  </span>
                  <span>
                    {eventOneLiner(e, teams, players)}
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
          {resultsError && (
            <p role="alert" className="mt-2 text-xs text-amber-300">
              {resultsError}
            </p>
          )}
        </section>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          {!showFullTimeline && (
            <button
              type="button"
              onClick={() => {
                setShowFullTimeline(true)
                onViewTimeline()
              }}
              className="rounded-lg bg-neutral-100 px-5 py-2.5 text-sm font-semibold text-neutral-900 transition hover:bg-white"
            >
              {t('gameover.view_timeline')}
            </button>
          )}
          <Link
            href="/"
            className="rounded-lg border border-neutral-700 px-5 py-2.5 text-center text-sm font-medium text-neutral-200 transition hover:bg-neutral-800"
          >
            {t('common.back_to_home')}
          </Link>
        </div>
      </div>
    </div>
  )
}
