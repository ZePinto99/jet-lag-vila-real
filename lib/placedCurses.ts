// Lookup helpers for the placed-curse catalog (data/placed-curses.json).
// Imported on client (placement UI) and server (place / trigger routes).

import raw from '@/data/placed-curses.json'
import type { PlacedCurseDefinition } from '@/lib/types'

const CATALOG = raw as PlacedCurseDefinition[]
const BY_ID = new Map<string, PlacedCurseDefinition>(
  CATALOG.map((c) => [c.id, c]),
)

export function getPlacedCurseCatalog(): PlacedCurseDefinition[] {
  return CATALOG
}

export function getPlacedCurseDef(id: string): PlacedCurseDefinition | undefined {
  return BY_ID.get(id)
}
