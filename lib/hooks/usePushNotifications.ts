'use client'

// usePushNotifications — registers the service worker, requests Notification
// permission, subscribes via the Push API, and POSTs the subscription to
// /push-subscribe so the server can send lock-screen notifications.
//
// Degrades gracefully: a no-op unless push is enabled, the game/player are
// known, the browser supports it, and NEXT_PUBLIC_VAPID_PUBLIC_KEY is set.
// Every step swallows errors — push is best-effort and must never break the
// live game view.

import { useEffect, useRef } from 'react'
import { apiPost } from '@/lib/api'
import { getDeviceId } from '@/lib/device'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

// Convert the URL-safe base64 VAPID public key into the Uint8Array the
// PushManager expects as applicationServerKey.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

interface UsePushParams {
  gameId: string | null
  playerId: string | null
  enabled: boolean
}

export function usePushNotifications(params: UsePushParams): void {
  const { gameId, playerId, enabled } = params
  const startedRef = useRef(false)

  useEffect(() => {
    if (!enabled) return
    if (!gameId || !playerId) return
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    if (!('PushManager' in window)) return
    if (!VAPID_PUBLIC_KEY) return
    // Guard so we only run the setup flow once per mount.
    if (startedRef.current) return
    startedRef.current = true

    let cancelled = false

    async function setup(): Promise<void> {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js')

        // Only prompt if the user hasn't already decided.
        if (Notification.permission === 'default') {
          await Notification.requestPermission()
        }
        if (Notification.permission !== 'granted') return
        if (cancelled) return

        // Reuse an existing subscription if present; otherwise create one.
        let subscription = await registration.pushManager.getSubscription()
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            // Cast to BufferSource: the helper returns a Uint8Array whose buffer
            // TS widens to ArrayBufferLike, which the DOM lib won't accept directly.
            applicationServerKey: urlBase64ToUint8Array(
              VAPID_PUBLIC_KEY as string,
            ) as BufferSource,
          })
        }
        if (cancelled) return

        const json = subscription.toJSON()
        const endpoint = json.endpoint
        const keys = json.keys
        if (!endpoint || !keys || !keys.p256dh || !keys.auth) return

        await apiPost<{ ok: true }>(
          `/api/games/${gameId}/push-subscribe`,
          {
            device_id: getDeviceId(),
            player_id: playerId,
            subscription: {
              endpoint,
              keys: { p256dh: keys.p256dh, auth: keys.auth },
            },
          },
        )
      } catch {
        // Best-effort; never throw out of the hook.
      }
    }

    void setup()

    return () => {
      cancelled = true
    }
  }, [enabled, gameId, playerId])
}
