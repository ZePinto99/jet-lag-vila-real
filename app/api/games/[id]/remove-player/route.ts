import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Player, RemovePlayerResponse } from '@/lib/types'

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

  // Game must exist and be in lobby.
  const { data: game, error: gameErr } = await supabase
    .from('games')
    .select('id, status')
    .eq('id', gameId)
    .single()
  if (gameErr || !game) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (game.status !== 'lobby') {
    return NextResponse.json(
      { error: 'game_not_in_lobby' },
      { status: 409 },
    )
  }

  // Fetch all players in this game (need both requester + target + transfer candidates).
  const { data: teams, error: teamsErr } = await supabase
    .from('teams')
    .select('id')
    .eq('game_id', gameId)
  if (teamsErr || !teams || teams.length === 0) {
    return NextResponse.json({ error: 'team_lookup_failed' }, { status: 500 })
  }
  const teamIds = teams.map((t) => t.id)

  const { data: players, error: playersErr } = await supabase
    .from('players')
    .select('*')
    .in('team_id', teamIds)
    .order('created_at', { ascending: true })
  if (playersErr || !players) {
    return NextResponse.json({ error: 'player_lookup_failed' }, { status: 500 })
  }

  const requester = (players as Player[]).find((p) => p.device_id === device_id)
  if (!requester) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const target = (players as Player[]).find((p) => p.id === target_player_id)
  if (!target) {
    return NextResponse.json({ error: 'target_not_found' }, { status: 404 })
  }

  const isSelf = requester.id === target.id
  if (!isSelf && !requester.is_host) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // Delete the target player.
  const { error: delErr } = await supabase
    .from('players')
    .delete()
    .eq('id', target.id)
  if (delErr) {
    return NextResponse.json(
      { error: 'player_delete_failed', details: delErr.message },
      { status: 500 },
    )
  }

  // If the host left, transfer to the oldest remaining player.
  let new_host_id: string | null = null
  if (target.is_host) {
    const remaining = (players as Player[]).filter((p) => p.id !== target.id)
    if (remaining.length > 0) {
      const heir = remaining[0] // already ordered by created_at asc
      const { error: heirErr } = await supabase
        .from('players')
        .update({ is_host: true })
        .eq('id', heir.id)
      if (heirErr) {
        return NextResponse.json(
          { error: 'host_transfer_failed', details: heirErr.message },
          { status: 500 },
        )
      }
      new_host_id = heir.id
    }
  }

  // Append the event.
  await supabase.from('events').insert({
    game_id: gameId,
    type: 'player_left',
    actor_player_id: isSelf ? null : requester.id,
    payload: {
      player_id: target.id,
      team_id: target.team_id,
      self: isSelf,
      was_host: target.is_host,
      new_host_id,
    },
  })

  // If no players remain in the game, delete the game record entirely
  // (cleanup empty lobbies). Teams, events, etc. cascade.
  const { count } = await supabase
    .from('players')
    .select('id', { count: 'exact', head: true })
    .in('team_id', teamIds)

  let game_deleted = false
  if ((count ?? 0) === 0) {
    const { error: gameDelErr } = await supabase
      .from('games')
      .delete()
      .eq('id', gameId)
    if (gameDelErr) {
      return NextResponse.json(
        { error: 'game_delete_failed', details: gameDelErr.message },
        { status: 500 },
      )
    }
    game_deleted = true
  }

  const response: RemovePlayerResponse = {
    removed_player_id: target.id,
    game_deleted,
    new_host_id,
  }
  return NextResponse.json(response)
}
