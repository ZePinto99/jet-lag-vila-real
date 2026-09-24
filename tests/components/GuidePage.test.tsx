import { screen } from '@testing-library/react'
import GuidePage from '@/app/guide/page'
import { renderWithProviders } from '../test-utils'

// The Leaflet map is mocked out: it has no logic worth testing here, and Leaflet
// in jsdom is a tar pit. Everything else on this page is pure render.
jest.mock('@/components/guide/GuidePoolMap', () => ({
  __esModule: true,
  default: () => <div data-testid="pool-map" />,
}))

describe('GuidePage', () => {
  it('renders every section the jump-nav links to', () => {
    const { container } = renderWithProviders(<GuidePage />)

    const anchors = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('nav a[href^="#"]'),
    )
    expect(anchors.length).toBeGreaterThan(0)

    // A jump-nav link with no matching section scrolls nowhere and fails
    // silently — the most likely way this page rots.
    for (const anchor of anchors) {
      const id = anchor.getAttribute('href')!.slice(1)
      expect(container.querySelector(`section#${id}`)).not.toBeNull()
    }
  })

  it('quotes the real game constants rather than hardcoded prose', () => {
    renderWithProviders(<GuidePage />)

    // Spot-check the numbers a player would argue about. These come from
    // lib/gameConstants.ts and lib/geo/*, so the guide never restates them and
    // therefore cannot contradict the code.
    expect(screen.getByText(/1500 m/)).toBeInTheDocument()
    // "200 m" appears both in the prose and as the zone diagram's scale label.
    expect(screen.getAllByText(/200 m/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/45 m/).length).toBeGreaterThan(0)
    expect(screen.getByText(/100 coins/)).toBeInTheDocument()
  })

  it('leaves no interpolation token unresolved', () => {
    const { container } = renderWithProviders(<GuidePage />)
    // A typo'd token name renders literally as "{radius}" with no error.
    expect(container.textContent).not.toMatch(/\{[a-z]+\}/)
  })

  it('renders no raw message keys', () => {
    const { container } = renderWithProviders(<GuidePage />)
    // translate() falls back to returning the key itself, so a missing entry is
    // invisible unless asserted.
    expect(container.textContent).not.toMatch(/guide\.[a-z_]+\./)
  })

  it('lists both candidate pools without any retired landmark', () => {
    renderWithProviders(<GuidePage />)

    // Five landmarks are retired and excluded from play; showing them would send
    // players to places that cannot hold a flag.
    expect(screen.queryByText(/UTAD/)).toBeNull()
    expect(screen.queryByText(/Pioledo/)).toBeNull()

    // Both home bases should be named in the pool lists.
    expect(screen.getByText('Miradouro da Vila Velha')).toBeInTheDocument()
    expect(screen.getByText(/Biblioteca Municipal/)).toBeInTheDocument()
  })

  it('translates into PT-PT', () => {
    renderWithProviders(<GuidePage />, { language: 'pt' })

    expect(screen.getByRole('heading', { level: 1, name: 'Como se joga' })).toBeVisible()
    // Portuguese body copy, not just the title.
    expect(screen.getByText(/Só a pé/)).toBeInTheDocument()
  })

  it('gives every diagram an accessible description', () => {
    renderWithProviders(<GuidePage />)

    const figures = screen.getAllByRole('img')
    expect(figures.length).toBeGreaterThanOrEqual(6)
    for (const figure of figures) {
      expect(figure.getAttribute('aria-label')).toBeTruthy()
    }
  })
})
