import { screen } from '@testing-library/react'
import { IntelCardDisplay } from '@/components/game/IntelCardDisplay'
import { makeCard, renderWithProviders } from '../test-utils'

describe('IntelCardDisplay', () => {
  it('shows the empty state when no intel cards exist', () => {
    renderWithProviders(<IntelCardDisplay myCards={[]} />)

    expect(screen.getByText('My intel cards')).toBeVisible()
    expect(screen.getByText('No intel purchased yet. Buy intel from the Actions tab.')).toBeVisible()
  })

  it('renders answer details and expired state for intel cards only', () => {
    renderWithProviders(
      <IntelCardDisplay
        myCards={[
          makeCard({
            id: 'north',
            ref: 'intel.north-south',
            payload: { intel_ref: 'intel.north-south', direction: 'north' },
          }),
          makeCard({
            id: 'hot',
            ref: 'intel.hot-cold',
            state: 'expired',
            payload: {
              intel_ref: 'intel.hot-cold',
              bucket: 'under_500m',
              buy_position: { lat: 41.295, lng: -7.746 },
            },
          }),
          makeCard({ id: 'challenge', kind: 'challenge', payload: {} }),
        ]}
      />,
    )

    expect(screen.getByText('North/South')).toBeVisible()
    expect(screen.getByText('north')).toBeVisible()
    expect(screen.getByText('Hot/Cold')).toBeVisible()
    expect(screen.getByText('under 500 m')).toBeVisible()
    expect(screen.getByText('expired')).toBeVisible()
  })
})
