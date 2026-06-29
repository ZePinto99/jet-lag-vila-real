import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TagButton } from '@/components/game/TagButton'
import { renderWithProviders } from '../test-utils'

const gps = { lat: 41.295, lng: -7.746, accuracy: 5, updated_at: 1000 }
const enabledState = {
  enabled: true,
  targets: [{ player_id: 'enemy-1', pos: gps }],
  reason: 'enabled' as const,
  inDefenseZone: true,
}

describe('TagButton', () => {
  beforeEach(() => {
    window.localStorage.setItem('device_id', 'device-1')
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ tagged_player_ids: ['enemy-1'], rejected: [] }),
        { status: 200 },
      ),
    )
  })

  it('renders disabled reason when tag eligibility is false', () => {
    renderWithProviders(
      <TagButton
        gameId="game-1"
        myPlayerId="player-1"
        myGpsPos={null}
        meState={{
          enabled: false,
          targets: [],
          reason: 'no_gps',
          inDefenseZone: false,
        }}
      />,
    )

    expect(screen.getByRole('button', { name: 'Tag button disabled' })).toBeDisabled()
    expect(screen.getByText('Enable GPS to tag')).toBeVisible()
  })

  it('posts tag targets and reports success', async () => {
    const onTagSuccess = jest.fn()
    renderWithProviders(
      <TagButton
        gameId="game-1"
        myPlayerId="player-1"
        myGpsPos={gps}
        meState={enabledState}
        onTagSuccess={onTagSuccess}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: /Tag 1 player/ }))

    await waitFor(() => expect(onTagSuccess).toHaveBeenCalled())
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/games/game-1/tag',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          device_id: 'device-1',
          tagger_player_id: 'player-1',
          tagger_pos: gps,
          targets: [{ player_id: 'enemy-1', pos: gps }],
        }),
      }),
    )
    expect(screen.getByText('Tagged 1 player.')).toBeVisible()
  })

  it('honors an action lock label over normal eligibility', () => {
    renderWithProviders(
      <TagButton
        gameId="game-1"
        myPlayerId="player-1"
        myGpsPos={gps}
        meState={enabledState}
        lockedLabel="Actions locked — Full Stop in effect"
      />,
    )

    expect(screen.getByRole('button', { name: 'Tag button disabled' })).toBeDisabled()
    expect(screen.getByText('Actions locked — Full Stop in effect')).toBeVisible()
  })
})
