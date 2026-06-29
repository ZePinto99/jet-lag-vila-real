import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GameOverOverlay } from '@/components/game/GameOverOverlay'
import { makeEvent, makePlayer, makeTeam, renderWithProviders } from '../test-utils'

describe('GameOverOverlay', () => {
  it('renders winner, score rows, recent events, and timeline callback', async () => {
    const onViewTimeline = jest.fn()
    const west = makeTeam({ id: 'west', side: 'west', coins: 100 })
    const east = makeTeam({ id: 'east', side: 'east', coins: 0 })
    const player = makePlayer({ id: 'player-1', team_id: west.id, display_name: 'Alex' })
    const events = [
      makeEvent({ id: 'challenge', type: 'challenge_completed', payload: { team_id: west.id, challenge_ref: 'challenge.test' } }),
      makeEvent({ id: 'won', type: 'game_won', payload: { winner_team_id: west.id, reason: 'flag_returned' } }),
    ]

    renderWithProviders(
      <GameOverOverlay
        events={events}
        teams={[west, east]}
        players={[player]}
        myTeamId={west.id}
        onViewTimeline={onViewTimeline}
      />,
    )

    expect(screen.getByText('Game over')).toBeVisible()
    expect(screen.getByText('Team West wins!')).toBeVisible()
    expect(screen.getByText('Congratulations.')).toBeVisible()
    expect(screen.getAllByText('Challenges completed')[0]).toBeVisible()
    expect(screen.getByText(/Team West completed challenge.test/)).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'View full timeline' }))
    expect(onViewTimeline).toHaveBeenCalled()
  })
})
