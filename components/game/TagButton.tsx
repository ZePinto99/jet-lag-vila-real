'use client'

// Tag button (rulebook §6). Renders the result of useTagButton: a large
// pulsing button when enabled, a greyed-out one with a reason underneath
// otherwise. On tap, asks for confirmation, then POSTs to /api/games/[id]/tag
// with the local list of presence-derived targets.

import { useState } from 'react'
import { apiPost } from '@/lib/api'
import { cn } from '@/lib/cn'
import { getDeviceId } from '@/lib/device'
import type {
  GpsPosition,
  TagRequest,
  TagResponse,
} from '@/lib/types'
import type {
  TagDisabledReason,
  TagTarget,
} from '@/lib/hooks/useTagButton'

interface TagButtonProps {
  gameId: string
  myPlayerId: string
  myGpsPos: GpsPosition | null
  meState: {
    enabled: boolean
    targets: TagTarget[]
    reason: TagDisabledReason
    inDefenseZone: boolean
  }
  onTagSuccess?: (result: TagResponse) => void
}

function reasonLabel(reason: TagDisabledReason): string {
  switch (reason) {
    case 'no_gps':
      return 'Enable GPS to tag'
    case 'respawning':
      return 'You are respawning'
    case 'out_of_zone':
      return 'Not in your defense zone'
    case 'no_enemies_nearby':
      return 'No enemies within 5 m'
    case 'camping_locked':
      return 'Camping locked — leave own landmark to reset'
    case 'enabled':
    default:
      return ''
  }
}

export function TagButton({
  gameId,
  myPlayerId,
  myGpsPos,
  meState,
  onTagSuccess,
}: TagButtonProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<TagResponse | null>(null)

  const { enabled, targets, reason } = meState
  const targetCount = targets.length

  async function handleTap() {
    if (!enabled || !myGpsPos || busy) return
    const confirmMsg =
      targetCount === 1
        ? 'Tag 1 player?'
        : `Tag ${targetCount} players?`
    if (typeof window !== 'undefined' && !window.confirm(confirmMsg)) return

    setBusy(true)
    setError(null)
    setLastResult(null)

    const body: TagRequest = {
      device_id: getDeviceId(),
      tagger_player_id: myPlayerId,
      tagger_pos: myGpsPos,
      targets: targets.map((t) => ({ player_id: t.player_id, pos: t.pos })),
    }

    try {
      const res = await apiPost<TagResponse>(
        `/api/games/${gameId}/tag`,
        body,
      )
      setLastResult(res)
      onTagSuccess?.(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown_error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pointer-events-auto flex w-full flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={handleTap}
        disabled={!enabled || busy}
        className={cn(
          // Base
          'w-full max-w-sm rounded-2xl px-6 py-4 text-base font-semibold uppercase tracking-wider shadow-lg transition focus:outline-none',
          enabled
            ? 'animate-pulse bg-red-600 text-white shadow-red-900/40 hover:bg-red-500 focus-visible:ring-2 focus-visible:ring-red-300'
            : 'cursor-not-allowed bg-neutral-800 text-neutral-500 shadow-none',
          busy && 'opacity-75',
        )}
        aria-label={
          enabled
            ? `Tag ${targetCount} player${targetCount === 1 ? '' : 's'} within 5 metres`
            : 'Tag button disabled'
        }
      >
        {enabled
          ? `TAG (${targetCount} within 5 m)`
          : 'TAG'}
      </button>
      {!enabled && (
        <p className="rounded bg-neutral-950/80 px-2 py-0.5 text-[11px] text-neutral-400">
          {reasonLabel(reason)}
        </p>
      )}
      {lastResult && (
        <p className="rounded bg-emerald-950/80 px-2 py-0.5 text-[11px] text-emerald-200">
          {lastResult.tagged_player_ids.length === 0
            ? 'No tags landed.'
            : `Tagged ${lastResult.tagged_player_ids.length} player${lastResult.tagged_player_ids.length === 1 ? '' : 's'}.`}
          {lastResult.rejected.length > 0
            ? ` (${lastResult.rejected.length} rejected)`
            : ''}
        </p>
      )}
      {error && (
        <p className="rounded bg-red-950/80 px-2 py-0.5 text-[11px] text-red-200">
          {error}
        </p>
      )}
    </div>
  )
}
