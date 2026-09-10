import { act, renderHook, waitFor } from '@testing-library/react'
import { apiPost } from '@/lib/api'
import { usePushNotifications } from '@/lib/hooks/usePushNotifications'

jest.mock('@/lib/api', () => ({ apiPost: jest.fn() }))
const mockApiPost = apiPost as jest.MockedFunction<typeof apiPost>

describe('usePushNotifications', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  })

  it('waits for an explicit enable action before requesting first-time permission', async () => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'test-vapid-key'
    let permission: NotificationPermission = 'default'
    const requestPermission = jest.fn(async () => {
      permission = 'granted'
      return permission
    })
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      value: {
        get permission() {
          return permission
        },
        requestPermission,
      },
    })
    Object.defineProperty(window, 'PushManager', {
      configurable: true,
      value: function PushManager() {},
    })
    const subscription = {
      toJSON: () => ({
        endpoint: 'https://push.test/subscription',
        keys: { p256dh: 'p256dh', auth: 'auth' },
      }),
    }
    const register = jest.fn().mockResolvedValue({
      pushManager: {
        getSubscription: jest.fn().mockResolvedValue(subscription),
        subscribe: jest.fn(),
      },
    })
    Object.defineProperty(window.navigator, 'serviceWorker', {
      configurable: true,
      value: { register },
    })
    mockApiPost.mockResolvedValue({ ok: true })

    const { result } = renderHook(() =>
      usePushNotifications({ gameId: 'game-1', playerId: 'player-1', enabled: true }),
    )
    expect(result.current.status).toBe('idle')
    expect(requestPermission).not.toHaveBeenCalled()

    act(() => result.current.enable())
    await waitFor(() => expect(result.current.status).toBe('enabled'))

    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledWith('/sw.js')
    expect(mockApiPost).toHaveBeenCalledWith('/api/games/game-1/push-subscribe', {
      device_id: 'test-device-id',
      player_id: 'player-1',
      subscription: {
        endpoint: 'https://push.test/subscription',
        keys: { p256dh: 'p256dh', auth: 'auth' },
      },
    })
  })
})
