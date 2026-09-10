import { useState } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmActionModal } from '@/components/game/ConfirmActionModal'
import { renderWithProviders } from '../test-utils'

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open removal</button>
      <ConfirmActionModal
        open={open}
        title="Remove player?"
        body="Remove Sam from this game?"
        confirmLabel="Remove"
        danger
        onConfirm={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      />
    </>
  )
}

describe('ConfirmActionModal accessibility', () => {
  it('labels the dialog, traps focus, closes on Escape, and restores focus', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open removal' })
    await user.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'Remove player?' })
    expect(dialog).toHaveAccessibleDescription('Remove Sam from this game?')
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const confirm = screen.getByRole('button', { name: 'Remove' })
    await waitFor(() => expect(cancel).toHaveFocus())

    await user.tab()
    expect(confirm).toHaveFocus()
    await user.tab()
    expect(cancel).toHaveFocus()
    await user.tab({ shift: true })
    expect(confirm).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
