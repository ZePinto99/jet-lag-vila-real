'use client'

// Tag button (rulebook §6). The live HUD mounts it only when a legal target is
// present, so it becomes a large reflex action without permanently covering
// the map. On tap it POSTs the presence-derived targets to /api/games/[id]/tag;
// the server revalidates every coordinate.

import { useState } from 'react'
import { apiPost } from '@/lib/api'
import { cn } from '@/lib/cn'
import { getDeviceId } from '@/lib/device'
import { useT } from '@/lib/i18n/context'
import type { GpsPosition, TagRequest, TagResponse } from '@/lib/types'
import { TAG_RADIUS_M, type TagDisabledReason, type TagTarget } from '@/lib/hooks/useTagButton'

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
  /** When set (e.g. Full Stop curse active), the button is forced off and this
   *  label is shown as the reason. */
  lockedLabel?: string | null
  onTagSuccess?: (result: TagResponse) => void
}

function reasonLabelKey(reason: TagDisabledReason): string | null {
  switch (reason) {
    case 'no_gps':
      return 'tag.reason_no_gps'
    case 'respawning':
      return 'tag.reason_respawning'
    case 'out_of_zone':
      return 'tag.reason_out_of_zone'
    case 'no_enemies_nearby':
      return 'tag.reason_no_enemies'
    case 'camping_locked':
      return 'tag.reason_camping'
    case 'enabled':
    default:
      return null
  }
}

// A tag that applied nothing must always name its cause (P12). The server's
// rejection reasons are not all equally legible, and `batch_aborted` in
// particular used to render as nothing at all: the defender saw "no tags
// landed" while a teammate's tag on the same raider had succeeded.
//
// The two reasons a player actually needs to tell apart:
//   already_respawning — that one target was already down; nothing to do.
//   batch_aborted      — a mid-flight change rolled the WHOLE batch back, so
//                        nothing was applied anywhere and tapping again works.
const REJECT_REASON_KEYS: Record<string, string> = {
  already_respawning: 'tag.reject_already_respawning',
  batch_aborted: 'tag.reject_batch_aborted',
  out_of_range: 'tag.reject_out_of_range',
  stale_position: 'tag.reject_stale_position',
  target_not_raider: 'tag.reject_target_not_raider',
  wrong_team_or_missing: 'tag.reject_wrong_team_or_missing',
}

/**
 * Picks the one rejection message to show. On a `batch_aborted` result the route
 * labels the target whose state changed `already_respawning` and every innocent
 * target `batch_aborted`; the batch-level explanation is the useful one, so it
 * wins whenever it is present. A lone `already_respawning` — the single-target
 * tap — reads as the plain "they were already down".
 */
export function tagRejectionMessage(
  rejected: ReadonlyArray<{ reason: string }>,
  t: (key: string, tokens?: Record<string, string | number>) => string,
): string | null {
  if (rejected.length === 0) return null
  const reasons = new Set(rejected.map((r) => r.reason))
  const reason = reasons.has('batch_aborted') ? 'batch_aborted' : (rejected[0]?.reason ?? '')
  const key = REJECT_REASON_KEYS[reason]
  return key ? t(key) : t('tag.reject_generic', { reason })
}

export function TagButton({
  gameId,
  myPlayerId,
  myGpsPos,
  meState,
  lockedLabel,
  onTagSuccess,
}: TagButtonProps) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<TagResponse | null>(null)

  const locked = Boolean(lockedLabel)
  const { targets, reason } = meState
  const enabled = meState.enabled && !locked
  const targetCount = targets.length
  const reasonKey = reasonLabelKey(reason)
  const landed = lastResult?.tagged_player_ids.length ?? 0
  const rejectionMessage = lastResult ? tagRejectionMessage(lastResult.rejected, t) : null

  async function handleTap() {
    if (!enabled || !myGpsPos || busy) return
    // No confirm dialog: tagging is a reflex action (the button only lights up
    // when a valid enemy is inside the 5 m radius, and the server re-validates
    // proximity), and native window.confirm is unreliable in installed PWAs —
    // it silently returned false and ate the tap. See PLAYTEST_TRIAGE P0-3.

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
      const res = await apiPost<TagResponse>(`/api/games/${gameId}/tag`, body)
      setLastResult(res)
      onTagSuccess?.(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown_error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pointer-events-none flex w-full max-w-sm flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={handleTap}
        disabled={!enabled || busy}
        className={cn(
          // Base
          'pointer-events-auto w-full rounded-2xl px-6 py-4 text-base font-semibold uppercase tracking-wider shadow-lg transition focus:outline-none',
          enabled
            ? 'animate-pulse bg-red-600 text-white shadow-red-900/40 hover:bg-red-500 focus-visible:ring-2 focus-visible:ring-red-300'
            : 'cursor-not-allowed bg-neutral-800 text-neutral-500 shadow-none',
          busy && 'opacity-75',
        )}
        aria-label={
          enabled
            ? t(targetCount === 1 ? 'tag.aria_enabled_one' : 'tag.aria_enabled_many', {
                n: targetCount,
                m: TAG_RADIUS_M,
              })
            : t('tag.aria_disabled')
        }
      >
        {enabled
          ? t('tag.button_enabled', { n: targetCount, m: TAG_RADIUS_M })
          : t('tag.button_disabled')}
      </button>
      {!enabled && (
        <p className="rounded bg-neutral-950/80 px-2 py-0.5 text-[11px] text-neutral-400">
          {locked ? lockedLabel : reasonKey ? t(reasonKey) : ''}
        </p>
      )}
      {lastResult && (
        <div
          className={cn(
            'rounded px-2 py-0.5 text-[11px]',
            landed > 0 ? 'bg-emerald-950/80 text-emerald-200' : 'bg-amber-950/80 text-amber-100',
          )}
        >
          <p>
            {landed === 0
              ? t('tag.result_none')
              : t(landed === 1 ? 'tag.result_tagged_one' : 'tag.result_tagged_many', { n: landed })}
            {lastResult.rejected.length > 0
              ? ` ${t('tag.result_rejected_count', { n: lastResult.rejected.length })}`
              : ''}
            {/* 0058: say what the tag actually cost them. The fine is clamped at
                the raiding team's balance, so 0 means they had nothing left to
                take — worth stating rather than implying the tag did nothing. */}
            {landed > 0
              ? ` ${
                  lastResult.coins_drained > 0
                    ? t('tag.result_fined', { c: lastResult.coins_drained })
                    : t('tag.result_fined_broke')
                }`
              : ''}
          </p>
          {/* P12: name the cause. Without this, an aborted batch rendered as a
              bare "No tags landed." with no explanation at all. */}
          {rejectionMessage && <p className="mt-0.5">{rejectionMessage}</p>}
        </div>
      )}
      {error && (
        <p className="rounded bg-red-950/80 px-2 py-0.5 text-[11px] text-red-200">
          {t('tag.action_error')}
        </p>
      )}
    </div>
  )
}
