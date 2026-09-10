import { render, screen } from '@testing-library/react'
import { TimeBonusBanner } from '@/components/game/TimeBonusBanner'
import { translate } from '@/lib/i18n/messages'

const t = (key: string, tokens?: Record<string, string | number>) =>
  translate(key, 'en', tokens)

describe('TimeBonusBanner', () => {
  const start = new Date('2026-08-27T12:00:00.000Z')

  it.each([
    [5, '⏱️ +20 coins in 25:00'],
    [35, '⏱️ +20 coins in 25:00'],
    [65, '⏱️ +20 coins in 25:00'],
  ])('always shows the next +20 bonus after %i elapsed minutes', (minutes, label) => {
    render(
      <TimeBonusBanner
        startedAt={start.toISOString()}
        nowMs={start.getTime() + minutes * 60_000}
        t={t}
      />,
    )
    expect(screen.getByText(label)).toBeVisible()
    expect(screen.queryByText(/Power Hour/i)).not.toBeInTheDocument()
  })

  it('stops promising bonuses after the sixth interval of a three-hour game', () => {
    const { container } = render(
      <TimeBonusBanner
        startedAt={start.toISOString()}
        nowMs={start.getTime() + 7 * 30 * 60_000}
        durationMinutes={180}
        t={t}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
