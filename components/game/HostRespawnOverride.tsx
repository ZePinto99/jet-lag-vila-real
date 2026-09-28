'use client'

// Finding P7, second exit — the host override.
//
// Migration 0055 added TWO ways out of a stuck respawn: a 10-minute grace sweep
// (sweep_stuck_respawns, on the 30 s pg_cron job) and this one. The route
// (/host-clear-respawn) and the RPC (host_clear_respawn_atomic) shipped with no
// caller anywhere in the app, so RULEBOOK §6's promise that "the lobby host can
// release the player immediately from the app" had no button behind it — half the
// fix was dead code. This is that button.
//
// Only rendered to the host, and only while at least one teammate or opponent is
// actually respawning, so it never adds noise to a normal game. The server
// re-checks host authority and binds the claimed host_player_id to the calling
// device, so this component cannot grant itself permission.

import { useCallback, useState } from 'react'
import { apiPost } from '@/lib/api'
import { getDeviceId } from '@/lib/device'
import { useT } from '@/lib/i18n/context'
import type { Player } from '@/lib/types'

interface HostRespawnOverrideProps {
  gameId: string
  myPlayerId: string
  isHost: boolean
  players: Player[]
  onPlayerUpdate?: (player: Player) => void
}

export function HostRespawnOverride({
  gameId,
  myPlayerId,
  isHost,
  players,
  onPlayerUpdate,
}: HostRespawnOverrideProps) {
  const t = useT()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  // L1 (migration 0057): the server refuses to clear anyone on the host's own
  // team — including the host — because an instant, repeatable self-release made
  // the host immune to the tag. Filter them out here too, so the UI never offers
  // a button that is guaranteed to be refused.
  const myTeamId = players.find((p) => p.id === myPlayerId)?.team_id ?? null
  const stuck = players.filter((p) => p.respawning && p.team_id !== myTeamId)

  const release = useCallback(
    async (targetPlayerId: string) => {
      setBusyId(targetPlayerId)
      setError(null)
      try {
        const res = await apiPost<{ player: Player }>(
          `/api/games/${gameId}/host-clear-respawn`,
          {
            device_id: getDeviceId(),
            host_player_id: myPlayerId,
            target_player_id: targetPlayerId,
          },
        )
        if (res.player) onPlayerUpdate?.(res.player)
        setConfirmingId(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'host_clear_respawn_failed')
      } finally {
        setBusyId(null)
      }
    },
    [gameId, myPlayerId, onPlayerUpdate],
  )

  // Nothing to show unless the viewer is the host AND someone is stuck.
  if (!isHost || stuck.length === 0) return null

  return (
    <section className="rounded border border-amber-800/50 bg-amber-950/30 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-200">
        {t('host_respawn.title')}
      </h3>
      <p className="mt-1 text-[11px] text-amber-200/70">{t('host_respawn.hint')}</p>
      <ul className="mt-2 space-y-1.5">
        {stuck.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 text-xs">
            <span className="text-amber-50">
              {p.display_name}
              {p.respawn_arrived ? ` — ${t('host_respawn.arrived')}` : ''}
            </span>
            {confirmingId === p.id ? (
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => release(p.id)}
                  disabled={busyId === p.id}
                  className="rounded bg-amber-600 px-2 py-0.5 text-[11px] font-semibold text-neutral-950 disabled:opacity-60"
                >
                  {busyId === p.id ? t('host_respawn.releasing') : t('host_respawn.confirm')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingId(null)}
                  disabled={busyId === p.id}
                  className="rounded px-2 py-0.5 text-[11px] text-amber-200/70"
                >
                  {t('host_respawn.cancel')}
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingId(p.id)}
                className="rounded border border-amber-700 px-2 py-0.5 text-[11px] text-amber-100"
              >
                {t('host_respawn.release')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p className="mt-2 rounded bg-red-950/60 px-2 py-1 text-[11px] text-red-200">
          {t('host_respawn.failed', { reason: error })}
        </p>
      )}
    </section>
  )
}
