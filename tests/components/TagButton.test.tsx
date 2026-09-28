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

  // P12: an aborted bulk tag used to render as a bare "No tags landed." with no
  // cause at all, while a teammate tagging the same raider succeeded.
  describe('rejection reasons (P12)', () => {
    function tagResponse(rejected: Array<{ player_id: string; reason: string }>) {
      global.fetch = jest.fn().mockResolvedValue(
        new Response(JSON.stringify({ tagged_player_ids: [], rejected }), { status: 200 }),
      )
    }

    async function tapWith(
      rejected: Array<{ player_id: string; reason: string }>,
      targets = enabledState.targets,
      language?: 'en' | 'pt',
    ) {
      tagResponse(rejected)
      renderWithProviders(
        <TagButton
          gameId="game-1"
          myPlayerId="player-1"
          myGpsPos={gps}
          meState={{ ...enabledState, targets }}
        />,
        language ? { language } : undefined,
      )
      await userEvent.click(
        screen.getByRole('button', { name: /(Tag|Apanhar) \d+ (player|jogador)/ }),
      )
    }

    it('explains a multi-target abort as someone else having tagged first', async () => {
      await tapWith(
        [
          { player_id: 'enemy-1', reason: 'already_respawning' },
          { player_id: 'enemy-2', reason: 'batch_aborted' },
        ],
        [
          { player_id: 'enemy-1', pos: gps },
          { player_id: 'enemy-2', pos: gps },
        ],
      )

      expect(
        await screen.findByText(
          /Someone else tagged one of them first, so nothing was applied/,
        ),
      ).toBeVisible()
      // The headline still reports the outcome and the rejected count.
      expect(screen.getByText(/No tags landed\./)).toBeVisible()
      expect(screen.getByText(/\(2 rejected\)/)).toBeVisible()
    })

    it('says plainly that a single target was already down', async () => {
      await tapWith([{ player_id: 'enemy-1', reason: 'already_respawning' }])

      expect(
        await screen.findByText('They had already been tagged and are respawning — nothing to apply.'),
      ).toBeVisible()
      // The batch explanation must NOT appear for a single stale target: there
      // was no batch and nothing to retry.
      expect(screen.queryByText(/Someone else tagged one of them first/)).not.toBeInTheDocument()
    })

    it('localises the abort explanation in PT-PT', async () => {
      await tapWith(
        [{ player_id: 'enemy-1', reason: 'batch_aborted' }],
        enabledState.targets,
        'pt',
      )

      expect(
        await screen.findByText(/Outra pessoa apanhou um deles primeiro/),
      ).toBeVisible()
    })

    it('falls back to a named generic message for an unmapped reason', async () => {
      await tapWith([{ player_id: 'enemy-1', reason: 'some_new_server_reason' }])

      expect(
        await screen.findByText('One tag was rejected (some_new_server_reason).'),
      ).toBeVisible()
    })

    it('shows no rejection line when every tag landed', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ tagged_player_ids: ['enemy-1'], rejected: [] }),
          { status: 200 },
        ),
      )
      renderWithProviders(
        <TagButton gameId="game-1" myPlayerId="player-1" myGpsPos={gps} meState={enabledState} />,
      )
      await userEvent.click(screen.getByRole('button', { name: /Tag 1 player/ }))

      expect(await screen.findByText('Tagged 1 player.')).toBeVisible()
      expect(screen.queryByText(/rejected/)).not.toBeInTheDocument()
    })
  })
})
