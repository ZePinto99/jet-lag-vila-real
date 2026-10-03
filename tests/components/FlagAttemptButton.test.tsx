import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FlagAttemptButton } from '@/components/game/FlagAttemptButton'
import { renderWithProviders } from '../test-utils'

const gps = {
  lat: 41.2963268,
  lng: -7.7465163,
  accuracy: 5,
  updated_at: 1000,
}
const target = {
  id: 'enemy-se',
  ref: 'landmark.se-catedral',
  lat: gps.lat,
  lng: gps.lng,
  team_id: 'east',
}

const enabledState = {
  enabled: true,
  visible: true,
  target,
  distance_m: 4,
  reason: 'enabled' as const,
}

describe('FlagAttemptButton', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }))
  })

  it('renders the attempt flow in PT-PT', async () => {
    renderWithProviders(
      <FlagAttemptButton
        gameId="game-1"
        myPlayerId="player-1"
        myGpsPos={gps}
        meState={enabledState}
      />,
      { language: 'pt' },
    )

    await userEvent.click(screen.getByRole('button', { name: /Tentar bandeira em Sé Catedral/i }))

    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Submeter' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Tirar \/ escolher foto/i })).toBeVisible()
  })

  it('uses a compact approach hint instead of a disabled full-size action', () => {
    renderWithProviders(
      <FlagAttemptButton
        gameId="game-1"
        myPlayerId="player-1"
        myGpsPos={gps}
        meState={{
          enabled: false,
          visible: true,
          target,
          distance_m: 64,
          reason: 'no_landmark_in_range',
        }}
      />,
      { language: 'pt' },
    )

    expect(
      screen.getByText(/Local adversário próximo · Sé Catedral de Vila Real · 64 m/),
    ).toBeVisible()
    expect(screen.queryByRole('button', { name: /desativado/i })).not.toBeInTheDocument()
  })

  it('keeps the photo draft while GPS reacquires after the native camera', async () => {
    const onPanelOpenChange = jest.fn()
    const view = renderWithProviders(
      <FlagAttemptButton
        gameId="game-1"
        myPlayerId="player-1"
        myGpsPos={gps}
        meState={enabledState}
        onPanelOpenChange={onPanelOpenChange}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /Attempt flag at Sé Catedral/i }))
    const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()
    await userEvent.upload(input!, new File(['photo'], 'flag-proof.jpg', { type: 'image/jpeg' }))

    view.rerender(
      <FlagAttemptButton
        gameId="game-1"
        myPlayerId="player-1"
        myGpsPos={gps}
        meState={{
          enabled: false,
          visible: false,
          target: null,
          distance_m: null,
          reason: 'no_gps',
        }}
        onPanelOpenChange={onPanelOpenChange}
      />,
    )

    expect(screen.getByText(/flag-proof\.jpg/)).toBeVisible()
    expect(screen.getByText(/your photo and answer are safe/i)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()

    view.rerender(
      <FlagAttemptButton
        gameId="game-1"
        myPlayerId="player-1"
        myGpsPos={{ ...gps, updated_at: 2000 }}
        meState={enabledState}
        onPanelOpenChange={onPanelOpenChange}
      />,
    )
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled()
  })
})
