import curses from '@/data/curses.json'

describe('curse catalog contract', () => {
  it('defines all 16 rulebook curses with stable tier, enforcement, and duration', () => {
    expect(
      curses.map(({ id, name, tier, enforcement, duration_minutes }) => ({
        id,
        name,
        tier,
        enforcement,
        duration_minutes,
      })),
    ).toEqual([
      { id: 'curse.slow-walk', name: 'Slow Walk', tier: 'minor', enforcement: 'A', duration_minutes: 5 },
      { id: 'curse.single-file', name: 'Single File', tier: 'minor', enforcement: 'B', duration_minutes: 5 },
      { id: 'curse.photo-tax', name: 'Photo Tax', tier: 'minor', enforcement: 'B', duration_minutes: 6 },
      // [C] honour, not [L]: the ack is local React state (ActiveCursesBanner
      // .tsx:157 setAckedIdx) with no event write and no ledger mutation, so it
      // is unverifiable by design — exactly RULEBOOK §10's [C] definition.
      { id: 'curse.check-in', name: 'Check-in', tier: 'minor', enforcement: 'C', duration_minutes: 10 },
      { id: 'curse.detour', name: 'Detour', tier: 'medium', enforcement: 'A', duration_minutes: 15 },
      { id: 'curse.buddy-up', name: 'Buddy Up', tier: 'medium', enforcement: 'A', duration_minutes: 15 },
      { id: 'curse.outfit-swap', name: 'Outfit Swap', tier: 'medium', enforcement: 'B', duration_minutes: 20 },
      { id: 'curse.mute', name: 'Mute', tier: 'medium', enforcement: 'C', duration_minutes: 15 },
      { id: 'curse.backwards', name: 'Backwards', tier: 'medium', enforcement: 'C', duration_minutes: 10 },
      { id: 'curse.pose-patrol', name: 'Pose Patrol', tier: 'medium', enforcement: 'B', duration_minutes: 12 },
      { id: 'curse.frozen', name: 'Frozen', tier: 'major', enforcement: 'A', duration_minutes: 8 },
      { id: 'curse.pilgrimage', name: 'Pilgrimage', tier: 'major', enforcement: 'A', duration_minutes: null },
      { id: 'curse.coin-drain', name: 'Coin Drain', tier: 'major', enforcement: 'L', duration_minutes: null },
      { id: 'curse.intel-loss', name: 'Intel Loss', tier: 'major', enforcement: 'L', duration_minutes: null },
      { id: 'curse.solo-quarantine', name: 'Team Quarantine', tier: 'major', enforcement: 'A', duration_minutes: 15 },
      { id: 'curse.full-stop', name: 'Full Stop', tier: 'major', enforcement: 'L', duration_minutes: 10 },
    ])
    expect(curses.find((curse) => curse.id === 'curse.backwards')).toMatchObject({ enabled: false })
    expect(curses.find((curse) => curse.id === 'curse.buddy-up')?.params).toMatchObject({ max_pairwise_distance_m: 25 })
    expect(curses.find((curse) => curse.id === 'curse.solo-quarantine')?.params).toMatchObject({ max_pairwise_distance_m: 10 })
    expect(curses.find((curse) => curse.id === 'curse.photo-tax')?.params).toMatchObject({ interval_seconds: 120 })
    expect(curses.find((curse) => curse.id === 'curse.check-in')?.params).toMatchObject({ interval_seconds: 120 })
  })
})
