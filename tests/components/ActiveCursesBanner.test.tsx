import { screen } from '@testing-library/react'
import { ActiveCursesBanner } from '@/components/game/ActiveCursesBanner'
import { renderWithProviders, makeCurse } from '../test-utils'

describe('ActiveCursesBanner', () => {
  it.each([
    ['en' as const, 'Curses on us', 'Actions locked — Full Stop in effect'],
    ['pt' as const, 'Maldições em nós', 'Ações bloqueadas — Paragem Total em vigor'],
  ])('renders translated header and action lock in %s', async (language, header, lockText) => {
    renderWithProviders(
      <ActiveCursesBanner
        activeCurses={[makeCurse({ curse_ref: 'curse.full-stop' })]}
        nowMs={Date.parse('2026-06-18T12:01:00.000Z')}
        actionsLocked
      />,
      { language },
    )

    expect(await screen.findByText(header)).toBeVisible()
    expect(screen.getByText(lockText)).toBeVisible()
    expect(screen.getByText(/2m 00s/)).toBeVisible()
  })

  it('renders enforcement prompts and readouts', () => {
    renderWithProviders(
      <ActiveCursesBanner
        activeCurses={[makeCurse({ id: 'curse-prompt', curse_ref: 'curse.check-in', expires_at: null })]}
        nowMs={Date.parse('2026-06-18T12:01:00.000Z')}
        byCurseId={{
          'curse-prompt': {
            prompt: { label: 'Check in now', secondsLeft: 12 },
            readout: { text: 'Team spread 22 m', ok: false },
          },
        }}
      />,
    )

    expect(screen.getByText('Check in now · 12s')).toBeVisible()
    expect(screen.getByText('Team spread 22 m')).toHaveClass('text-red-300')
  })
})
