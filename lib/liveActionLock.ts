interface LiveActionLockInput {
  weatherPaused: boolean
  weatherLabel: string
  curseLocked: boolean
  curseLabel: string | null
  respawning: boolean
  respawnLabel: string
}

export interface LiveActionLock {
  /** Lock passed to every regular gameplay/chat action. */
  actionsLocked: boolean
  lockedLabel: string | null
  /** Independent phase/curse lock for the RespawnBanner CTA itself. */
  respawnLockedLabel: string | null
}

export function resolveLiveActionLock({
  weatherPaused,
  weatherLabel,
  curseLocked,
  curseLabel,
  respawning,
  respawnLabel,
}: LiveActionLockInput): LiveActionLock {
  const independentLabel = weatherPaused
    ? weatherLabel
    : curseLocked
      ? curseLabel
      : null
  return {
    actionsLocked: weatherPaused || curseLocked || respawning,
    lockedLabel: independentLabel ?? (respawning ? respawnLabel : null),
    // Being respawning must disable everything except the action that advances
    // the two-stage respawn journey.
    respawnLockedLabel: independentLabel,
  }
}
