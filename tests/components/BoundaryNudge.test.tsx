import { screen } from '@testing-library/react'
import { BoundaryNudge } from '@/components/game/BoundaryNudge'
import { renderWithProviders } from '../test-utils'
import {
  getPlayAreaState,
  PLAY_AREA_CENTRE,
  PLAY_AREA_RADIUS_M,
} from '@/lib/geo/playArea'

function northOfCentre(metres: number) {
  return {
    lat: PLAY_AREA_CENTRE.lat + metres / 111_320,
    lng: PLAY_AREA_CENTRE.lng,
  }
}

describe('BoundaryNudge (RULEBOOK §12.1 out-of-bounds warnings)', () => {
  // The "correct but miserable" failure mode for a warning pill is crying wolf.
  // These first three cases are the ones that matter: a player walking normally
  // inside the play area, or with no GPS at all, must never see it.
  it('renders nothing with no GPS state', () => {
    const { container } = renderWithProviders(<BoundaryNudge state={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing while comfortably inside the play area', () => {
    const { container } = renderWithProviders(
      <BoundaryNudge state={getPlayAreaState(PLAY_AREA_CENTRE)} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing 400 m inside the boundary (no cry-wolf)', () => {
    const { container } = renderWithProviders(
      <BoundaryNudge state={getPlayAreaState(northOfCentre(PLAY_AREA_RADIUS_M - 400))} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('warns near the edge with metres remaining, in EN', async () => {
    renderWithProviders(
      <BoundaryNudge state={getPlayAreaState(northOfCentre(PLAY_AREA_RADIUS_M - 100))} />,
      { language: 'en' },
    )
    // Fall through to the real catalog string via the provider.
    expect(await screen.findByText(/Approaching the play-area edge/)).toBeVisible()
  })

  it('warns outside with a walk-back distance, in EN', async () => {
    renderWithProviders(
      <BoundaryNudge state={getPlayAreaState(northOfCentre(PLAY_AREA_RADIUS_M + 250))} />,
      { language: 'en' },
    )
    const pill = await screen.findByRole('status')
    expect(pill).toBeVisible()
    expect(pill.textContent).toMatch(/Outside the play area/)
    // The number must be actionable: how far back to walk, not a raw distance.
    expect(pill.textContent).toMatch(/2[0-9]{2}\s*m/)
  })

  it('warns in PT-PT as well', async () => {
    renderWithProviders(
      <BoundaryNudge state={getPlayAreaState(northOfCentre(PLAY_AREA_RADIUS_M + 250))} />,
      { language: 'pt' },
    )
    expect(await screen.findByText(/Fora da área de jogo/)).toBeVisible()
  })

  it('escalates styling from amber (near edge) to red (outside)', () => {
    const near = renderWithProviders(
      <BoundaryNudge state={getPlayAreaState(northOfCentre(PLAY_AREA_RADIUS_M - 100))} />,
    )
    expect(near.container.querySelector('[role="status"]')?.className).toMatch(/amber/)
    near.unmount()

    const out = renderWithProviders(
      <BoundaryNudge state={getPlayAreaState(northOfCentre(PLAY_AREA_RADIUS_M + 250))} />,
    )
    expect(out.container.querySelector('[role="status"]')?.className).toMatch(/red/)
  })

  it('announces politely rather than grabbing focus', async () => {
    renderWithProviders(
      <BoundaryNudge state={getPlayAreaState(northOfCentre(PLAY_AREA_RADIUS_M + 50))} />,
    )
    const pill = await screen.findByRole('status')
    expect(pill).toHaveAttribute('aria-live', 'polite')
  })
})
