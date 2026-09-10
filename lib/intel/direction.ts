export function initialBearingDegrees(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180
  const lat1 = toRad(from.lat)
  const lat2 = toRad(to.lat)
  const deltaLng = toRad(to.lng - from.lng)
  const y = Math.sin(deltaLng) * Math.cos(lat2)
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

export function snapToCompass8(
  degrees: number,
): 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW' {
  if (degrees < 22.5 || degrees >= 337.5) return 'N'
  if (degrees < 67.5) return 'NE'
  if (degrees < 112.5) return 'E'
  if (degrees < 157.5) return 'SE'
  if (degrees < 202.5) return 'S'
  if (degrees < 247.5) return 'SW'
  if (degrees < 292.5) return 'W'
  return 'NW'
}

export function snapToCompass4(degrees: number): 'N' | 'E' | 'S' | 'W' {
  if (degrees < 45 || degrees >= 315) return 'N'
  if (degrees < 135) return 'E'
  if (degrees < 225) return 'S'
  return 'W'
}

export function compass8FromPoint(
  origin: { lat: number; lng: number },
  target: { lat: number; lng: number },
): ReturnType<typeof snapToCompass8> {
  return snapToCompass8(initialBearingDegrees(origin, target))
}

export function compass4FromPoint(
  origin: { lat: number; lng: number },
  target: { lat: number; lng: number },
): ReturnType<typeof snapToCompass4> {
  return snapToCompass4(initialBearingDegrees(origin, target))
}

export function eastWestOf(
  pivotLng: number,
  targetLng: number,
): 'east' | 'west' {
  return targetLng > pivotLng ? 'east' : 'west'
}
