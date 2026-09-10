import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GameOverOverlay } from '@/components/game/GameOverOverlay'
import { apiGet } from '@/lib/api'
import type { GameResultsResponse, TeamScore } from '@/lib/types'
import { makeEvent, makeGame, makePlayer, makeTeam, renderWithProviders } from '../test-utils'

jest.mock('@/lib/api', () => ({ apiGet: jest.fn() }))
jest.mock('@/lib/device', () => ({ getDeviceId: () => 'device-1' }))
const mockedGet = jest.mocked(apiGet)

describe('GameOverOverlay', () => {
  beforeEach(() => mockedGet.mockReset())

  it('renders winner, score rows, recent events, and timeline callback', async () => {
    const onViewTimeline = jest.fn()
    const west = makeTeam({ id: 'west', side: 'west', coins: 100 })
    const east = makeTeam({ id: 'east', side: 'east', coins: 0 })
    const player = makePlayer({ id: 'player-1', team_id: west.id, display_name: 'Alex' })
    const events = [
      makeEvent({
        id: 'challenge-submitted',
        type: 'challenge_submitted',
        payload: {
          team_id: west.id,
          challenge_ref: 'challenge.test',
          card_id: 'card-1',
          photo_url: 'https://example.test/challenge-proof.jpg',
        },
      }),
      makeEvent({
        id: 'challenge',
        type: 'challenge_completed',
        payload: { team_id: west.id, challenge_ref: 'challenge.test', card_id: 'card-1' },
      }),
      makeEvent({
        id: 'hardened',
        type: 'flag_hardened',
        payload: { team_id: west.id },
      }),
      makeEvent({
        id: 'won',
        type: 'game_won',
        payload: { winner_team_id: west.id, reason: 'flag_returned' },
      }),
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
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Team West wins!' })).toHaveFocus())
    expect(screen.getByText('Congratulations.')).toBeVisible()
    expect(screen.getAllByText('Challenges completed')[0]).toBeVisible()
    expect(screen.getByText(/Team West completed challenge.test/)).toBeVisible()
    expect(screen.getByText('Team West hardened their flag')).toBeVisible()
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'View photo' })).toHaveLength(2)
    expect(screen.getAllByRole('link', { name: 'View photo' })[0]).toHaveAttribute(
      'href',
      'https://example.test/challenge-proof.jpg',
    )

    await userEvent.click(screen.getByRole('button', { name: 'View full timeline' }))
    expect(onViewTimeline).toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Event timeline' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'View full timeline' })).not.toBeInTheDocument()
  })

  it('uses all paginated result events and authoritative scores beyond the client cap', async () => {
    const west = makeTeam({ id: 'west', side: 'west', coins: 0 })
    const east = makeTeam({ id: 'east', side: 'east', coins: 0 })
    const newestFirst = Array.from({ length: 205 }, (_, reverseIndex) => {
      const index = 204 - reverseIndex
      return makeEvent({
        id: `ledger-${index}`,
        type: `ledger_${index}`,
        created_at: new Date(Date.parse('2026-08-27T12:00:00.000Z') + index).toISOString(),
      })
    })
    const score = (teamId: string, side: 'west' | 'east', total: number): TeamScore => ({
      team_id: teamId,
      team_side: side,
      found_real_flag: false,
      challenges_completed: 0,
      tags_made: 0,
      curses_cast: 0,
      coins_remaining: 0,
      flag_points: 0,
      challenge_points: 0,
      tag_points: 0,
      curse_points: 0,
      coin_points: 0,
      total,
    })
    mockedGet.mockImplementation(async (path) => {
      const offset = Number(new URL(path, 'http://local.test').searchParams.get('offset'))
      const page = newestFirst.slice(offset, offset + 100)
      return {
        game: makeGame({ id: 'game-1', status: 'finished' }),
        winner_team_id: east.id,
        reason: 'timeout_points',
        scores: [score(west.id, 'west', 1), score(east.id, 'east', 321)],
        timeline_events: page,
        timeline_total: newestFirst.length,
        timeline_offset: offset,
        timeline_next_offset: offset + page.length < newestFirst.length
          ? offset + page.length
          : null,
      } satisfies GameResultsResponse
    })

    renderWithProviders(
      <GameOverOverlay
        gameId="game-1"
        events={[makeEvent({
          type: 'game_won',
          payload: { winner_team_id: west.id, reason: 'flag_returned' },
        })]}
        teams={[west, east]}
        players={[]}
        myTeamId={east.id}
        onViewTimeline={jest.fn()}
      />,
    )

    expect(await screen.findByRole('heading', { name: 'Team East wins!' })).toBeVisible()
    expect(screen.getByText('321.0')).toBeVisible()
    expect(mockedGet).toHaveBeenCalledTimes(3)
    expect(mockedGet.mock.calls[2]?.[0]).toContain('offset=200')
    await userEvent.click(screen.getByRole('button', { name: 'View full timeline' }))
    expect(screen.getByText('ledger_204')).toBeVisible()
    expect(screen.getByText('ledger_0')).toBeVisible()
  })
})
