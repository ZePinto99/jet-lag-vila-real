'use client'

// Full-bleed end-game screen shown when game.status === 'finished'.
// Renders the winner banner, the per-team score breakdown (RULEBOOK §13.2),
// a short highlights reel, and the full event timeline.

import Link from 'next/link'
import { useMemo } from 'react'
import { cn } from '@/lib/cn'
import { computeScores } from '@/lib/results/scoring'
import { useT } from '@/lib/i18n/context'
import { MatchRecap } from '@/components/game/MatchRecap'
import type { GameEvent, Player, Team, TeamScore, WinReason } from '@/lib/types'

interface GameOverOverlayProps {
  events: GameEvent[]
  teams: Team[]
  players: Player[]
  myTeamId: string | null
  onViewTimeline: () => void
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

function teamLabel(team: Team | undefined): string {
  if (!team) return 'Team ?'
  return `Team ${team.side === 'east' ? 'East' : 'West'}`
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
      return `${teamLabel(teamOf(p.team_id as string))} hardened ${p.landmark_ref}`
    case 'game_won':
      return `Team won (${(p.reason as string) ?? 'flag_returned'})`
    case 'game_ended_by_timeout':
      return `Game ended by timeout`
    default:
      return e.type
  }
}

function reasonLabel(reason: WinReason): string {
  switch (reason) {
    case 'flag_returned':
      return 'Flag returned to home base'
    case 'timeout_points':
      return 'Won on points after 3-hour timeout'
    case 'timeout_tiebreaker':
      return 'Won on tiebreaker after 3-hour timeout'
    case 'timeout_tied':
      return 'Tied — all tiebreakers exhausted'
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
  if (!team || !score) return null
  const accent =
    team.side === 'west' ? 'border-blue-700' : 'border-pink-700'
  const accentText =
    team.side === 'west' ? 'text-blue-300' : 'text-pink-300'
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border bg-neutral-900/60 p-4',
        isWinner ? 'border-emerald-600 ring-2 ring-emerald-700/50' : accent,
      )}
    >
      <div className="flex items-baseline justify-between">
        <h3 className={cn('text-base font-semibold', accentText)}>
          {teamLabel(team)}
        </h3>
        <div className="flex items-baseline gap-2">
          {isMine && <span className="text-[10px] uppercase tracking-wider text-neutral-500">you</span>}
          {isWinner && (
            <span className="rounded bg-emerald-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-emerald-50">
              winner
            </span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1 text-sm">
        <span className="text-neutral-400">Real flag photographed</span>
        <span className="text-neutral-300 tabular-nums">{score.found_real_flag ? '1' : '0'}</span>
        <span className="text-right tabular-nums text-neutral-100">{score.flag_points.toFixed(1)}</span>

        <span className="text-neutral-400">Challenges completed</span>
        <span className="text-neutral-300 tabular-nums">{score.challenges_completed}</span>
        <span className="text-right tabular-nums text-neutral-100">{score.challenge_points.toFixed(1)}</span>

        <span className="text-neutral-400">Tags made</span>
        <span className="text-neutral-300 tabular-nums">{score.tags_made}</span>
        <span className="text-right tabular-nums text-neutral-100">{score.tag_points.toFixed(1)}</span>

        <span className="text-neutral-400">Curses cast</span>
        <span className="text-neutral-300 tabular-nums">{score.curses_cast}</span>
        <span className="text-right tabular-nums text-neutral-100">{score.curse_points.toFixed(1)}</span>

        <span className="text-neutral-400">Coins remaining</span>
        <span className="text-neutral-300 tabular-nums">{score.coins_remaining}</span>
        <span className="text-right tabular-nums text-neutral-100">{score.coin_points.toFixed(1)}</span>
      </div>
      <div className="flex items-baseline justify-between border-t border-neutral-800 pt-2">
        <span className="text-sm font-semibold text-neutral-200">Total</span>
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
}: GameOverOverlayProps) {
  const t = useT()
  const scores = useMemo(
    () => computeScores({ events, teams, players }),
    [events, teams, players],
  )
  const won = findGameWonPayload(events)
  const winner = won?.winner_team_id
    ? teams.find((t) => t.id === won.winner_team_id) ?? null
    : null
  const youWon = winner != null && myTeamId != null && winner.id === myTeamId
  const reason: WinReason = won?.reason ?? 'flag_returned'

  const westScore = scores.find((s) => s.team_side === 'west')
  const eastScore = scores.find((s) => s.team_side === 'east')
  const westTeam = teams.find((t) => t.side === 'west')
  const eastTeam = teams.find((t) => t.side === 'east')

  const recent = useMemo(() => {
    return [...events].slice(-20).reverse()
  }, [events])

  return (
    <div className="fixed inset-0 z-[1000] overflow-y-auto bg-neutral-950/95 backdrop-blur">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-8">
        <header className="text-center">
          <p className="text-xs uppercase tracking-[0.3em] text-neutral-400">Game over</p>
          <h1
            className={cn(
              'mt-2 text-4xl font-bold tracking-tight',
              winner == null
                ? 'text-neutral-200'
                : youWon
                  ? 'text-emerald-300'
                  : 'text-red-300',
            )}
          >
            {winner ? `${teamLabel(winner)} wins!` : 'Tie game'}
          </h1>
          <p className="mt-1 text-sm text-neutral-400">{reasonLabel(reason)}</p>
          {winner && myTeamId && (
            <p className="mt-1 text-sm text-neutral-500">
              {youWon ? 'Congratulations.' : 'Better luck next round.'}
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
          events={events}
          players={players}
          teams={teams}
          myTeamId={myTeamId ?? ''}
          t={t}
        />

        <section className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-neutral-300">
            Last 20 events
          </h2>
          <ol className="flex flex-col gap-1 text-xs text-neutral-300">
            {recent.length === 0 && (
              <li className="text-neutral-500">No events recorded.</li>
            )}
            {recent.map((e) => (
              <li key={e.id} className="flex gap-2">
                <span className="w-20 shrink-0 text-neutral-500 tabular-nums">
                  {fmtTime(e.created_at)}
                </span>
                <span>{eventOneLiner(e, teams, players)}</span>
              </li>
            ))}
          </ol>
        </section>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={onViewTimeline}
            className="rounded-lg bg-neutral-100 px-5 py-2.5 text-sm font-semibold text-neutral-900 transition hover:bg-white"
          >
            View full timeline
          </button>
          <Link
            href="/"
            className="rounded-lg border border-neutral-700 px-5 py-2.5 text-center text-sm font-medium text-neutral-200 transition hover:bg-neutral-800"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  )
}
