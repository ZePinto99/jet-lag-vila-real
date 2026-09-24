import { render, screen } from '@testing-library/react'
import { CampingDiagram } from '@/components/guide/CampingDiagram'
import { EconomyDiagram } from '@/components/guide/EconomyDiagram'
import { FlagOutcomeDiagram } from '@/components/guide/FlagOutcomeDiagram'
import { GameArcDiagram } from '@/components/guide/GameArcDiagram'
import { IntelNarrowingDiagram } from '@/components/guide/IntelNarrowingDiagram'
import { TagDiagram } from '@/components/guide/TagDiagram'
import { ZoneDiagram } from '@/components/guide/ZoneDiagram'
import { wrapText } from '@/components/guide/wrapText'

// The guide diagrams take every caption as a prop rather than calling useT(),
// so they stay pure, server-renderable and testable with no i18n provider.
// `render` (not renderWithProviders) is deliberate here — it proves that
// contract holds.

describe('guide diagrams', () => {
  const cases: Array<{ name: string; element: React.ReactElement; shows: string[] }> = [
    {
      name: 'ZoneDiagram',
      element: (
        <ZoneDiagram
          labels={{
            alt: 'How defense zones work',
            zone: 'Your defense zone',
            scale: '200 m',
            one: 'Teammate inside your zone',
            two: 'Enemy inside your zone',
            three: 'You outside your zone',
          }}
        />
      ),
      shows: ['Your defense zone', '200 m', 'Teammate inside your zone'],
    },
    {
      name: 'TagDiagram',
      element: (
        <TagDiagram
          labels={{
            alt: 'How tagging works',
            radius: '5 m',
            defender: 'You',
            raiders: 'Both tagged at once',
            cost: 'They lose 1 intel card',
            step1: 'Walk to the neutral landmark',
            step2: 'Confirm, then walk 45 m away',
          }}
        />
      ),
      shows: ['5 m', 'You'],
    },
    {
      name: 'FlagOutcomeDiagram',
      element: (
        <FlagOutcomeDiagram
          labels={{
            alt: 'The three flag outcomes',
            start: 'You photograph a marker',
            realTitle: 'Real flag',
            realBody: 'Walk home to win',
            decoyTitle: 'Decoy',
            decoyBody: 'Lose all intel',
            emptyTitle: 'Empty',
            emptyBody: 'Locked for 15 min',
          }}
        />
      ),
      shows: ['You photograph a marker', 'Real flag', 'Decoy', 'Empty'],
    },
    {
      name: 'CampingDiagram',
      element: (
        <CampingDiagram
          labels={{
            alt: 'The camping rule',
            radius: '50 m',
            landmark: 'Your candidate',
            warn: '90 s warning',
            lock: '120 s lockout',
            reset: 'Leave for 60 s to reset',
          }}
        />
      ),
      shows: ['Your candidate', 'Leave for 60 s to reset'],
    },
    {
      name: 'EconomyDiagram',
      element: (
        <EconomyDiagram
          labels={{
            alt: 'Where coins come from',
            challenges: 'Challenges',
            coins: 'Coins',
            passive: '+20 every 30 min',
            intel: 'Intel',
            curses: 'Curses',
            harden: 'Harden',
          }}
        />
      ),
      shows: ['Coins', '+20 every 30 min', 'Intel', 'Curses', 'Harden'],
    },
    {
      name: 'GameArcDiagram',
      element: (
        <GameArcDiagram
          labels={{
            alt: 'The shape of a game',
            lobbyTitle: 'Lobby',
            lobbyBody: 'Pick a side',
            setupTitle: 'Setup',
            setupBody: 'Hide your flag',
            huntTitle: 'Hunt',
            huntBody: 'Three hours',
            endTitle: 'Win',
            endBody: 'Carry the photo home',
            protection: 'No attempts for 30 min',
          }}
        />
      ),
      shows: ['Lobby', 'Setup', 'Hunt', 'Win', 'No attempts for 30 min'],
    },
    {
      name: 'IntelNarrowingDiagram',
      element: (
        <IntelNarrowingDiagram
          labels={{
            alt: 'How intel narrows the search',
            before: 'Five candidates',
            card: 'Buy North/South',
            after: 'Three left',
            ruledOut: 'Ruled out',
          }}
        />
      ),
      shows: ['Five candidates', 'Buy North/South', 'Ruled out'],
    },
  ]

  it.each(cases)('$name exposes its alt text as an image role', ({ element }) => {
    render(element)
    // Every diagram must be announced to a screen reader with the caller's
    // translated description — a diagram whose meaning is only in the pixels
    // is unusable to anyone who cannot see it.
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', expect.any(String))
    expect(screen.getByRole('img').getAttribute('aria-label')).not.toHaveLength(0)
  })

  it.each(cases)('$name renders the captions it was given', ({ element, shows }) => {
    render(element)
    for (const text of shows) {
      expect(screen.getByText(text)).toBeInTheDocument()
    }
  })

  it.each(cases)('$name keeps every drawn element inside its viewBox', ({ element }) => {
    const { container } = render(element)
    const svg = container.querySelector('svg')!
    const [, , width, height] = svg
      .getAttribute('viewBox')!
      .split(' ')
      .map(Number)

    // SVG silently clips anything past the viewBox, so a caption pushed out by a
    // longer translation disappears with no error. Assert the geometry instead.
    for (const text of Array.from(svg.querySelectorAll('text'))) {
      const y = Number(text.getAttribute('y'))
      expect(y).toBeLessThanOrEqual(height)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(Number(text.getAttribute('x'))).toBeLessThanOrEqual(width)
    }
  })
})

describe('wrapText', () => {
  it('breaks on word boundaries within the budget', () => {
    expect(wrapText('walk to the neutral landmark', 12)).toEqual([
      'walk to the',
      'neutral',
      'landmark',
    ])
  })

  it('never splits a single over-long word', () => {
    expect(wrapText('Unmistakeable', 5)).toEqual(['Unmistakeable'])
  })

  it('drops lines past the cap so a long translation cannot escape the viewBox', () => {
    expect(wrapText('one two three four five six seven', 4, 2)).toHaveLength(2)
  })

  it('collapses whitespace rather than emitting empty lines', () => {
    expect(wrapText('  spaced   out  ', 20)).toEqual(['spaced out'])
  })
})
