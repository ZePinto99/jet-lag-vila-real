import type { Game, WeatherPauseRequest } from '@/lib/types'

export const WEATHER_PROPOSAL_WINDOW_MS = 5 * 60_000

export interface ActiveWeatherProposal {
  action: WeatherPauseRequest['action']
  requestedByTeamId: string | null
  expiresAtMs: number
}

/** Resolve the currently actionable two-team weather proposal, if any. */
export function getActiveWeatherProposal(
  game: Game,
  nowMs: number,
): ActiveWeatherProposal | null {
  const action: WeatherPauseRequest['action'] =
    game.status === 'paused' ? 'resume' : 'pause'
  const state = game.config.weather_pause
  if (state?.proposal_action !== action || !state.requested_at) return null

  const requestedAtMs = new Date(state.requested_at).getTime()
  if (!Number.isFinite(requestedAtMs)) return null
  const expiresAtMs = requestedAtMs + WEATHER_PROPOSAL_WINDOW_MS
  if (expiresAtMs <= nowMs) return null

  return {
    action,
    requestedByTeamId: state.requested_by_team_id ?? null,
    expiresAtMs,
  }
}

export function weatherProposalNeedsConfirmation(
  game: Game,
  myTeamId: string,
  nowMs: number,
): boolean {
  const proposal = getActiveWeatherProposal(game, nowMs)
  return proposal != null && proposal.requestedByTeamId !== myTeamId
}
