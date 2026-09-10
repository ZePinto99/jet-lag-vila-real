import type { ActiveCurse } from '@/lib/types'

export const PHOTO_VERIFIED_CURSE_REFS = new Set([
  'curse.single-file',
  'curse.photo-tax',
  'curse.outfit-swap',
  'curse.pose-patrol',
])

export interface CurseProofWindow {
  promptIndex: number
  secondsLeft: number
}

function numberParam(
  params: Record<string, unknown> | null | undefined,
  key: string,
  fallback: number,
): number {
  const value = params?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * Returns the proof slot that is open on the authoritative game clock.
 * Weather pauses shift both curse timestamps, so this remains frozen while a
 * game is paused and resumes at exactly the same point in the slot.
 */
export function getCurseProofWindow(
  curse: ActiveCurse,
  nowMs: number,
): CurseProofWindow | null {
  if (!PHOTO_VERIFIED_CURSE_REFS.has(curse.curse_ref)) return null

  const startedMs = new Date(curse.started_at).getTime()
  const expiresMs = curse.expires_at
    ? new Date(curse.expires_at).getTime()
    : null
  if (!Number.isFinite(startedMs) || nowMs < startedMs) return null
  if (expiresMs != null && nowMs >= expiresMs) return null

  const elapsedS = Math.floor((nowMs - startedMs) / 1000)

  if (
    curse.curse_ref === 'curse.photo-tax' ||
    curse.curse_ref === 'curse.pose-patrol'
  ) {
    const intervalS = Math.max(1, numberParam(curse.params, 'interval_seconds', 90))
    const windowS = Math.max(
      1,
      Math.min(intervalS, numberParam(curse.params, 'submission_window_seconds', 30)),
    )
    const intoInterval = elapsedS % intervalS
    if (intoInterval >= windowS) return null
    return {
      promptIndex: Math.floor(elapsedS / intervalS),
      secondsLeft: windowS - intoInterval,
    }
  }

  if (curse.curse_ref === 'curse.single-file') {
    const prompts = Math.max(1, Math.floor(numberParam(curse.params, 'prompts_per_curse', 2)))
    const durationS = Math.max(
      prompts,
      expiresMs == null ? 5 * 60 : Math.floor((expiresMs - startedMs) / 1000),
    )
    const segmentS = Math.max(1, Math.floor(durationS / prompts))
    const promptIndex = Math.min(prompts - 1, Math.floor(elapsedS / segmentS))
    const intoSegment = elapsedS - promptIndex * segmentS
    const windowS = Math.min(30, segmentS)
    if (intoSegment >= windowS) return null
    return { promptIndex, secondsLeft: windowS - intoSegment }
  }

  // Outfit Swap needs a before photo in the opening dispute window and an
  // after photo in the closing dispute window.
  const windowS = Math.max(1, numberParam(curse.params, 'dispute_window_seconds', 60))
  if (elapsedS < windowS) {
    return { promptIndex: 0, secondsLeft: windowS - elapsedS }
  }
  if (expiresMs != null) {
    const remainingS = Math.max(0, Math.ceil((expiresMs - nowMs) / 1000))
    if (remainingS <= windowS) {
      return { promptIndex: 1, secondsLeft: remainingS }
    }
  }
  return null
}
