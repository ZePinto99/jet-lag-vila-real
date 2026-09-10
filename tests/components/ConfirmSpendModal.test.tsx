import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmSpendModal } from '@/components/game/ConfirmSpendModal'
import { renderWithProviders } from '../test-utils'

describe('ConfirmSpendModal', () => {
  it('shows the balance impact and supports explicit confirm or Escape cancel', async () => {
    const onConfirm = jest.fn()
    const onCancel = jest.fn()

    renderWithProviders(
      <ConfirmSpendModal
        open
        itemName="Direction intel"
        cost={50}
        balance={120}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Confirm purchase' })).toBeVisible()
    expect(screen.getByText('70')).toBeVisible()

    await userEvent.click(screen.getByRole('button', { name: 'Confirm & spend' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)

    await userEvent.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
