'use client'

// Post-game narrative recap card — a compact, shareable "highlights" panel
// rendered after the game ends (inside GameOverOverlay or the Status tab).
// Pure presentation: it derives everything from the event log via computeRecap
// and computeScores, and styles to match GameOverOverlay (rounded cards,
// neutral-900/40 surfaces, neutral-800 borders, side-tinted accents).

import { useMemo } from 'react'
import { cn } from '@/lib/cn'
import { computeRecap } from '@/lib/results/recap'
import { computeScores } from '@/lib/results/scoring'
import type { GameEvent, Player, Team } from '@/lib/types'

interface MatchRecapProps {
  events: GameEvent[]
  players: Player[]
  teams: Team[]
  myTeamId: string
  t: (key: string, tokens?: Record<string, string | number>) => string
}

function teamLabel(teamId: string | null, teams: Team[]): string {
  if (!teamId) return 'Team ?'
  const team = teams.find((t) => t.id === teamId)
  if (!team) return 'Team ?'
  return `Team ${team.side === 'east' ? 'East' : 'West'}`
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-neutral-800 bg-neutral-900/60 px-2 py-2">
      <span className="text-lg font-bold tabular-nums text-neutral-50">{value}</span>
      <span className="mt-0.5 text-center text-[10px] uppercase tracking-wider text-neutral-400">
        {label}
      </span>
    </div>
  )
}

export function MatchRecap({ events, players, teams, myTeamId, t }: MatchRecapProps) {
  const recap = useMemo(
    () => computeRecap({ events, players, teams }),
    [events, players, teams],
  )
  // Computed for parity with the scoreboard; surfaced as the headline total.
  const scores = useMemo(
    () => computeScores({ events, teams, players }),
    [events, teams, players],
  )

  const myScore = scores.find((s) => s.team_id === myTeamId) ?? null
  const mvpIsMine = recap.mvp != null && recap.mvp.teamId === myTeamId

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <header className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-300">
          {t('recap.title')}
        </h2>
        {myScore && (
          <span className="text-xs text-neutral-500">
            {t('recap.your_score', { score: myScore.total.toFixed(1) })}
          </span>
        )}
      </header>

      {/* MVP + first blood */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">
            {t('recap.mvp')}
          </span>
          {recap.mvp ? (
            <>
              <span className="flex items-center gap-1.5 text-base font-semibold text-neutral-100">
                <span aria-hidden>🖐️</span>
                {recap.mvp.name}
                {mvpIsMine && (
                  <span className="text-[10px] uppercase tracking-wider text-neutral-500">
                    {t('recap.you')}
                  </span>
                )}
              </span>
              <span className="text-xs text-neutral-400">
                {t('recap.mvp_tags', { count: recap.mvp.tags })}
              </span>
            </>
          ) : (
            <span className="text-sm text-neutral-500">{t('recap.no_mvp')}</span>
          )}
        </div>

        <div className="flex flex-col gap-1 rounded-lg border border-neutral-800 bg-neutral-900/60 p-3">
          <span className="text-[10px] uppercase tracking-wider text-neutral-500">
            {t('recap.first_blood')}
          </span>
          {recap.firstBloodTeamId ? (
            <span
              className={cn(
                'flex items-center gap-1.5 text-base font-semibold',
                teams.find((tm) => tm.id === recap.firstBloodTeamId)?.side === 'east'
                  ? 'text-pink-300'
                  : 'text-blue-300',
              )}
            >
              <span aria-hidden>🩸</span>
              {teamLabel(recap.firstBloodTeamId, teams)}
            </span>
          ) : (
            <span className="text-sm text-neutral-500">{t('recap.no_first_blood')}</span>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-2">
        <Stat value={recap.totalTags} label={t('recap.stat_tags')} />
        <Stat value={recap.totalChallenges} label={t('recap.stat_challenges')} />
        <Stat value={recap.totalCurses} label={t('recap.stat_curses')} />
        <Stat value={recap.totalCaptures} label={t('recap.stat_captures')} />
      </div>

      {/* Highlight beats */}
      <div>
        <h3 className="mb-2 text-[10px] uppercase tracking-wider text-neutral-500">
          {t('recap.highlights')}
        </h3>
        <ul className="flex flex-col gap-1.5">
          {recap.highlights.length === 0 && (
            <li className="text-sm text-neutral-500">{t('recap.no_highlights')}</li>
          )}
          {recap.highlights.map((h, i) => (
            <li
              key={i}
              className="flex items-start gap-2 rounded-lg bg-neutral-900/60 px-3 py-2 text-sm text-neutral-200"
            >
              <span aria-hidden className="shrink-0 leading-5">
                {h.icon}
              </span>
              <span className="leading-5">{h.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
