'use client'

import { useState } from 'react'
import { apiPost } from '@/lib/api'
import { getDeviceId } from '@/lib/device'
import { useT } from '@/lib/i18n/context'
import { getActiveWeatherProposal } from '@/lib/weatherPause'
import type { Game, Team, WeatherPauseRequest, WeatherPauseResponse } from '@/lib/types'

interface WeatherPausePanelProps {
  game: Game
  myPlayerId: string
  myTeam: Team
  nowMs: number
  onGameUpdate: (game: Game) => void
  embedded?: boolean
}

export function WeatherPausePanel({
  game,
  myPlayerId,
  myTeam,
  nowMs,
  onGameUpdate,
  embedded = false,
}: WeatherPausePanelProps) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const action: WeatherPauseRequest['action'] = game.status === 'paused' ? 'resume' : 'pause'
  const proposal = getActiveWeatherProposal(game, nowMs)
  const requestedByMe = proposal?.requestedByTeamId === myTeam.id
  const requestedByOther = proposal != null && !requestedByMe

  async function vote() {
    if (busy || requestedByMe) return
    setBusy(true)
    setError(null)
    try {
      const body: WeatherPauseRequest = {
        device_id: getDeviceId(),
        player_id: myPlayerId,
        action,
      }
      const result = await apiPost<WeatherPauseResponse>(`/api/games/${game.id}/pause`, body)
      onGameUpdate(result.game)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.unknown_error'))
    } finally {
      setBusy(false)
    }
  }

  const buttonLabel = busy
    ? t('weather.saving')
    : requestedByMe
      ? action === 'pause'
        ? t('weather.pause_requested')
        : t('weather.resume_requested')
      : requestedByOther
        ? action === 'pause'
          ? t('weather.confirm_pause')
          : t('weather.confirm_resume')
        : action === 'pause'
          ? t('weather.request_pause')
          : t('weather.request_resume')

  return (
    <section
      className={
        embedded
          ? game.status === 'paused'
            ? 'bg-sky-950/90 px-4 py-3 text-sky-100'
            : 'bg-neutral-900/80 px-4 py-3 text-neutral-200'
          : requestedByOther
            ? 'border-b border-amber-500/70 bg-amber-950/90 px-4 py-3 text-amber-50'
          : game.status === 'paused'
            ? 'border-b border-sky-600 bg-sky-950/90 px-4 py-3 text-sky-100'
            : 'border-b border-neutral-800 bg-neutral-900/80 px-4 py-2 text-neutral-200'
      }
      aria-label={t('weather.title')}
    >
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold">
            {game.status === 'paused' ? t('weather.paused_title') : t('weather.title')}
          </p>
          <p className="mt-0.5 text-[11px] text-current opacity-75">
            {game.status === 'paused' ? t('weather.paused_body') : t('weather.two_team_hint')}
          </p>
          {proposal && (
            <p role="status" className="mt-1 text-[11px] font-medium text-amber-200">
              {requestedByMe ? t('weather.waiting_other') : t('weather.other_requested')}{' '}
              {t('weather.expires_in', { time: mmss(proposal.expiresAtMs - nowMs) })}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={vote}
          disabled={busy || requestedByMe}
          className="shrink-0 rounded-md bg-sky-200 px-3 py-2 text-xs font-semibold text-sky-950 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {buttonLabel}
        </button>
      </div>
      {error && (
        <p role="alert" className="mx-auto mt-2 max-w-3xl rounded bg-red-950/70 px-2 py-1 text-[11px] text-red-200">
          {error}
        </p>
      )}
    </section>
  )
}

function mmss(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return `${minutes}:${remainder < 10 ? '0' : ''}${remainder}`
}
