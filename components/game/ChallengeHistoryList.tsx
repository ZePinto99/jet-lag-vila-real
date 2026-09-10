'use client'

// ChallengeHistoryList — renders the team's completed challenges from the
// events log. Lives in the Status tab, below CurseHistoryList.
//
// Filters events of type 'challenge_completed' where payload.team_id matches
// the local team. Resolves challenge_ref to a location name via
// data/challenges.json. Shows the last 10 entries newest-first.

import challengesSeed from '@/data/challenges.json'
import { buildChallengeProofIndex, challengeProofUrl } from '@/lib/challenges/proofs'
import { useI18n } from '@/lib/i18n/context'
import { localizeCatalogField } from '@/lib/i18n/gameCatalog'
import type { Locale } from '@/lib/i18n/messages'
import type { ChallengeDefinition, GameEvent } from '@/lib/types'

const CHALLENGE_CATALOG: ChallengeDefinition[] = challengesSeed as ChallengeDefinition[]

function challengeLocation(ref: string, locale: Locale): string {
  const fallback = CHALLENGE_CATALOG.find((c) => c.id === ref)?.location_name ?? ref
  return localizeCatalogField(ref, 'location_name', fallback, locale)
}

interface HistoryEntry {
  id: string
  createdAt: string
  locationName: string
  rewardCoins: number | null
  bonusCoins: number | null
  firstBlood: boolean
  photoUrl: string | null
}

interface ChallengeHistoryListProps {
  events: GameEvent[]
  myTeamId: string
}

export function ChallengeHistoryList({ events, myTeamId }: ChallengeHistoryListProps) {
  const { t, locale } = useI18n()
  const entries = buildHistory(events, myTeamId, locale).slice(0, 10)

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <h2 className="text-sm font-medium text-neutral-100">{t('challenge.history_title')}</h2>
      {entries.length === 0 ? (
        <p className="mt-2 text-xs text-neutral-500">{t('challenge.history_empty')}</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex items-start gap-2 rounded px-2 py-1 text-xs odd:bg-neutral-900/40"
            >
              <span className="font-mono text-[10px] text-neutral-500">
                {formatClock(entry.createdAt)}
              </span>
              <span className="flex flex-1 flex-col text-emerald-200">
                <span>{entry.locationName}</span>
                {entry.photoUrl && (
                  <a
                    href={entry.photoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 w-fit text-[11px] text-sky-300 underline"
                  >
                    {t('challenge.view_photo')}
                  </a>
                )}
              </span>
              <span className="font-mono tabular-nums text-emerald-300">
                {entry.rewardCoins != null ? `+${entry.rewardCoins}` : ''}
                {entry.firstBlood && entry.bonusCoins != null
                  ? ` (+${entry.bonusCoins} ${t('status.first_blood')})`
                  : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function buildHistory(events: GameEvent[], myTeamId: string, locale: Locale): HistoryEntry[] {
  const out: HistoryEntry[] = []
  const proofIndex = buildChallengeProofIndex(events)
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
      locationName: challengeLocation(ref, locale),
      rewardCoins: pickNumber(payload, 'reward_coins'),
      bonusCoins: pickNumber(payload, 'bonus_coins'),
      firstBlood: pickBoolean(payload, 'first_blood') ?? false,
      photoUrl: challengeProofUrl(e, proofIndex),
    })
  }
  return out
}

function pickString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key]
  return typeof v === 'string' ? v : null
}

function pickNumber(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key]
  return typeof v === 'number' ? v : null
}

function pickBoolean(obj: Record<string, unknown>, key: string): boolean | null {
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
