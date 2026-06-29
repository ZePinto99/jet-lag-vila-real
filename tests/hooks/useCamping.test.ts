import { act, renderHook } from '@testing-library/react'
import {
  CAMPING_LOCK_S,
  CAMPING_WARNING_S,
  useCamping,
} from '@/lib/hooks/useCamping'
import { makeLandmark } from '../test-utils'

const gps = { lat: 41.295, lng: -7.746, accuracy: 5, updated_at: 1000 }

describe('useCamping', () => {
  it('warns after 90 s and locks after 120 s inside an own candidate radius', () => {
    // RULEBOOK §6: 50 m / 2 min camping rule.
    jest.useFakeTimers()
    jest.setSystemTime(new Date('2026-06-18T12:00:00.000Z'))

    const { result } = renderHook(() =>
      useCamping({
        myGps: gps,
        myTeamLandmarks: [makeLandmark({ lat: gps.lat, lng: gps.lng })],
      }),
    )

    act(() => {
      jest.advanceTimersByTime(CAMPING_WARNING_S * 1000)
    })
    expect(result.current.status).toBe('warning')

    act(() => {
      jest.advanceTimersByTime((CAMPING_LOCK_S - CAMPING_WARNING_S) * 1000)
    })
    expect(result.current.status).toBe('locked')
    expect(result.current.campingLocked).toBe(true)
  })
})
