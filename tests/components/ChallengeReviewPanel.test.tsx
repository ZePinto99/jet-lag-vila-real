import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChallengeReviewPanel } from '@/components/game/ChallengeReviewPanel'
import { apiPost } from '@/lib/api'
import { makeCard, makeEvent, renderWithProviders } from '../test-utils'

jest.mock('@/lib/api', () => ({ apiPost: jest.fn() }))
jest.mock('@/lib/device', () => ({ getDeviceId: () => 'device-1' }))

const mockedPost = jest.mocked(apiPost)

describe('ChallengeReviewPanel', () => {
  const submitted = makeEvent({
    id: 'submitted',
    type: 'challenge_submitted',
    payload: {
      card_id: 'card-1',
      challenge_ref: 'challenge.test',
      reviewing_team_id: 'team-east',
      location_name: 'Test place',
      photo_url: 'https://example.test/photo.jpg',
      reward_coins: 40,
    },
  })

  beforeEach(() => mockedPost.mockReset())

  it('locks accept and reject during Full Stop and never submits from the locked UI', async () => {
    renderWithProviders(
      <ChallengeReviewPanel
        gameId="game-1"
        myPlayerId="player-1"
        myTeamId="team-east"
        events={[submitted]}
        actionsLocked
      />,
    )

    expect(screen.getByText('Actions locked — Full Stop in effect')).toBeVisible()
    const accept = screen.getByRole('button', { name: 'Accept' })
    const reject = screen.getByRole('button', { name: 'Reject' })
    expect(accept).toBeDisabled()
    expect(reject).toBeDisabled()
    await userEvent.click(accept)
    await userEvent.click(reject)
    expect(mockedPost).not.toHaveBeenCalled()
  })

  it('renders and resolves a durable pending review after recent-event churn', async () => {
    mockedPost.mockResolvedValue({ ok: true })
    const noise = Array.from({ length: 60 }, (_, index) =>
      makeEvent({ id: `noise-${index}`, type: 'time_bonus_awarded' }),
    )
    renderWithProviders(
      <ChallengeReviewPanel
        gameId="game-1"
        myPlayerId="player-1"
        myTeamId="team-east"
        events={noise}
        pendingReviews={[makeCard({
          id: 'durable-card',
          team_id: 'team-west',
          kind: 'challenge',
          ref: 'challenge.se-cathedral-date',
          state: 'pending',
          payload: {
            photo_url: 'https://example.test/durable.jpg',
            submitted_at: '2026-08-27T12:00:00.000Z',
          },
        })]}
      />,
    )

    expect(screen.getByText('Sé Catedral')).toBeVisible()
    expect(screen.getByText('+30')).toBeVisible()
    expect(screen.getByRole('link', { name: 'View photo' })).toHaveAttribute(
      'href',
      'https://example.test/durable.jpg',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(await screen.findByText('Nothing to review right now.')).toBeVisible()
  })

  it('shows a new proof when a rejected card is resubmitted with the same id', async () => {
    mockedPost.mockResolvedValue({ ok: true })
    const view = renderWithProviders(
      <ChallengeReviewPanel
        gameId="game-1"
        myPlayerId="player-1"
        myTeamId="team-east"
        events={[submitted]}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Reject' }))
    expect(await screen.findByText('Nothing to review right now.')).toBeVisible()

    const rejected = makeEvent({
      id: 'rejected',
      type: 'challenge_rejected',
      created_at: '2026-06-18T12:01:00.000Z',
      payload: { card_id: 'card-1' },
    })
    const resubmitted = makeEvent({
      id: 'resubmitted',
      type: 'challenge_submitted',
      created_at: '2026-06-18T12:02:00.000Z',
      payload: {
        ...submitted.payload,
        photo_url: 'https://example.test/replacement.jpg',
      },
    })
    view.rerender(
      <ChallengeReviewPanel
        gameId="game-1"
        myPlayerId="player-1"
        myTeamId="team-east"
        events={[submitted, rejected, resubmitted]}
      />,
    )

    expect(screen.getByRole('button', { name: 'Accept' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'View photo' })).toHaveAttribute(
      'href',
      'https://example.test/replacement.jpg',
    )
  })
})
