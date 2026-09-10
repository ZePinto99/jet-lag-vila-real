import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChatPanel } from '@/components/game/ChatPanel'
import type { ChatMessage } from '@/lib/hooks/useChat'
import { renderWithProviders } from '../test-utils'

const message: ChatMessage = {
  id: 'message-1',
  scope: 'global',
  playerId: 'player-2',
  name: 'Morgan',
  teamId: 'team-east',
  text: 'Meet at the library',
  ts: 1,
}

describe('ChatPanel', () => {
  it('keeps history visible but prevents sending while actions are locked', async () => {
    const send = jest.fn()
    renderWithProviders(
      <ChatPanel
        messages={[message]}
        send={send}
        connected
        myPlayerId="player-1"
        teamColorClass="text-blue-300"
        actionsLocked
        lockedReason="Actions locked — Full Stop in effect"
      />,
    )

    expect(screen.getByText('Meet at the library')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('Actions locked — Full Stop in effect')
    expect(screen.getByRole('textbox', { name: 'Message…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()

    await userEvent.type(screen.getByRole('textbox', { name: 'Message…' }), 'blocked{enter}')
    expect(send).not.toHaveBeenCalled()
  })

  it('sends a trimmed message with Enter when actions are available', async () => {
    const send = jest.fn()
    renderWithProviders(
      <ChatPanel
        messages={[]}
        send={send}
        connected
        myPlayerId="player-1"
        teamColorClass="text-blue-300"
      />,
    )

    await userEvent.type(screen.getByRole('textbox', { name: 'Message…' }), '  Ready  {enter}')
    expect(send).toHaveBeenCalledWith('global', 'Ready')
    expect(screen.getByRole('textbox', { name: 'Message…' })).toHaveValue('')
  })
})
