'use client'

// Web Push setup must begin from an explicit user gesture. Mobile browsers
// commonly ignore Notification.requestPermission() when called from an effect.

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiPost } from '@/lib/api'
import { getDeviceId } from '@/lib/device'

function vapidPublicKey(): string | undefined {
  return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

interface UsePushParams {
  gameId: string | null
  playerId: string | null
  enabled: boolean
}

export type PushNotificationStatus =
  | 'idle'
  | 'enabling'
  | 'enabled'
  | 'denied'
  | 'unsupported'
  | 'unconfigured'
  | 'error'

export interface PushNotificationControl {
  status: PushNotificationStatus
  enable: () => void
}

export function usePushNotifications(params: UsePushParams): PushNotificationControl {
  const { gameId, playerId, enabled } = params
  const [status, setStatus] = useState<PushNotificationStatus>('idle')
  const inFlightRef = useRef(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const subscribe = useCallback(
    async (requestPermission: boolean): Promise<void> => {
      if (!enabled || !gameId || !playerId || inFlightRef.current) return
      if (typeof window === 'undefined' || typeof Notification === 'undefined') {
        setStatus('unsupported')
        return
      }
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setStatus('unsupported')
        return
      }
      const publicKey = vapidPublicKey()
      if (!publicKey) {
        setStatus('unconfigured')
        return
      }

      inFlightRef.current = true
      setStatus('enabling')
      try {
        // Keep this as the first awaited browser operation so a button click
        // retains the user-activation privilege required on mobile browsers.
        if (Notification.permission === 'default' && requestPermission) {
          await Notification.requestPermission()
        }
        if (Notification.permission !== 'granted') {
          if (mountedRef.current) {
            setStatus(Notification.permission === 'denied' ? 'denied' : 'idle')
          }
          return
        }

        const registration = await navigator.serviceWorker.register('/sw.js', {
          // Always check the worker script itself rather than a browser HTTP
          // cache. The worker handles push only, but stale worker code makes an
          // installed PWA look as if a deployment did not arrive.
          updateViaCache: 'none',
        })
        let subscription = await registration.pushManager.getSubscription()
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
          })
        }

        const json = subscription.toJSON()
        const endpoint = json.endpoint
        const keys = json.keys
        if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error('invalid_subscription')

        await apiPost<{ ok: true }>(`/api/games/${gameId}/push-subscribe`, {
          device_id: getDeviceId(),
          player_id: playerId,
          subscription: {
            endpoint,
            keys: { p256dh: keys.p256dh, auth: keys.auth },
          },
        })
        if (mountedRef.current) setStatus('enabled')
      } catch (error) {
        console.warn('Push notification setup failed', error)
        if (mountedRef.current) setStatus('error')
      } finally {
        inFlightRef.current = false
      }
    },
    [enabled, gameId, playerId],
  )

  // Restore an already-granted subscription automatically. First permission
  // prompts are deliberately left to enable(), called from a visible button.
  useEffect(() => {
    if (!enabled || !gameId || !playerId) return
    if (typeof window === 'undefined' || typeof Notification === 'undefined') {
      setStatus('unsupported')
      return
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setStatus('unsupported')
      return
    }
    if (!vapidPublicKey()) {
      setStatus('unconfigured')
      return
    }
    if (Notification.permission === 'granted') {
      void subscribe(false)
    } else {
      setStatus(Notification.permission === 'denied' ? 'denied' : 'idle')
    }
  }, [enabled, gameId, playerId, subscribe])

  const enable = useCallback(() => {
    void subscribe(true)
  }, [subscribe])

  return { status, enable }
}
