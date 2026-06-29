'use client'

// Read-only spectator / war-room view.
//
// A non-player (resting player or friend) opens this by game code and watches
// the board live: scoreboard, live event feed, and a landmark map. It is fully
// self-contained — no edits to shared player components, no device auth.
//
// Data: GET /api/games/by-code/{code} -> game id, then
//       GET /api/games/{id}/observer-state (redacted snapshot).
// Live: subscribe to postgres_changes INSERT on `events` (filtered by game_id)
//       and re-poll observer-state on each new event; plus a 15 s safety poll.

import { use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type {
  Game,
  GameByCodeResponse,
  GameEvent,
  Team,
  TeamScore,
} from '@/lib/types'

// Mirror the response shape from the observer-state route (kept local so this
// page edits no shared files).
interface ObserverLandmark {
  id: string
  ref: string
  lat: number
  lng: number
  team_id: string | null
}
interface ObserverPlayer {
  id: string
  team_id: string
  display_name: string
  flag_carrier: boolean
  respawning: boolean
}
interface ObserverStateResponse {
  game: Game
  teams: Team[]
  players: ObserverPlayer[]
  landmarks: ObserverLandmark[]
  recent_events: GameEvent[]
  scores: TeamScore[]
}

const DEFAULT_DURATION_MIN = 180 // RULEBOOK §4.2 — 3 hours.
const WEST_COLOR = '#3b82f6'
const EAST_COLOR = '#ec4899'

const ObserverMap = dynamic(() => import('./ObserverMap'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-neutral-900 text-sm text-neutral-500">
      Loading map…
    </div>
  ),
})

export default function ObserverByCodePage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code: rawCode } = use(params)
  const code = rawCode.trim().toUpperCase()

  const [gameId, setGameId] = useState<string | null>(null)
  const [state, setState] = useState<ObserverStateResponse | null>(null)
  const [status, setStatus] = useState<'loading' | 'not_found' | 'error' | 'ready'>(
    'loading',
  )
  const [now, setNow] = useState<number>(() => Date.now())

  // 1 s ticking clock for the countdown.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  // Resolve code -> game id.
  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setGameId(null)
    ;(async () => {
      try {
        const res = await fetch(`/api/games/by-code/${encodeURIComponent(code)}`)
        if (cancelled) return
        if (res.status === 404) {
          setStatus('not_found')
          return
        }
        if (!res.ok) {
          setStatus('error')
          return
        }
        const data = (await res.json()) as GameByCodeResponse
        if (cancelled) return
        setGameId(data.game.id)
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [code])

  // Fetch / re-poll observer-state. Stable callback so realtime can re-trigger.
  const refetch = useCallback(async () => {
    if (!gameId) return
    try {
      const res = await fetch(`/api/games/${gameId}/observer-state`)
      if (res.status === 404) {
        setStatus('not_found')
        return
      }
      if (!res.ok) {
        setStatus('error')
        return
      }
      const data = (await res.json()) as ObserverStateResponse
      setState(data)
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [gameId])

  // Initial fetch + 15 s safety poll once we have a game id.
  useEffect(() => {
    if (!gameId) return
    void refetch()
    const id = window.setInterval(() => {
      void refetch()
    }, 15_000)
    return () => window.clearInterval(id)
  }, [gameId, refetch])

  // Realtime: re-poll on every new event for this game. Mirrors
  // useLiveGameRealtime's events binding.
  useEffect(() => {
    if (!gameId) return
    const supabase = createClient()
    const channel = supabase.channel(`observer:${gameId}`)
    channel.on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'events',
        filter: `game_id=eq.${gameId}`,
      },
      () => {
        void refetch()
      },
    )
    channel.subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [gameId, refetch])

  if (status === 'loading') {
    return (
      <CenteredMessage>
        <p className="text-sm text-neutral-400">Loading spectator view…</p>
      </CenteredMessage>
    )
  }

  if (status === 'not_found') {
    return (
      <CenteredMessage>
        <h1 className="text-xl font-semibold text-neutral-100">No such game</h1>
        <p className="text-sm text-neutral-400">
          No game found for code <span className="font-mono">{code}</span>.
        </p>
        <Link href="/" className="text-sm text-sky-400 hover:text-sky-300">
          &larr; Back home
        </Link>
      </CenteredMessage>
    )
  }

  if (status === 'error' || !state) {
    return (
      <CenteredMessage>
        <h1 className="text-xl font-semibold text-neutral-100">
          Could not load
        </h1>
        <p className="text-sm text-neutral-400">
          Something went wrong fetching the board for{' '}
          <span className="font-mono">{code}</span>.
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
        >
          Retry
        </button>
      </CenteredMessage>
    )
  }

  return <Dashboard state={state} now={now} />
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function Dashboard({
  state,
  now,
}: {
  state: ObserverStateResponse
  now: number
}) {
  const { game, teams, players, landmarks, recent_events, scores } = state

  const scoreByTeam = useMemo(() => {
    const m = new Map<string, TeamScore>()
    for (const s of scores) m.set(s.team_id, s)
    return m
  }, [scores])

  const endsAtMs = useMemo<number | null>(() => {
    if (!game.started_at) return null
    const minutes = game.config?.duration_minutes ?? DEFAULT_DURATION_MIN
    return new Date(game.started_at).getTime() + minutes * 60_000
  }, [game.started_at, game.config?.duration_minutes])

  // Newest first for the feed.
  const feed = useMemo(
    () => recent_events.slice().reverse(),
    [recent_events],
  )

  // Sort teams west-first for a stable scoreboard layout.
  const orderedTeams = useMemo(
    () =>
      teams
        .slice()
        .sort((a, b) => (a.side === b.side ? 0 : a.side === 'west' ? -1 : 1)),
    [teams],
  )

  return (
    <main className="flex min-h-screen flex-col bg-neutral-950 text-neutral-100">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 bg-neutral-950/95 px-4 py-3 backdrop-blur">
        <div className="flex items-baseline gap-3">
          <span className="text-xs uppercase tracking-wider text-neutral-500">
            Spectator
          </span>
          <code className="rounded bg-neutral-900 px-2 py-0.5 font-mono text-sm tracking-[0.2em] text-neutral-100">
            {game.code}
          </code>
          <StatusBadge status={game.status} />
        </div>
        <div className="flex items-center gap-3 text-sm text-neutral-300">
          <span className="text-xs uppercase tracking-wider text-neutral-500">
            Time left
          </span>
          <Countdown endsAtMs={endsAtMs} nowMs={now} status={game.status} />
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-2">
        {/* Scoreboard */}
        <section className="lg:col-span-2">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">
            Scoreboard
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {orderedTeams.map((team) => (
              <TeamCard
                key={team.id}
                team={team}
                score={scoreByTeam.get(team.id) ?? null}
                players={players.filter((p) => p.team_id === team.id)}
              />
            ))}
          </div>
        </section>

        {/* Map */}
        <section className="flex min-h-[320px] flex-col">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">
            Landmarks
          </h2>
          <div className="relative flex-1 overflow-hidden rounded-xl border border-neutral-800">
            {landmarks.length > 0 ? (
              <ObserverMap landmarks={landmarks} teams={teams} />
            ) : (
              <div className="flex h-full min-h-[300px] items-center justify-center text-sm text-neutral-500">
                No landmarks placed yet.
              </div>
            )}
          </div>
          <Legend />
        </section>

        {/* Live feed */}
        <section className="flex flex-col">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">
            Live feed
          </h2>
          <div className="flex-1 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/40">
            {feed.length === 0 ? (
              <p className="px-4 py-6 text-sm text-neutral-500">
                No events yet.
              </p>
            ) : (
              <ol className="max-h-[460px] overflow-y-auto">
                {feed.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-baseline gap-2 border-b border-neutral-900 px-3 py-2 text-xs last:border-b-0 odd:bg-neutral-900/30"
                  >
                    <span className="font-mono text-[10px] text-neutral-500">
                      {formatClock(e.created_at)}
                    </span>
                    <span className="font-medium text-neutral-200">
                      {eventLabel(e.type)}
                    </span>
                    <span className="text-neutral-400">
                      {summariseEvent(e, players, teams)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TeamCard({
  team,
  score,
  players,
}: {
  team: Team
  score: TeamScore | null
  players: ObserverPlayer[]
}) {
  const isWest = team.side === 'west'
  const sideLabel = isWest ? 'West' : 'East'
  const accent = isWest ? 'text-blue-300' : 'text-pink-300'
  const border = isWest ? 'border-blue-900/60' : 'border-pink-900/60'
  const dot = isWest ? WEST_COLOR : EAST_COLOR

  return (
    <div className={`rounded-xl border ${border} bg-neutral-900/40 p-4`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ backgroundColor: dot }}
          />
          <span className={`text-sm font-semibold ${accent}`}>
            Team {sideLabel}
          </span>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold tabular-nums">
            {score ? formatPoints(score.total) : '—'}
          </p>
          <p className="text-[10px] uppercase tracking-wider text-neutral-500">
            points
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-neutral-400">
        <Stat label="Coins" value={team.coins} />
        <Stat label="Flag" value={score?.found_real_flag ? 'Found' : '—'} />
        <Stat label="Challenges" value={score?.challenges_completed ?? 0} />
        <Stat label="Tags" value={score?.tags_made ?? 0} />
        <Stat label="Curses cast" value={score?.curses_cast ?? 0} />
        <Stat label="Players" value={players.length} />
      </div>

      {players.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {players.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-1 rounded-full bg-neutral-950 px-2 py-0.5 text-[11px] text-neutral-300"
            >
              <span>{p.display_name}</span>
              {p.flag_carrier && <span title="Flag carrier">🚩</span>}
              {p.respawning && (
                <span className="text-amber-400" title="Respawning">
                  ⟳
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-neutral-500">{label}</span>
      <span className="font-medium tabular-nums text-neutral-200">{value}</span>
    </div>
  )
}

function Legend() {
  return (
    <div className="mt-2 flex items-center gap-4 text-[11px] text-neutral-400">
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: WEST_COLOR }}
        />
        West
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: EAST_COLOR }}
        />
        East
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2.5 w-2.5 rounded-full bg-neutral-500" />
        Neutral
      </span>
    </div>
  )
}

function StatusBadge({ status }: { status: Game['status'] }) {
  const map: Record<Game['status'], { label: string; cls: string }> = {
    lobby: { label: 'Lobby', cls: 'bg-neutral-800 text-neutral-300' },
    setup: { label: 'Setup', cls: 'bg-amber-900/50 text-amber-200' },
    live: { label: 'Live', cls: 'bg-emerald-900/50 text-emerald-200' },
    flag_found: { label: 'Flag found!', cls: 'bg-rose-900/50 text-rose-200' },
    paused: { label: 'Paused', cls: 'bg-neutral-800 text-neutral-300' },
    finished: { label: 'Finished', cls: 'bg-sky-900/50 text-sky-200' },
  }
  const { label, cls } = map[status]
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {label}
    </span>
  )
}

function Countdown({
  endsAtMs,
  nowMs,
  status,
}: {
  endsAtMs: number | null
  nowMs: number
  status: Game['status']
}) {
  if (status === 'finished') {
    return <span className="font-mono text-sky-300">ended</span>
  }
  if (!endsAtMs) {
    return <span className="font-mono text-neutral-500">--:--</span>
  }
  const remainingMs = Math.max(0, endsAtMs - nowMs)
  const h = Math.floor(remainingMs / 3_600_000)
  const m = Math.floor((remainingMs % 3_600_000) / 60_000)
  const s = Math.floor((remainingMs % 60_000) / 1000)
  const text = h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`
  const color =
    remainingMs <= 0
      ? 'text-red-300'
      : remainingMs < 10 * 60_000
        ? 'text-amber-300'
        : 'text-neutral-200'
  return <span className={`font-mono tabular-nums ${color}`}>{text}</span>
}

function CenteredMessage({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-neutral-950 px-6 text-center">
      {children}
    </main>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function formatPoints(n: number): string {
  // Curse points are +0.5 each, so totals can be fractional.
  return Number.isInteger(n) ? `${n}` : n.toFixed(1)
}

function formatClock(iso: string): string {
  const d = new Date(iso)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

function eventLabel(type: string): string {
  // Humanise the snake_case event type into Title Case words.
  return type
    .split('_')
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

function summariseEvent(
  e: GameEvent,
  players: ObserverPlayer[],
  teams: Team[],
): string {
  const actor = e.actor_player_id
    ? players.find((p) => p.id === e.actor_player_id)?.display_name ?? 'someone'
    : 'system'

  const payload = e.payload as Record<string, unknown>

  // Resolve a team_id-ish field to a side label, when present.
  const teamSide = (id: unknown): string | null => {
    if (typeof id !== 'string') return null
    const tm = teams.find((t) => t.id === id)
    return tm ? (tm.side === 'west' ? 'West' : 'East') : null
  }

  switch (e.type) {
    case 'flag_attempt': {
      const result = payload.result
      const side = teamSide(payload.team_id)
      if (result === 'real') return `${side ?? actor} found the REAL flag!`
      if (result === 'decoy') return `${side ?? actor} hit a decoy`
      if (result === 'empty') return `${side ?? actor} found nothing`
      return `by ${actor}`
    }
    case 'flag_attempt_started':
      return `${actor} is attempting a flag`
    case 'tag':
      return `${actor} tagged a raider`
    case 'challenge_completed': {
      const side = teamSide(payload.team_id)
      return `${side ?? actor} completed a challenge`
    }
    case 'curse_cast': {
      const side = teamSide(payload.buyer_team_id)
      return `${side ?? actor} cast a curse`
    }
    case 'curse_expired':
      return `a curse expired`
    case 'intel_purchased': {
      const side = teamSide(payload.team_id)
      return `${side ?? actor} bought intel`
    }
    case 'game_won': {
      const side = teamSide(payload.winner_team_id)
      return side ? `Team ${side} wins!` : 'Game won'
    }
    default: {
      const scalars = scalarSummary(payload)
      return `by ${actor}${scalars ? ' · ' + scalars : ''}`
    }
  }
}

function scalarSummary(payload: Record<string, unknown>): string {
  return Object.keys(payload)
    .filter((k) => {
      const v = payload[k]
      return v == null || ['string', 'number', 'boolean'].includes(typeof v)
    })
    .slice(0, 3)
    .map((k) => `${k}=${String(payload[k])}`)
    .join(' ')
}
