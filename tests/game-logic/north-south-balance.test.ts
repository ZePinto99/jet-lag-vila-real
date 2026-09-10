/** @jest-environment node */

import landmarks from '@/data/landmarks.json'
import {
  NORTH_SOUTH_PIVOT_BY_DEFENDING_SIDE,
  northSouthPivotForDefendingSide,
} from '@/lib/intel/northSouth'

function chooseFive<T>(values: T[]): T[][] {
  const result: T[][] = []
  function visit(start: number, selected: T[]) {
    if (selected.length === 5) {
      result.push([...selected])
      return
    }
    for (let index = start; index <= values.length - (5 - selected.length); index += 1) {
      selected.push(values[index])
      visit(index + 1, selected)
      selected.pop()
    }
  }
  visit(0, [])
  return result
}

function survivorDistribution(side: 'west' | 'east'): number[] {
  const pool = landmarks.filter((landmark) => landmark.team_pool === side)
  const pivot = northSouthPivotForDefendingSide(side)
  const survivors: number[] = []
  for (const selection of chooseFive(pool)) {
    for (const real of selection) {
      const answerNorth = real.lat > pivot
      survivors.push(selection.filter((candidate) => (candidate.lat > pivot) === answerNorth).length)
    }
  }
  return survivors.sort((a, b) => a - b)
}

describe('North/South candidate-pool pivot balance', () => {
  it('uses the accepted fixed defending-side pool pivots', () => {
    expect(NORTH_SOUTH_PIVOT_BY_DEFENDING_SIDE).toEqual({
      west: 41.2954885,
      east: 41.29820795,
    })
  })

  it('makes all 21 selections × five real choices distribution-identical', () => {
    const west = survivorDistribution('west')
    const east = survivorDistribution('east')
    expect(west).toHaveLength(105)
    expect(east).toEqual(west)
    expect(west.reduce((sum, value) => sum + value, 0) / west.length).toBeCloseTo(
      2.714285714,
      8,
    )
  })
})
