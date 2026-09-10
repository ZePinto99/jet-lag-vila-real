import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActiveCursesBanner } from '@/components/game/ActiveCursesBanner'
import { renderWithProviders, makeCurse } from '../test-utils'
import curses from '@/data/curses.json'

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

  it('renders the correct name, enforcement tag, and timer shape for all 16 curses', () => {
    const nowMs = Date.parse('2026-06-18T12:01:00.000Z')
    renderWithProviders(
      <ActiveCursesBanner
        activeCurses={curses.map((curse, index) =>
          makeCurse({
            id: `all-${index}`,
            curse_ref: curse.id,
            started_at: new Date(nowMs).toISOString(),
            expires_at:
              curse.duration_minutes == null
                ? null
                : new Date(nowMs + curse.duration_minutes * 60_000).toISOString(),
            params: curse.params,
          }),
        )}
        nowMs={nowMs}
      />,
    )

    for (const curse of curses) {
      expect(screen.getByText(curse.name)).toBeVisible()
    }
    expect(screen.getAllByText('[A]')).toHaveLength(6)
    expect(screen.getAllByText('[B]')).toHaveLength(4)
    expect(screen.getAllByText('[C]')).toHaveLength(2)
    expect(screen.getAllByText('[L]')).toHaveLength(4)
    expect(screen.getAllByText('no timer')).toHaveLength(3)
    expect(screen.getByText('20m 00s')).toBeVisible()
    expect(screen.getAllByText('5m 00s')).toHaveLength(2)
  })

  it('requires a file, submits a [B] proof, and reports the durable receipt', async () => {
    const user = userEvent.setup()
    const proof = {
      id: 'proof-1',
      game_id: 'game-1',
      curse_id: 'curse-photo',
      curse_ref: 'curse.photo-tax',
      target_team_id: 'team-1',
      prompt_index: 0,
      submitted_by: '00000000-0000-4000-8000-000000000001',
      submitted_at: '2026-08-27T12:00:10.000Z',
    }
    const fetchSpy = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ proof }),
    } as Response)
    Object.defineProperty(global, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchSpy,
    })
    const onProofSubmitted = jest.fn()

    renderWithProviders(
      <ActiveCursesBanner
        activeCurses={[
          makeCurse({ id: 'curse-photo', curse_ref: 'curse.photo-tax' }),
        ]}
        nowMs={Date.parse('2026-06-18T12:01:00.000Z')}
        gameId="game-1"
        myPlayerId="00000000-0000-4000-8000-000000000001"
        byCurseId={{
          'curse-photo': {
            prompt: {
              label: 'Selfie at any sign',
              secondsLeft: 20,
              proofRequired: true,
              promptIndex: 0,
            },
          },
        }}
        onProofSubmitted={onProofSubmitted}
      />,
    )

    const submit = screen.getByRole('button', { name: 'Submit proof' })
    expect(submit).toBeDisabled()
    const file = new File(['photo'], 'proof.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('📷 Add proof photo'), file)
    expect(submit).toBeEnabled()
    await user.click(submit)

    await waitFor(() => expect(onProofSubmitted).toHaveBeenCalledWith(proof))
    const form = fetchSpy.mock.calls[0]?.[1]?.body
    expect(form).toBeInstanceOf(FormData)
    expect((form as FormData).get('curse_id')).toBe('curse-photo')
    Reflect.deleteProperty(global, 'fetch')
  })

  it('disables the [B] camera picker and submit action while gameplay is locked', () => {
    renderWithProviders(
      <ActiveCursesBanner
        activeCurses={[
          makeCurse({ id: 'curse-photo', curse_ref: 'curse.photo-tax' }),
        ]}
        nowMs={Date.parse('2026-06-18T12:01:00.000Z')}
        actionsLocked
        gameId="game-1"
        myPlayerId="00000000-0000-4000-8000-000000000001"
        byCurseId={{
          'curse-photo': {
            prompt: {
              label: 'Selfie at any sign',
              secondsLeft: 20,
              proofRequired: true,
              promptIndex: 0,
            },
          },
        }}
      />,
    )

    expect(screen.getByLabelText('📷 Add proof photo')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Submit proof' })).toBeDisabled()
  })

  it('shows an existing path-free proof receipt after reload', () => {
    renderWithProviders(
      <ActiveCursesBanner
        activeCurses={[
          makeCurse({ id: 'curse-photo', curse_ref: 'curse.photo-tax' }),
        ]}
        nowMs={Date.parse('2026-06-18T12:01:00.000Z')}
        byCurseId={{
          'curse-photo': {
            prompt: {
              label: 'Selfie at any sign',
              secondsLeft: 20,
              proofRequired: true,
              promptIndex: 0,
            },
          },
        }}
        proofReceipts={[{
          id: 'proof-1',
          game_id: 'game-1',
          curse_id: 'curse-photo',
          curse_ref: 'curse.photo-tax',
          target_team_id: 'team-1',
          prompt_index: 0,
          submitted_by: 'player-1',
          submitted_at: '2026-08-27T12:00:10.000Z',
        }]}
      />,
    )
    expect(screen.getByText('✓ Proof photo submitted')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Submit proof' })).not.toBeInTheDocument()
  })
})
