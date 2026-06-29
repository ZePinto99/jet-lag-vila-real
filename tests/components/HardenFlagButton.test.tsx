import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HardenFlagButton } from '@/components/game/HardenFlagButton'
import { makeLandmark, renderWithProviders } from '../test-utils'

describe('HardenFlagButton', () => {
  beforeEach(() => {
    window.localStorage.setItem('device_id', 'device-1')
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ landmark_ref: 'landmark.utad', team_coins: 0 }), {
        status: 200,
      }),
    )
  })

  it('disables when the team cannot afford the 150 coin harden cost', () => {
    renderWithProviders(
      <HardenFlagButton
        gameId="game-1"
        myPlayerId="player-1"
        gameStatus="live"
        myTeamLandmarks={[makeLandmark({ kind: 'flag_real' })]}
        teamCoins={149}
      />,
    )

    expect(screen.getByRole('button', { name: 'Harden flag · 150 coins' })).toBeDisabled()
    expect(screen.getByText('Costs 150 coins — you have 149')).toBeVisible()
  })

  it('uses translated confirmation controls and posts the real flag ref', async () => {
    renderWithProviders(
      <HardenFlagButton
        gameId="game-1"
        myPlayerId="player-1"
        gameStatus="live"
        myTeamLandmarks={[makeLandmark({ ref: 'landmark.utad', kind: 'flag_real' })]}
        teamCoins={150}
      />,
      { language: 'pt' },
    )

    await userEvent.click(screen.getByRole('button', { name: 'Harden flag · 150 coins' }))
    expect(await screen.findByRole('button', { name: /Cancelar/ })).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: /Confirmar · 150/ }))

    await waitFor(() => expect(screen.getByText('Flag challenge hardened.')).toBeVisible())
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/games/game-1/harden-flag',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          device_id: 'device-1',
          player_id: 'player-1',
          landmark_ref: 'landmark.utad',
        }),
      }),
    )
  })
})
