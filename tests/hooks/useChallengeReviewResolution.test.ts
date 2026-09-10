import { act, renderHook } from '@testing-library/react'
import { useChallengeReviewResolution } from '@/lib/hooks/useChallengeReviewResolution'

describe('useChallengeReviewResolution', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    window.localStorage.setItem('device_id', 'device-1')
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ resolved_card_ids: [] }), { status: 200 }),
    )
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('resolves on mount and every 15 seconds while gameplay is active', async () => {
    renderHook(() => useChallengeReviewResolution('game-1', true))
    await act(async () => Promise.resolve())
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/games/game-1/resolve-challenge-reviews',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ device_id: 'device-1' }),
      }),
    )

    await act(async () => {
      jest.advanceTimersByTime(15_000)
    })
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('does nothing outside active gameplay', () => {
    renderHook(() => useChallengeReviewResolution('game-1', false))
    act(() => jest.advanceTimersByTime(30_000))
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
