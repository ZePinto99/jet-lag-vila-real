import detourStreetsCatalog from '@/data/detour-streets.json'
import landmarksCatalog from '@/data/landmarks.json'
import type { SeedLandmark } from '@/lib/types'

interface DetourStreetDefinition {
  id: string
  name: string
  corridor_m: number
  polyline: [number, number][]
  enabled?: boolean
}

const DETOUR_STREETS = (detourStreetsCatalog as DetourStreetDefinition[]).filter(
  (street) => street.enabled !== false,
)
const NEUTRAL_LANDMARKS = (landmarksCatalog as SeedLandmark[]).filter(
  (landmark) => landmark.team_pool === 'neutral',
)

export function buildCurseCastParams(
  curseRef: string,
  baseParams: Record<string, unknown>,
  random: () => number = Math.random,
): Record<string, unknown> {
  const params = { ...baseParams }
  if (curseRef === 'curse.pilgrimage') {
    const target = pick(NEUTRAL_LANDMARKS, random)
    if (!target) throw new Error('pilgrimage_target_missing')
    params.target_landmark_ref = target.id
  } else if (curseRef === 'curse.detour') {
    const street = pick(DETOUR_STREETS, random)
    if (!street) throw new Error('detour_street_missing')
    params.banned_street_id = street.id
    params.banned_street_name = street.name
    params.banned_street_polyline = street.polyline
    params.corridor_m = street.corridor_m
  }
  return params
}

function pick<T>(values: T[], random: () => number): T | undefined {
  if (values.length === 0) return undefined
  const index = Math.max(0, Math.min(values.length - 1, Math.floor(random() * values.length)))
  return values[index]
}
