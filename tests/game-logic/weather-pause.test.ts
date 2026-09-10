/** @jest-environment node */

import {
  getActiveWeatherProposal,
  weatherProposalNeedsConfirmation,
} from '@/lib/weatherPause'
import { makeGame } from '../test-utils'

const now = new Date('2026-08-31T12:00:00.000Z').getTime()

describe('weather pause proposal state', () => {
  it('surfaces a live request only to the other team', () => {
    const game = makeGame({
      config: {
        weather_pause: {
          proposal_action: 'pause',
          requested_by_team_id: 'team-west',
          requested_at: new Date(now - 30_000).toISOString(),
        },
      },
    })

    expect(getActiveWeatherProposal(game, now)?.action).toBe('pause')
    expect(weatherProposalNeedsConfirmation(game, 'team-west', now)).toBe(false)
    expect(weatherProposalNeedsConfirmation(game, 'team-east', now)).toBe(true)
  })

  it('does not surface expired or wrong-phase proposals', () => {
    const expired = makeGame({
      config: {
        weather_pause: {
          proposal_action: 'pause',
          requested_by_team_id: 'team-west',
          requested_at: new Date(now - 5 * 60_000).toISOString(),
        },
      },
    })
    const pausedWithOldPauseProposal = makeGame({
      status: 'paused',
      config: {
        weather_pause: {
          proposal_action: 'pause',
          requested_by_team_id: 'team-west',
          requested_at: new Date(now - 30_000).toISOString(),
        },
      },
    })

    expect(getActiveWeatherProposal(expired, now)).toBeNull()
    expect(getActiveWeatherProposal(pausedWithOldPauseProposal, now)).toBeNull()
  })
})
