import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WeatherPausePanel } from '@/components/game/WeatherPausePanel'
import { apiPost } from '@/lib/api'
import { makeGame, makeTeam, renderWithProviders } from '../test-utils'

jest.mock('@/lib/api', () => ({ apiPost: jest.fn() }))
jest.mock('@/lib/device', () => ({ getDeviceId: () => 'device-1' }))

const mockedPost = jest.mocked(apiPost)
const now = new Date('2026-08-27T12:00:00.000Z').getTime()

describe('WeatherPausePanel', () => {
  beforeEach(() => mockedPost.mockReset())

  it('requests a pause with the authenticated player identity', async () => {
    const game = makeGame()
    const updated = makeGame({
      config: {
        ...game.config,
        weather_pause: {
          proposal_action: 'pause',
          requested_by_team_id: 'team-west',
          requested_at: new Date(now).toISOString(),
        },
      },
    })
    const onGameUpdate = jest.fn()
    mockedPost.mockResolvedValue({
      game: updated,
      action: 'pause',
      pending: true,
      applied: false,
      already_applied: false,
    })

    renderWithProviders(
      <WeatherPausePanel
        game={game}
        myPlayerId="player-1"
        myTeam={makeTeam()}
        nowMs={now}
        onGameUpdate={onGameUpdate}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Request weather pause' }))

    expect(mockedPost).toHaveBeenCalledWith('/api/games/game-1/pause', {
      device_id: 'device-1',
      player_id: 'player-1',
      action: 'pause',
    })
    expect(onGameUpdate).toHaveBeenCalledWith(updated)
  })

  it('offers confirmation only to the other team for a live proposal', () => {
    const game = makeGame({
      config: {
        weather_pause: {
          proposal_action: 'pause',
          requested_by_team_id: 'team-west',
          requested_at: new Date(now).toISOString(),
        },
      },
    })
    renderWithProviders(
      <WeatherPausePanel
        game={game}
        myPlayerId="east-player"
        myTeam={makeTeam({ id: 'team-east', side: 'east' })}
        nowMs={now}
        onGameUpdate={jest.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Confirm weather pause' })).toBeEnabled()
    expect(screen.getByText(/other team requested this/i)).toBeVisible()
  })

  it('shows frozen-timer status and the two-key resume action while paused', () => {
    const game = makeGame({
      status: 'paused',
      config: {
        weather_pause: {
          prior_status: 'live',
          paused_at: new Date(now).toISOString(),
        },
      },
    })
    renderWithProviders(
      <WeatherPausePanel
        game={game}
        myPlayerId="player-1"
        myTeam={makeTeam()}
        nowMs={now}
        onGameUpdate={jest.fn()}
      />,
    )

    expect(screen.getByText('Weather pause — Paused')).toBeVisible()
    expect(screen.getByText(/match clock, and curse timers are frozen/i)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Request resume' })).toBeEnabled()
  })

  it('localises the paused state and resume control in PT-PT', () => {
    const game = makeGame({
      status: 'paused',
      config: { weather_pause: { paused_at: new Date(now).toISOString() } },
    })
    renderWithProviders(
      <WeatherPausePanel
        game={game}
        myPlayerId="player-1"
        myTeam={makeTeam()}
        nowMs={now}
        onGameUpdate={jest.fn()}
      />,
      { language: 'pt' },
    )

    expect(screen.getByText('Pausa meteorológica — Em pausa')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Pedir retoma' })).toBeEnabled()
  })
})
