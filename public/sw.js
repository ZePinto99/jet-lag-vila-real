/* Jet Lag: Vila Real — service worker for Web Push (lock-screen notifications).
 *
 * Dependency-free, plain JS (not bundled). Handles two events:
 *   - 'push'            → show a notification from the JSON payload.
 *   - 'notificationclick' → focus an existing client or open a new window.
 *
 * Payloads are { title, body, tag?, url? } as sent by lib/push/server.ts.
 * Everything is wrapped defensively so a malformed payload never crashes the
 * worker.
 */

self.addEventListener('push', function (event) {
  var data = { title: 'Jet Lag', body: 'You have a new alert.', tag: undefined, url: '/' }

  try {
    if (event.data) {
      var parsed = event.data.json()
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.title === 'string') data.title = parsed.title
        if (typeof parsed.body === 'string') data.body = parsed.body
        if (typeof parsed.tag === 'string') data.tag = parsed.tag
        if (typeof parsed.url === 'string') data.url = parsed.url
      }
    }
  } catch (e) {
    // Malformed/non-JSON payload — fall back to the defaults above.
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: '/icon.png',
      badge: '/icon.png',
      data: { url: data.url || '/' },
    }),
  )
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()

  var targetUrl =
    (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (clientList) {
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i]
          // Focus an already-open client if one matches the target URL.
          if (client.url.indexOf(targetUrl) !== -1 && 'focus' in client) {
            return client.focus()
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl)
        }
        return undefined
      })
      .catch(function () {
        // Best-effort; ignore.
      }),
  )
})
