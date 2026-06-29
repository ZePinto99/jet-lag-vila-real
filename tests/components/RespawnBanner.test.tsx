import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RespawnBanner } from '@/components/game/RespawnBanner'
import { makePlayer, renderWithProviders } from '../test-utils'

const gps = { lat: 41.295, lng: -7.746, accuracy: 5, updated_at: 1000 }

describe('RespawnBanner', () => {
  beforeEach(() => {
    window.localStorage.setItem('device_id', 'device-1')
  })

  it('does not render when the player is not respawning', () => {
    renderWithProviders(
      <RespawnBanner gameId="game-1" myPlayerId="player-1" myGps={gps} respawning={false} />,
    )

    expect(screen.queryByText('You were tagged.')).not.toBeInTheDocument()
  })

  it('disables confirmation until GPS is available', () => {
    renderWithProviders(
      <RespawnBanner gameId="game-1" myPlayerId="player-1" myGps={null} respawning />,
    )

    expect(screen.getByRole('button', { name: "I'm at a neutral landmark" })).toBeDisabled()
    expect(screen.getByText('Enable GPS to confirm position.')).toBeVisible()
  })

  it('posts respawn clear and calls onCleared', async () => {
    const player = makePlayer({ respawning: false })
    const onCleared = jest.fn()
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ player, cleared_at_neutral_ref: 'landmark.teatro' }),
        { status: 200 },
      ),
    )

    renderWithProviders(
      <RespawnBanner
        gameId="game-1"
        myPlayerId="player-1"
        myGps={gps}
        respawning
        onCleared={onCleared}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: "I'm at a neutral landmark" }))

    await waitFor(() => expect(onCleared).toHaveBeenCalledWith({
      player,
      cleared_at_neutral_ref: 'landmark.teatro',
    }))
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/games/game-1/respawn-clear',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          device_id: 'device-1',
          player_id: 'player-1',
          pos: gps,
        }),
      }),
    )
  })

  it('surfaces nearest neutral distance on 409 responses', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: 'not_at_neutral_landmark', details: { nearest_m: 87.3 } }),
        { status: 409 },
      ),
    )

    renderWithProviders(
      <RespawnBanner gameId="game-1" myPlayerId="player-1" myGps={gps} respawning />,
    )
    await userEvent.click(screen.getByRole('button', { name: "I'm at a neutral landmark" }))

    expect(await screen.findByText("You're ~87 m from the nearest neutral — keep walking.")).toBeVisible()
  })
})
