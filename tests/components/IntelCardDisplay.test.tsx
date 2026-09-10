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

  it('renders every intel answer shape, keeping Hot/Cold immutable even for a legacy target payload', () => {
    renderWithProviders(
      <IntelCardDisplay
        myGps={{ lat: 41.2878, lng: -7.7396, accuracy: 5, updated_at: Date.now() }}
        myCards={[
          makeCard({ id: 'ew', ref: 'intel.east-west', payload: { intel_ref: 'intel.east-west', direction: 'east' } }),
          makeCard({ id: 'e1', ref: 'intel.eliminate-one', payload: { intel_ref: 'intel.eliminate-one', not_real: { ref: 'a', name: 'A' } } }),
          makeCard({ id: 'e2', ref: 'intel.eliminate-two', payload: { intel_ref: 'intel.eliminate-two', not_real: [{ ref: 'a', name: 'A' }, { ref: 'b', name: 'B' }] } }),
          makeCard({ id: 'decoy', ref: 'intel.decoy-reveal', payload: { intel_ref: 'intel.decoy-reveal', decoy: { ref: 'd', name: 'Decoy Place' } } }),
          makeCard({ id: 'hot-live', ref: 'intel.hot-cold', payload: { intel_ref: 'intel.hot-cold', bucket: 'over_1km', buy_position: { lat: 41.3, lng: -7.8 }, target: { lat: 41.2878, lng: -7.7396 } } }),
          makeCard({ id: 'photo', ref: 'intel.surroundings', payload: { intel_ref: 'intel.surroundings', photo_url: 'https://example.test/signed-photo' } }),
          makeCard({ id: 'direction', ref: 'intel.direction', payload: { intel_ref: 'intel.direction', bearing: 'NE' } }),
        ]}
      />,
    )

    expect(screen.getByText('east')).toBeVisible()
    expect(screen.getAllByText('A').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Decoy Place')).toBeVisible()
    expect(screen.getByText('over 1 km')).toBeVisible()
    expect(screen.queryByText(/BOILING/)).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Surroundings near the enemy real flag' })).toHaveAttribute(
      'src',
      'https://example.test/signed-photo',
    )
    expect(screen.getByText('NE')).toBeVisible()
  })
})
