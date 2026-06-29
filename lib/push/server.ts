// Server-only Web Push helper for Jet Lag: Vila Real.
//
// Best-effort, fire-and-forget lock-screen notifications. Callers `void`-call
// the send functions; nothing here ever throws to the caller and everything
// no-ops gracefully when VAPID env vars are missing (so the app runs fine
// without push configured).
//
// `web-push` is installed separately (`npm i web-push @types/web-push`).
// Until then this import won't resolve — that's expected.
import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// Config / VAPID
// ---------------------------------------------------------------------------

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
const VAPID_SUBJECT = process.env.VAPID_SUBJECT

/** True only when all three VAPID env vars are set; otherwise push is a no-op. */
export function pushConfigured(): boolean {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT)
}

let vapidInitialised = false

function ensureVapid(): void {
  if (vapidInitialised) return
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) return
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  vapidInitialised = true
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PushPayload {
  title: string
  body: string
  tag?: string
  url?: string
}

// Shape of a push_subscriptions row (subset we read).
interface SubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

// The object web-push expects (a structural PushSubscription).
interface WebPushSubscription {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

function toWebPushSubscription(row: SubscriptionRow): WebPushSubscription {
  return {
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
  }
}

// ---------------------------------------------------------------------------
// Core fan-out (shared by both public senders)
// ---------------------------------------------------------------------------

async function deliver(
  rows: SubscriptionRow[],
  payload: PushPayload,
): Promise<void> {
  if (rows.length === 0) return

  ensureVapid()
  const json = JSON.stringify(payload)
  const supabase = createAdminClient()

  const results = await Promise.allSettled(
    rows.map((row) =>
      webpush.sendNotification(toWebPushSubscription(row), json),
    ),
  )

  // Reap expired/gone subscriptions (404 Not Found / 410 Gone).
  const staleIds: string[] = []
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      const reason: unknown = result.reason
      const statusCode =
        reason &&
        typeof reason === 'object' &&
        'statusCode' in reason &&
        typeof (reason as { statusCode: unknown }).statusCode === 'number'
          ? (reason as { statusCode: number }).statusCode
          : undefined
      if (statusCode === 404 || statusCode === 410) {
        staleIds.push(rows[i].id)
      }
    }
  })

  if (staleIds.length > 0) {
    try {
      await supabase.from('push_subscriptions').delete().in('id', staleIds)
    } catch {
      // Best-effort cleanup; ignore.
    }
  }
}

// ---------------------------------------------------------------------------
// Public senders — never throw; no-op when push isn't configured.
// ---------------------------------------------------------------------------

export async function sendPushToTeam(
  gameId: string,
  teamId: string,
  payload: PushPayload,
): Promise<void> {
  if (!pushConfigured()) return
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('game_id', gameId)
      .eq('team_id', teamId)
    if (error || !data) return
    await deliver(data as SubscriptionRow[], payload)
  } catch {
    // Push is best-effort; swallow everything.
  }
}

export async function sendPushToPlayers(
  playerIds: string[],
  payload: PushPayload,
): Promise<void> {
  if (!pushConfigured()) return
  if (playerIds.length === 0) return
  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .in('player_id', playerIds)
    if (error || !data) return
    await deliver(data as SubscriptionRow[], payload)
  } catch {
    // Push is best-effort; swallow everything.
  }
}
