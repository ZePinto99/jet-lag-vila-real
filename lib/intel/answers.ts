import { haversineMeters } from '@/lib/geo/haversine'
import type { IntelAnswer } from '@/lib/types'

export type HotColdAnswer = Extract<
  IntelAnswer,
  { intel_ref: 'intel.hot-cold' }
>

export function hotColdBucket(meters: number): HotColdAnswer['bucket'] {
  if (meters < 200) return 'under_200m'
  if (meters < 500) return 'under_500m'
  if (meters < 1000) return 'under_1km'
  return 'over_1km'
}

export function buildHotColdAnswer(
  buyPosition: { lat: number; lng: number },
  realFlag: { lat: number; lng: number },
): HotColdAnswer {
  return {
    intel_ref: 'intel.hot-cold',
    bucket: hotColdBucket(haversineMeters(buyPosition, realFlag)),
    buy_position: { lat: buyPosition.lat, lng: buyPosition.lng },
  }
}
