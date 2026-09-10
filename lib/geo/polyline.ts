export interface GeoPoint {
  lat: number
  lng: number
}

/**
 * Short-distance point-to-polyline distance in metres. The game board is only
 * a few kilometres wide, so projecting each segment into a local equirectangular
 * plane is both stable and substantially more accurate than phone GPS.
 */
export function distanceToPolylineMeters(
  point: GeoPoint,
  polyline: readonly GeoPoint[],
): number {
  if (polyline.length === 0) return Number.POSITIVE_INFINITY
  if (polyline.length === 1) return projectedDistance(point, polyline[0])

  let nearest = Number.POSITIVE_INFINITY
  for (let index = 0; index < polyline.length - 1; index += 1) {
    nearest = Math.min(
      nearest,
      distanceToSegmentMeters(point, polyline[index], polyline[index + 1]),
    )
  }
  return nearest
}

function projectedDistance(a: GeoPoint, b: GeoPoint): number {
  const projected = projectAround(a, b)
  return Math.hypot(projected.x, projected.y)
}

function distanceToSegmentMeters(
  point: GeoPoint,
  start: GeoPoint,
  end: GeoPoint,
): number {
  const a = projectAround(point, start)
  const b = projectAround(point, end)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return Math.hypot(a.x, a.y)

  const t = Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / lengthSquared))
  return Math.hypot(a.x + t * dx, a.y + t * dy)
}

function projectAround(origin: GeoPoint, point: GeoPoint): { x: number; y: number } {
  const earthRadiusM = 6_371_000
  const toRadians = Math.PI / 180
  const originLat = origin.lat * toRadians
  const pointLat = point.lat * toRadians
  const deltaLat = pointLat - originLat
  const deltaLng = (point.lng - origin.lng) * toRadians
  return {
    x: earthRadiusM * deltaLng * Math.cos((originLat + pointLat) / 2),
    y: earthRadiusM * deltaLat,
  }
}
