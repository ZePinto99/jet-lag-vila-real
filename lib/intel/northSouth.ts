import type { TeamSide } from '@/lib/types'

/**
 * Fixed latitude pivots for I1, derived from each full seven-landmark pool.
 * Each side splits 4/3, which makes the exhaustive five-of-seven clue
 * distribution identical for attackers targeting West or East.
 */
export const NORTH_SOUTH_PIVOT_BY_DEFENDING_SIDE: Record<TeamSide, number> = {
  west: 41.2954885,
  east: 41.29820795,
}

export function northSouthPivotForDefendingSide(side: TeamSide): number {
  return NORTH_SOUTH_PIVOT_BY_DEFENDING_SIDE[side]
}
