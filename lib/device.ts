// Device identity helper. Each browser keeps a stable UUID in localStorage so
// we can recognise the same phone across page reloads and reattach it to the
// existing Player record after a refresh.

const STORAGE_KEY = 'device_id'
const LAST_GAME_KEY = 'jl_last_game'

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

/**
 * Remember the single most-recently-entered game code so the landing page can
 * offer a "Rejoin last game" button (PLAYTEST_TRIAGE P3-3). No history, no auth.
 */
export function setLastGameCode(code: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LAST_GAME_KEY, code.toUpperCase())
  } catch {
    /* localStorage unavailable — rejoin just won't be offered */
  }
}

export function getLastGameCode(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const code = window.localStorage.getItem(LAST_GAME_KEY)
    return code && code.length > 0 ? code : null
  } catch {
    return null
  }
}
