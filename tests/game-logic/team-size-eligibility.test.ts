import challenges from '@/data/challenges.json'
import curses from '@/data/curses.json'
import placedCurses from '@/data/placed-curses.json'
import { supportsTeamSize } from '@/lib/teamSizeEligibility'

describe('team-size catalog eligibility', () => {
  it('omits teammate-dependent content for 1-player teams', () => {
    const eligibleChallenges = challenges
      .filter((definition) => supportsTeamSize(definition, 1))
      .map((definition) => definition.id)
    const eligibleCurses = curses
      .filter((definition) => supportsTeamSize(definition, 1))
      .map((definition) => definition.id)

    expect(eligibleChallenges).toContain('challenge.utad-library-entrance')
    expect(eligibleChallenges).not.toContain('challenge.pastel-de-nata-quote')
    expect(eligibleCurses).not.toEqual(expect.arrayContaining([
      'curse.single-file',
      'curse.buddy-up',
      'curse.outfit-swap',
      'curse.solo-quarantine',
    ]))
    expect(
      placedCurses
        .filter((definition) => supportsTeamSize(definition, 1))
        .map((definition) => definition.id),
    ).not.toContain('placed.quarantine-field')
  })

  it('keeps at least one 1v1-compatible curse in every tier', () => {
    for (const tier of ['minor', 'medium', 'major']) {
      expect(
        curses.some(
          (definition) =>
            definition.tier === tier && supportsTeamSize(definition, 1),
        ),
      ).toBe(true)
    }
  })

  it('restores the complete catalogs for teams of two or more', () => {
    expect(challenges.every((definition) => supportsTeamSize(definition, 2))).toBe(true)
    expect(curses.every((definition) => supportsTeamSize(definition, 2))).toBe(true)
    expect(placedCurses.every((definition) => supportsTeamSize(definition, 2))).toBe(true)
  })

  it('prices only the slow placed curse for a 100-coin team', () => {
    expect(
      placedCurses.filter((definition) => definition.cost_coins <= 100).map((definition) => definition.id),
    ).toEqual(['placed.slow-trap'])
  })
})
