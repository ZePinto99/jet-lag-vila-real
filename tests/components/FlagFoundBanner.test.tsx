import { screen } from '@testing-library/react'
import { FlagFoundBanner } from '@/components/game/FlagFoundBanner'
import { makePlayer, makeTeam, renderWithProviders } from '../test-utils'

describe('FlagFoundBanner', () => {
  it('celebrates when the carrier is on my team', () => {
    const team = makeTeam({ id: 'west' })

    renderWithProviders(
      <FlagFoundBanner
        carrier={makePlayer({ display_name: 'Alex', team_id: team.id })}
        carrierTeam={team}
        myTeam={team}
      />,
    )

    expect(screen.getByText('Your team found the flag! Alex is running to home base.')).toBeVisible()
  })

  it('warns defenders when the enemy carrier is running home', () => {
    const myTeam = makeTeam({ id: 'west' })
    const carrierTeam = makeTeam({
      id: 'east',
      side: 'east',
      home_landmark_id: 'landmark.biblioteca',
    })

    renderWithProviders(
      <FlagFoundBanner
        carrier={makePlayer({ display_name: 'Blair', team_id: carrierTeam.id })}
        carrierTeam={carrierTeam}
        myTeam={myTeam}
      />,
    )

    expect(screen.getByText(/Enemy found your flag! Blair is running back to/)).toBeVisible()
    expect(screen.getByText(/Intercept them!/)).toBeVisible()
  })
})
