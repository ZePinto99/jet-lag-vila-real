import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import type { RemovePlayerResponse } from '@/lib/types'

const Body = z.object({
  target_player_id: z.string().uuid(),
  device_id: z.string().min(1).max(128),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const parsed = Body.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', details: parsed.error.issues },
      { status: 400 },
    )
  }
  const { target_player_id, device_id } = parsed.data

  const supabase = createAdminClient()

  const { data, error: removeError } = await supabase.rpc(
    'remove_lobby_player_atomic',
    {
      p_game_id: gameId,
      p_requester_device_id: device_id,
      p_target_player_id: target_player_id,
    },
  )
  if (removeError) {
    return NextResponse.json(
      { error: 'player_remove_failed', details: removeError.message },
      { status: 500 },
    )
  }
  const result = data as (RemovePlayerResponse & { error?: string }) | null
  if (!result || result.error) {
    const error = result?.error ?? 'player_remove_failed'
    const status = error === 'not_found' || error === 'target_not_found'
      ? 404
      : error === 'forbidden'
        ? 403
        : error === 'game_not_in_lobby'
          ? 409
          : 500
    return NextResponse.json({ error }, { status })
  }

  const response: RemovePlayerResponse = result
  return NextResponse.json(response)
}
