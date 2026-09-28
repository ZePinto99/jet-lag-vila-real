import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HostRespawnOverride } from '@/components/game/HostRespawnOverride'
import { renderWithProviders, makePlayer } from '../test-utils'

// Finding P7, second exit. The route and RPC shipped with no caller at all, so
// RULEBOOK §6's promise that "the host can release the player immediately from
// the app" had no button behind it. These tests pin that the button exists, that
// it is invisible to everyone who should not see it, and that it cannot fire
// without an explicit confirmation.

// L1 (0057): the host may only release the OPPOSING team, so the fixtures must
// put the host and the releasable player on different teams.
const HOST = makePlayer({ id: 'host-1', team_id: 'west', display_name: 'Ana', is_host: true })
const STUCK = makePlayer({ id: 'p-2', team_id: 'east', display_name: 'Bruno', respawning: true })
const FINE = makePlayer({ id: 'p-3', team_id: 'east', display_name: 'Carla', respawning: false })
const STUCK_TEAMMATE = makePlayer({ id: 'p-4', team_id: 'west', display_name: 'Duarte', respawning: true })

function setup(players = [HOST, STUCK, FINE], myPlayerId = 'host-1', isHost = true) {
  return renderWithProviders(
    <HostRespawnOverride
      gameId="game-1"
      myPlayerId={myPlayerId}
      isHost={isHost}
      players={players}
    />,
  )
}

describe('HostRespawnOverride', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ player: { ...STUCK, respawning: false } }),
    }) as unknown as typeof fetch
  })

  describe('visibility — it must never be noise in a normal game', () => {
    it('renders nothing for a NON-host even when someone is stuck', () => {
      const { container } = setup([HOST, STUCK], 'p-2', false)
      expect(container).toBeEmptyDOMElement()
    })

    it('renders nothing for the host when NOBODY is respawning', () => {
      const { container } = setup([HOST, FINE])
      expect(container).toBeEmptyDOMElement()
    })

    it('never offers to release the host themselves (L1)', () => {
      const selfStuck = makePlayer({
        id: 'host-1', team_id: 'west', display_name: 'Ana', is_host: true, respawning: true,
      })
      const { container } = setup([selfStuck, FINE])
      // The server refuses this with cannot_clear_own_team; the UI must not
      // present a button that is guaranteed to fail.
      expect(container).toBeEmptyDOMElement()
    })

    it('never offers to release a player on the host OWN team (L1)', () => {
      const { container } = setup([HOST, STUCK_TEAMMATE])
      expect(container).toBeEmptyDOMElement()
    })

    it('lists only the players who are actually respawning', () => {
      setup()
      expect(screen.getByText(/Bruno/)).toBeVisible()
      expect(screen.queryByText(/Carla/)).not.toBeInTheDocument()
    })
  })

  describe('releasing', () => {
    it('requires an explicit confirmation before posting', async () => {
      setup()
      await userEvent.click(screen.getByRole('button', { name: 'Release' }))
      expect(global.fetch).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Confirm release' })).toBeVisible()
    })

    it('posts to host-clear-respawn with the host and target ids', async () => {
      setup()
      await userEvent.click(screen.getByRole('button', { name: 'Release' }))
      await userEvent.click(screen.getByRole('button', { name: 'Confirm release' }))
      await waitFor(() => expect(global.fetch).toHaveBeenCalled())
      const [url, init] = (global.fetch as jest.Mock).mock.calls[0]
      expect(url).toBe('/api/games/game-1/host-clear-respawn')
      const body = JSON.parse((init as RequestInit).body as string)
      expect(body).toMatchObject({ host_player_id: 'host-1', target_player_id: 'p-2' })
      expect(body.device_id).toBeTruthy()
    })

    it('can be cancelled without posting', async () => {
      setup()
      await userEvent.click(screen.getByRole('button', { name: 'Release' }))
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(global.fetch).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Release' })).toBeVisible()
    })

    it('surfaces a server refusal instead of failing silently', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: 'not_host' }),
      }) as unknown as typeof fetch
      setup()
      await userEvent.click(screen.getByRole('button', { name: 'Release' }))
      await userEvent.click(screen.getByRole('button', { name: 'Confirm release' }))
      expect(await screen.findByText(/Could not release/)).toBeVisible()
    })
  })

  it('tells the host that walking and the 10-minute timeout are the normal exits', () => {
    setup()
    expect(screen.getByText(/clears on its own after 10 minutes/)).toBeVisible()
  })
})
