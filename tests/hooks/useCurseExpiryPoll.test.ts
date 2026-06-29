import { act, renderHook } from '@testing-library/react'
import { useCurseExpiryPoll } from '@/lib/hooks/useCurseExpiryPoll'

describe('useCurseExpiryPoll', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    window.localStorage.setItem('device_id', 'device-1')
    global.fetch = jest.fn().mockResolvedValue(
      new Response(JSON.stringify({ expired_count: 0 }), { status: 200 }),
    )
  })

  it('polls expire-curses every 20 seconds while curses are active', async () => {
    renderHook(() => useCurseExpiryPoll('game-1', 2))

    await act(async () => {
      jest.advanceTimersByTime(20_000)
    })

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/games/game-1/expire-curses',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ device_id: 'device-1' }),
      }),
    )
  })

  it('does not poll without a game or active curses', () => {
    renderHook(() => useCurseExpiryPoll('game-1', 0))
    act(() => {
      jest.advanceTimersByTime(60_000)
    })
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
