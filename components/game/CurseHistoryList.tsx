'use client'

// CurseHistoryList — renders the team's recent curse-related events in the
// Status tab. Derives entries from the events log:
//  - 'curse_cast' targeting my team        → "Curse received: <name>"
//  - 'curse_expired' targeting my team     → "Curse expired: <name>"
//  - 'coin_drain' ledger effect on my team → "Coin drain: -N coins"
//  - 'intel_lost' ledger effect on my team → "Intel lost: <ref>"
//
// Curse refs resolve to names via data/curses.json. Shows the last 10
// entries newest-first.

import cursesSeed from '@/data/curses.json'
import type { GameEvent } from '@/lib/types'

interface CurseSeed {
  id: string
  name: string
}

const CURSE_CATALOG: CurseSeed[] = cursesSeed as CurseSeed[]

function curseName(ref: string): string {
  return CURSE_CATALOG.find((c) => c.id === ref)?.name ?? ref
}

type HistoryKind = 'received' | 'expired' | 'coin_drain' | 'intel_lost'

interface HistoryEntry {
  id: string
  kind: HistoryKind
  createdAt: string
  text: string
}

interface CurseHistoryListProps {
  events: GameEvent[]
  myTeamId: string
}

export function CurseHistoryList({
  events,
  myTeamId,
}: CurseHistoryListProps) {
  const entries = buildHistory(events, myTeamId).slice(0, 10)

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <h2 className="text-sm font-medium text-neutral-100">Curse history</h2>
      {entries.length === 0 ? (
        <p className="mt-2 text-xs text-neutral-500">No curse activity yet.</p>
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
              <span className={kindClass(entry.kind)}>{entry.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function buildHistory(
  events: GameEvent[],
  myTeamId: string,
): HistoryEntry[] {
  const out: HistoryEntry[] = []
  // Walk newest-first.
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (!e) continue
    const payload = e.payload as Record<string, unknown>
    const targetTeamId = pickString(payload, 'target_team_id')
    const teamId = pickString(payload, 'team_id')

    switch (e.type) {
      case 'curse_cast': {
        if (targetTeamId !== myTeamId) continue
        const ref = pickString(payload, 'curse_ref')
        if (!ref) continue
        out.push({
          id: e.id,
          kind: 'received',
          createdAt: e.created_at,
          text: `Curse received: ${curseName(ref)}`,
        })
        break
      }
      case 'curse_expired': {
        if (targetTeamId !== myTeamId) continue
        const ref = pickString(payload, 'curse_ref')
        if (!ref) continue
        out.push({
          id: e.id,
          kind: 'expired',
          createdAt: e.created_at,
          text: `Curse expired: ${curseName(ref)}`,
        })
        break
      }
      case 'coin_drain': {
        // Mirror the ledger semantics in BuyCurseResponse.ledger_effect:
        // the drained team is the curse target.
        const drainedTeam = targetTeamId ?? teamId
        if (drainedTeam !== myTeamId) continue
        const amount = pickNumber(payload, 'amount')
        out.push({
          id: e.id,
          kind: 'coin_drain',
          createdAt: e.created_at,
          text:
            amount != null
              ? `Coin drain: -${amount} coins`
              : 'Coin drain applied',
        })
        break
      }
      case 'intel_lost': {
        const lostTeam = targetTeamId ?? teamId
        if (lostTeam !== myTeamId) continue
        const ref = pickString(payload, 'intel_ref')
        out.push({
          id: e.id,
          kind: 'intel_lost',
          createdAt: e.created_at,
          text: ref ? `Intel lost: ${ref}` : 'Intel lost',
        })
        break
      }
      default:
        continue
    }
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

function kindClass(kind: HistoryKind): string {
  switch (kind) {
    case 'received':
      return 'text-orange-200'
    case 'expired':
      return 'text-neutral-400'
    case 'coin_drain':
      return 'text-amber-200'
    case 'intel_lost':
      return 'text-red-200'
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function formatClock(iso: string): string {
  const d = new Date(iso)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}
