import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Lobby } from '@/app/game/[code]/Lobby'
import { useGameStore } from '@/store/gameStore'
import type { GameByCodeResponse, SetReadyResponse } from '@/lib/types'
import { makeGame, makePlayer, makeTeam, renderWithProviders } from '../test-utils'

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('@/lib/hooks/useLobbyRealtime', () => ({
  useLobbyRealtime: jest.fn(),
}))

jest.mock('@/app/game/[code]/Setup', () => ({
  Setup: () => <div>Setup phase</div>,
}))

jest.mock('@/app/game/[code]/Live', () => ({
  Live: () => <div>Live phase</div>,
}))

function lobbySnapshot(): GameByCodeResponse {
  const west = makeTeam({ id: 'west' })
  const east = makeTeam({ id: 'east', side: 'east' })
  const me = makePlayer({
    id: 'me',
    team_id: west.id,
    device_id: 'test-device-id',
    display_name: 'Host',
    is_host: true,
    ready: false,
  })
  const opponent = makePlayer({
    id: 'opponent',
    team_id: east.id,
    device_id: 'other-device',
    display_name: 'Opponent',
    ready: true,
  })
  return {
    game: makeGame({ status: 'lobby', started_at: null }),
    teams: [west, east],
    players: [me, opponent],
  }
}

describe('Lobby', () => {
  it('applies the ready response locally without waiting for Realtime', async () => {
    const initial = lobbySnapshot()
    const readyPlayer = { ...initial.players[0], ready: true }
    const response: SetReadyResponse = { player: readyPlayer, all_ready: true }
    const fetchMock = jest.fn().mockResolvedValue(
      new Response(JSON.stringify(response), { status: 200 }),
    )
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    })

    renderWithProviders(<Lobby initial={initial} code="ABCD" />)

    await userEvent.click(await screen.findByRole('button', { name: 'Ready' }))

    await waitFor(() => {
      expect(useGameStore.getState().me?.ready).toBe(true)
      expect(screen.getByRole('button', { name: 'Not ready' })).toBeVisible()
      expect(screen.getByRole('button', { name: 'Start game' })).toBeEnabled()
    })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/games/game-1/ready',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
