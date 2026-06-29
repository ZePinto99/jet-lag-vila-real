import { act, renderHook } from '@testing-library/react'
import { useGPS } from '@/lib/hooks/useGPS'
import { mockGPS } from '../test-utils'

describe('useGPS', () => {
  it('watches high-accuracy position when enabled and clears on unmount', () => {
    const gps = mockGPS()
    const { result, unmount } = renderHook(() => useGPS(true))

    expect(gps.watchPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    )

    act(() => {
      gps.emitPosition({ latitude: 41.295, longitude: -7.746, accuracy: 4 })
    })

    expect(result.current.position).toMatchObject({
      lat: 41.295,
      lng: -7.746,
      accuracy: 4,
    })
    expect(result.current.error).toBeNull()

    unmount()
    expect(gps.clearWatch).toHaveBeenCalledWith(1)
  })

  it('maps geolocation errors to stable error codes', () => {
    const gps = mockGPS()
    const { result } = renderHook(() => useGPS(true))

    act(() => {
      gps.emitError(1)
    })

    expect(result.current.error).toBe('gps_permission_denied')
  })

  it('reports unsupported GPS when geolocation is absent', () => {
    Object.defineProperty(window.navigator, 'geolocation', {
      configurable: true,
      value: undefined,
    })
    const { result } = renderHook(() => useGPS(true))

    expect(result.current.error).toBe('gps_unsupported')
  })
})
