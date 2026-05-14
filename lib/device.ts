// Device identity helper. Each browser keeps a stable UUID in localStorage so
// we can recognise the same phone across page reloads and reattach it to the
// existing Player record after a refresh.

const STORAGE_KEY = 'device_id'

/**
 * Returns the persisted device id for this browser, generating a new one on
 * first call. Returns an empty string during SSR — callers must invoke this
 * from client-side code only.
 */
export function getDeviceId(): string {
  if (typeof window === 'undefined') return ''

  try {
    const existing = window.localStorage.getItem(STORAGE_KEY)
    if (existing && existing.length > 0) return existing
    const fresh = crypto.randomUUID()
    window.localStorage.setItem(STORAGE_KEY, fresh)
    return fresh
  } catch {
    // localStorage may be unavailable (private mode, disabled cookies, etc.).
    // Fall back to a fresh per-call UUID so the request still has *something*
    // — reconnect won't work in that case but joining still will.
    return crypto.randomUUID()
  }
}
