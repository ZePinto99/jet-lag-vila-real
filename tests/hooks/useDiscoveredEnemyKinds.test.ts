import { renderHook } from '@testing-library/react'
import { useDiscoveredEnemyKinds } from '@/lib/hooks/useDiscoveredEnemyKinds'
import { makeEvent } from '../test-utils'

describe('useDiscoveredEnemyKinds', () => {
  it('derives attempted enemy landmark kinds for my team only', () => {
    const events = [
      makeEvent({ id: 'real', type: 'flag_attempt', payload: { team_id: 'west', landmark_ref: 'enemy.real', result: 'real' } }),
      makeEvent({ id: 'decoy', type: 'flag_attempt', payload: { team_id: 'west', landmark_ref: 'enemy.decoy', result: 'decoy' } }),
      makeEvent({ id: 'empty', type: 'flag_attempt', payload: { team_id: 'west', landmark_ref: 'enemy.empty', result: 'empty' } }),
      makeEvent({ id: 'other-team', type: 'flag_attempt', payload: { team_id: 'east', landmark_ref: 'our.flag', result: 'real' } }),
      makeEvent({ id: 'bad', type: 'flag_attempt', payload: { team_id: 'west', landmark_ref: 'bad', result: 'mystery' } }),
    ]

    const { result } = renderHook(() => useDiscoveredEnemyKinds(events, 'west'))

    expect(result.current).toEqual({
      'enemy.real': 'flag_real',
      'enemy.decoy': 'flag_decoy',
      'enemy.empty': 'flag_empty',
    })
  })

  it('returns an empty map without a team id', () => {
    const { result } = renderHook(() =>
      useDiscoveredEnemyKinds([
        makeEvent({ type: 'flag_attempt', payload: { team_id: 'west', landmark_ref: 'x', result: 'real' } }),
      ], null),
    )

    expect(result.current).toEqual({})
  })
})
