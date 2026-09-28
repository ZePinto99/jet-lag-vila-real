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

  // P7: nothing clears the respawn state except walking there and confirming —
  // no respawning_since, no timeout, no override. A player whose GPS will not
  // confirm is stuck for the rest of the game AND action-locked throughout, so
  // the banner has to state the lock, the live distance, and the only exit.
  describe('stuck-player clarity (P7)', () => {
    // Largo do Pelourinho, from data/landmarks.json.
    const pelourinho = { lat: 41.29624, lng: -7.7458 }

    it('states the action lock and names both timeout fallbacks', () => {
      renderWithProviders(
        <RespawnBanner
          gameId="game-1"
          myPlayerId="player-1"
          myGps={gps}
          respawning
          respawnTargetRef="landmark.largo-do-pelourinho"
        />,
      )

      expect(
        screen.getByText('You cannot tag, buy, or complete anything until this is done.'),
      ).toBeVisible()
      // Must name BOTH 0055 fallbacks. The previous assertion pinned the old
      // copy ("This does not time out… nothing else clears it"), which 0055 made
      // false — a test enforcing a lie to the player.
      expect(
        screen.getByText(/clears on its own after 10 minutes, or the host can release you/),
      ).toBeVisible()
    })

    it('shows the live distance to the exact assigned landmark', () => {
      renderWithProviders(
        <RespawnBanner
          gameId="game-1"
          myPlayerId="player-1"
          myGps={{ ...pelourinho, accuracy: 5, updated_at: 1000 }}
          respawning
          respawnTargetRef="landmark.largo-do-pelourinho"
        />,
      )

      expect(screen.getByText('0 m to Largo do Pelourinho')).toBeVisible()
    })

    it('reports distance as unavailable without GPS instead of showing a wrong number', () => {
      renderWithProviders(
        <RespawnBanner
          gameId="game-1"
          myPlayerId="player-1"
          myGps={null}
          respawning
          respawnTargetRef="landmark.largo-do-pelourinho"
        />,
      )

      expect(screen.getByText('Distance unavailable — waiting for a GPS fix.')).toBeVisible()
      expect(screen.queryByText(/m to Largo do Pelourinho/)).not.toBeInTheDocument()
    })

    it('inverts the distance goal after arrival, counting the metres still needed', () => {
      renderWithProviders(
        <RespawnBanner
          gameId="game-1"
          myPlayerId="player-1"
          myGps={{ ...pelourinho, accuracy: 5, updated_at: 1000 }}
          respawning
          respawnTargetRef="landmark.largo-do-pelourinho"
          respawnArrived
        />,
      )

      // Standing on the landmark: all 45 m of the leave radius still to walk.
      expect(
        screen.getByText('0 m from Largo do Pelourinho — 45 m needed.'),
      ).toBeVisible()
    })

    it('confirms readiness once far enough away in the leave stage', () => {
      renderWithProviders(
        <RespawnBanner
          gameId="game-1"
          myPlayerId="player-1"
          myGps={gps}
          respawning
          respawnTargetRef="landmark.largo-do-pelourinho"
          respawnArrived
        />,
      )

      expect(
        screen.getByText('Far enough from Largo do Pelourinho — confirm to rejoin.'),
      ).toBeVisible()
    })

    it('only offers GPS recovery advice after a confirm actually fails', async () => {
      renderWithProviders(
        <RespawnBanner
          gameId="game-1"
          myPlayerId="player-1"
          myGps={gps}
          respawning
          respawnTargetRef="landmark.largo-do-pelourinho"
        />,
      )
      // Not shown while nothing has failed yet — it would just be noise.
      expect(screen.queryByText(/If GPS will not confirm you/)).not.toBeInTheDocument()

      global.fetch = jest.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: 'not_at_respawn_landmark',
            details: {
              required_name: 'Largo do Pelourinho',
              distance_m: 120,
            },
          }),
          { status: 409 },
        ),
      )
      await userEvent.click(screen.getByRole('button', { name: "I've reached Largo do Pelourinho" }))

      expect(
        await screen.findByText(
          'If GPS will not confirm you at Largo do Pelourinho, walk a few steps and try again, or agree it with the other team.',
        ),
      ).toBeVisible()
    })

    it('localises the lock and timeout-fallback copy in PT-PT', () => {
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

      expect(
        screen.getByText('Não podes apanhar, comprar nem concluir nada até isto estar feito.'),
      ).toBeVisible()
      expect(
        screen.getByText(/resolve-se sozinho após 10 minutos, ou o anfitrião pode libertar-te/),
      ).toBeVisible()
    })
  })
})
