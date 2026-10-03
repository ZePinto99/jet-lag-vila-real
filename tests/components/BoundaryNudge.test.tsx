import { screen, waitFor } from '@testing-library/react'
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
    expect(container.querySelector('[data-boundary-status]')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('renders nothing while comfortably inside the play area', () => {
    const { container } = renderWithProviders(
      <BoundaryNudge state={getPlayAreaState(PLAY_AREA_CENTRE)} />,
    )
    expect(container.querySelector('[data-boundary-status]')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('renders nothing 400 m inside the boundary (no cry-wolf)', () => {
    const { container } = renderWithProviders(
      <BoundaryNudge state={getPlayAreaState(northOfCentre(PLAY_AREA_RADIUS_M - 400))} />,
    )
    expect(container.querySelector('[data-boundary-status]')).not.toBeInTheDocument()
  })

  it('warns near the edge with metres remaining, in EN', async () => {
    const returnTarget = northOfCentre(PLAY_AREA_RADIUS_M - 50)
    const { container } = renderWithProviders(
      <BoundaryNudge
        state={getPlayAreaState(northOfCentre(PLAY_AREA_RADIUS_M - 100))}
        returnTarget={returnTarget}
      />,
      { language: 'en' },
    )
    // Fall through to the real catalog string via the provider.
    expect(container.querySelector('[data-boundary-status="near_edge"]')).toHaveTextContent(
      /Approaching the play-area edge/,
    )
    expect(screen.queryByRole('link', { name: 'Directions back' })).not.toBeInTheDocument()
  })

  it('warns outside with a walk-back distance, in EN', async () => {
    const { container } = renderWithProviders(
      <BoundaryNudge state={getPlayAreaState(northOfCentre(PLAY_AREA_RADIUS_M + 250))} />,
      { language: 'en' },
    )
    const pill = container.querySelector('[data-boundary-status="outside"]')
    expect(pill).not.toBeNull()
    expect(pill).toBeVisible()
    expect(pill?.textContent).toMatch(/Outside the play area/)
    // The number must be actionable: how far back to walk, not a raw distance.
    expect(pill?.textContent).toMatch(/2[0-9]{2}\s*m/)
    expect(screen.queryByRole('link', { name: 'Directions back' })).not.toBeInTheDocument()
  })

  it('offers walking directions to the return point only while outside, in EN', async () => {
    const returnTarget = northOfCentre(PLAY_AREA_RADIUS_M - 50)
    renderWithProviders(
      <BoundaryNudge
        state={getPlayAreaState(northOfCentre(PLAY_AREA_RADIUS_M + 250))}
        returnTarget={returnTarget}
      />,
      { language: 'en' },
    )

    const link = await screen.findByRole('link', { name: 'Directions back' })
    const url = new URL(link.getAttribute('href') ?? '', window.location.href)
    expect(url.searchParams.get('destination')).toBe(`${returnTarget.lat},${returnTarget.lng}`)
    expect(url.searchParams.get('travelmode')).toBe('walking')
  })

  it('warns and labels return directions in PT-PT as well', async () => {
    const returnTarget = northOfCentre(PLAY_AREA_RADIUS_M - 50)
    const { container } = renderWithProviders(
      <BoundaryNudge
        state={getPlayAreaState(northOfCentre(PLAY_AREA_RADIUS_M + 250))}
        returnTarget={returnTarget}
      />,
      { language: 'pt' },
    )
    expect(container.querySelector('[data-boundary-status="outside"]')).toHaveTextContent(
      /Fora da área de jogo/,
    )
    expect(await screen.findByRole('link', { name: 'Percurso de regresso' })).toBeVisible()
  })

  it('escalates styling from amber (near edge) to red (outside)', () => {
    const near = renderWithProviders(
      <BoundaryNudge state={getPlayAreaState(northOfCentre(PLAY_AREA_RADIUS_M - 100))} />,
    )
    expect(
      near.container.querySelector('[data-boundary-status="near_edge"]')?.className,
    ).toMatch(/amber/)
    near.unmount()

    const out = renderWithProviders(
      <BoundaryNudge state={getPlayAreaState(northOfCentre(PLAY_AREA_RADIUS_M + 250))} />,
    )
    expect(out.container.querySelector('[data-boundary-status="outside"]')?.className).toMatch(
      /red/,
    )
  })

  it('announces politely rather than grabbing focus', async () => {
    renderWithProviders(
      <BoundaryNudge state={getPlayAreaState(northOfCentre(PLAY_AREA_RADIUS_M + 50))} />,
    )
    const pill = await screen.findByRole('status')
    expect(pill).toHaveAttribute('aria-live', 'polite')
    expect(pill).toHaveTextContent('Outside the play area.')
  })

  it('announces boundary transitions and a confirmed return without distance chatter', async () => {
    const inside = getPlayAreaState(PLAY_AREA_CENTRE)
    const outside = getPlayAreaState(northOfCentre(PLAY_AREA_RADIUS_M + 50))
    const { rerender } = renderWithProviders(<BoundaryNudge state={inside} />)
    const announcer = screen.getByRole('status')
    expect(announcer).toBeEmptyDOMElement()

    rerender(<BoundaryNudge state={outside} />)
    await waitFor(() => expect(announcer).toHaveTextContent('Outside the play area.'))

    rerender(<BoundaryNudge state={inside} />)
    await waitFor(() => expect(announcer).toHaveTextContent('Back inside the play area.'))
  })

  it('never tells an outside player they are zero metres out', () => {
    const { container } = renderWithProviders(
      <BoundaryNudge
        state={{ status: 'outside', distanceM: 1_503, marginM: 0, overshootM: 3 }}
      />,
      { language: 'en' },
    )
    const pill = container.querySelector('[data-boundary-status="outside"]')
    expect(pill).toHaveTextContent('3 m back')
    expect(pill).not.toHaveTextContent('0 m back')
  })
})
