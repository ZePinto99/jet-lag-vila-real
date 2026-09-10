import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Game, Player, Team } from '@/lib/types'

const RequestSchema = z.object({
  device_id: z.string().min(1).max(128),
  player_id: z.string().uuid(),
  action: z.enum(['pause', 'resume']),
})

interface PauseResponse {
  game: Game
  action: 'pause' | 'resume'
  pending: boolean
  applied: boolean
  already_applied: boolean
  requested_by_team_id?: string
  proposal_expires_at?: string
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', details: parsed.error.issues },
      { status: 400 },
    )
  }
  const { device_id, player_id, action } = parsed.data
  const supabase = createAdminClient()

  const { data: teamsData, error: teamsError } = await supabase
    .from('teams')
    .select('*')
    .eq('game_id', gameId)
  if (teamsError) {
    return NextResponse.json(
      { error: 'team_lookup_failed', details: teamsError.message },
      { status: 500 },
    )
  }
  const teams = (teamsData ?? []) as Team[]
  if (teams.length === 0) {
    const { data: game } = await supabase
      .from('games').select('id').eq('id', gameId).maybeSingle()
    return NextResponse.json(
      { error: game ? 'forbidden' : 'not_found' },
      { status: game ? 403 : 404 },
    )
  }
  const { data: playersData, error: playersError } = await supabase
    .from('players')
    .select('*')
    .in('team_id', teams.map((team) => team.id))
    .eq('device_id', device_id)
  if (playersError) {
    return NextResponse.json(
      { error: 'player_lookup_failed', details: playersError.message },
      { status: 500 },
    )
  }
  const caller = (playersData ?? [])[0] as Player | undefined
  if (!caller || caller.id !== player_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { data, error } = await supabase.rpc('weather_pause_vote_atomic', {
    p_game_id: gameId,
    p_team_id: caller.team_id,
    p_actor_player_id: caller.id,
    p_action: action,
  })
  if (error) {
    return NextResponse.json(
      { error: 'weather_pause_failed', details: error.message },
      { status: 500 },
    )
  }
  const result = data as (PauseResponse & { error?: string }) | null
  if (!result?.game || result.error) {
    const errorCode = result?.error ?? 'weather_pause_failed'
    const status = errorCode === 'not_found' ? 404
      : errorCode === 'forbidden' ? 403
      : errorCode === 'invalid_pause_action' ? 400
      : errorCode === 'game_not_in_play' || errorCode === 'game_not_paused' ? 409
      : 500
    return NextResponse.json({ error: errorCode }, { status })
  }
  return NextResponse.json(result)
}
