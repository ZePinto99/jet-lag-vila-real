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

    expect(screen.getByRole('button', { name: /I've reached the assigned neutral landmark/ })).toBeDisabled()
    expect(screen.getByText('Enable GPS to confirm position.')).toBeVisible()
  })

  it('keeps the respawn CTA enabled when respawning is the only global action lock', () => {
    renderWithProviders(
      <RespawnBanner
        gameId="game-1"
        myPlayerId="player-1"
        myGps={gps}
        respawning
        respawnTargetRef="landmark.largo-do-pelourinho"
        lockedLabel={null}
      />,
    )

    expect(
      screen.getByRole('button', { name: "I've reached Largo do Pelourinho" }),
    ).toBeEnabled()
  })

  it('posts respawn clear and calls onCleared', async () => {
    const player = makePlayer({ respawning: false, respawn_target_ref: null })
    const onCleared = jest.fn()
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ player, stage: 'cleared', respawn_target_ref: 'landmark.largo-do-pelourinho' }),
        { status: 200 },
      ),
    )

    renderWithProviders(
      <RespawnBanner
        gameId="game-1"
        myPlayerId="player-1"
        myGps={gps}
        respawning
        respawnTargetRef="landmark.largo-do-pelourinho"
        onCleared={onCleared}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: "I've reached Largo do Pelourinho" }))

    await waitFor(() => expect(onCleared).toHaveBeenCalledWith({
      player,
      stage: 'cleared',
      respawn_target_ref: 'landmark.largo-do-pelourinho',
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

  it('surfaces the exact required target when the player tries the wrong neutral', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'wrong_respawn_landmark',
          details: {
            required_ref: 'landmark.largo-do-pelourinho',
            required_name: 'Largo do Pelourinho',
            distance_m: 87.3,
          },
        }),
        { status: 409 },
      ),
    )

    renderWithProviders(
      <RespawnBanner
        gameId="game-1"
        myPlayerId="player-1"
        myGps={gps}
        respawning
        respawnTargetRef="landmark.largo-do-pelourinho"
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: "I've reached Largo do Pelourinho" }))

    expect(await screen.findByText('Wrong neutral — go to Largo do Pelourinho (87 m away).')).toBeVisible()
  })

  it('switches to leave-radius instructions after arrival and respects action locks', () => {
    renderWithProviders(
      <RespawnBanner
        gameId="game-1"
        myPlayerId="player-1"
        myGps={gps}
        respawning
        respawnTargetRef="landmark.largo-do-pelourinho"
        respawnArrived
        lockedLabel="Game paused for weather"
      />,
    )

    expect(screen.getByText(/Arrival confirmed at Largo do Pelourinho/)).toBeVisible()
    expect(screen.getByRole('button', { name: "I've left Largo do Pelourinho" })).toBeDisabled()
    expect(screen.getByText('Game paused for weather')).toBeVisible()
  })

  it('localises the target-specific arrival journey in PT-PT', () => {
    renderWithProviders(
      <RespawnBanner
        gameId="game-1"
        myPlayerId="player-1"
        myGps={gps}
        respawning
        respawnTargetRef="landmark.largo-do-pelourinho"
      />,
      { language: 'pt' },
    )

    expect(screen.getByText('Foste apanhado.')).toBeVisible()
    expect(screen.getByText(/ponto de respawn obrigatório é Largo do Pelourinho/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Cheguei a Largo do Pelourinho' })).toBeEnabled()
  })
})
