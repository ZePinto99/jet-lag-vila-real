'use client'

// ChallengeHistoryList — renders the team's completed challenges from the
// events log. Lives in the Status tab, below CurseHistoryList.
//
// Filters events of type 'challenge_completed' where payload.team_id matches
// the local team. Resolves challenge_ref to a location name via
// data/challenges.json. Shows the last 10 entries newest-first.

import challengesSeed from '@/data/challenges.json'
import type { ChallengeDefinition, GameEvent } from '@/lib/types'

const CHALLENGE_CATALOG: ChallengeDefinition[] =
  challengesSeed as ChallengeDefinition[]

function challengeLocation(ref: string): string {
  return CHALLENGE_CATALOG.find((c) => c.id === ref)?.location_name ?? ref
}

interface HistoryEntry {
  id: string
  createdAt: string
  locationName: string
  rewardCoins: number | null
  bonusCoins: number | null
  firstBlood: boolean
}

interface ChallengeHistoryListProps {
  events: GameEvent[]
  myTeamId: string
}

export function ChallengeHistoryList({
  events,
  myTeamId,
}: ChallengeHistoryListProps) {
  const entries = buildHistory(events, myTeamId).slice(0, 10)

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <h2 className="text-sm font-medium text-neutral-100">
        Challenge history
      </h2>
      {entries.length === 0 ? (
        <p className="mt-2 text-xs text-neutral-500">
          No challenges completed yet.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-baseline gap-2 rounded px-2 py-1 text-xs odd:bg-neutral-900/40"
            >
              <span className="font-mono text-[10px] text-neutral-500">
                {formatClock(entry.createdAt)}
              </span>
              <span className="flex-1 text-emerald-200">
                {entry.locationName}
              </span>
              <span className="font-mono tabular-nums text-emerald-300">
                {entry.rewardCoins != null ? `+${entry.rewardCoins}` : ''}
                {entry.firstBlood && entry.bonusCoins != null
                  ? ` (+${entry.bonusCoins} first blood)`
                  : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function buildHistory(events: GameEvent[], myTeamId: string): HistoryEntry[] {
  const out: HistoryEntry[] = []
  // Walk newest-first.
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (!e) continue
    if (e.type !== 'challenge_completed') continue
    const payload = e.payload as Record<string, unknown>
    const teamId = pickString(payload, 'team_id')
    if (teamId !== myTeamId) continue
    const ref = pickString(payload, 'challenge_ref')
    if (!ref) continue
    out.push({
      id: e.id,
      createdAt: e.created_at,
      locationName: challengeLocation(ref),
      rewardCoins: pickNumber(payload, 'reward_coins'),
      bonusCoins: pickNumber(payload, 'bonus_coins'),
      firstBlood: pickBoolean(payload, 'first_blood') ?? false,
    })
  }
  return out
}

function pickString(
  obj: Record<string, unknown>,
  key: string,
): string | null {
  const v = obj[key]
  return typeof v === 'string' ? v : null
}

function pickNumber(
  obj: Record<string, unknown>,
  key: string,
): number | null {
  const v = obj[key]
  return typeof v === 'number' ? v : null
}

function pickBoolean(
  obj: Record<string, unknown>,
  key: string,
): boolean | null {
  const v = obj[key]
  return typeof v === 'boolean' ? v : null
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function formatClock(iso: string): string {
  const d = new Date(iso)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}
