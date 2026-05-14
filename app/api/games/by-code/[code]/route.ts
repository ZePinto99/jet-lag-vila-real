import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Game, GameByCodeResponse, Player, Team } from '@/lib/types'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await params
  const code = rawCode.trim().toUpperCase()
  if (!code) {
    return NextResponse.json({ error: 'invalid_code' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: gameRow, error: gameError } = await supabase
    .from('games')
    .select('*')
    .eq('code', code)
    .maybeSingle()

  if (gameError) {
    return NextResponse.json(
      { error: 'game_lookup_failed', details: gameError.message },
      { status: 500 },
    )
  }
  if (!gameRow) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const game = gameRow as Game

  const { data: teamsData, error: teamsError } = await supabase
    .from('teams')
    .select('*')
    .eq('game_id', game.id)

  if (teamsError || !teamsData) {
    return NextResponse.json(
      { error: 'team_lookup_failed', details: teamsError?.message },
      { status: 500 },
    )
  }
  const teams = teamsData as Team[]

  const teamIds = teams.map((t) => t.id)
  let players: Player[] = []
  if (teamIds.length > 0) {
    const { data: playersData, error: playersError } = await supabase
      .from('players')
      .select('*')
      .in('team_id', teamIds)
      .order('created_at', { ascending: true })

    if (playersError) {
      return NextResponse.json(
        { error: 'player_lookup_failed', details: playersError.message },
        { status: 500 },
      )
    }
    players = (playersData ?? []) as Player[]
  }

  const response: GameByCodeResponse = { game, teams, players }
  return NextResponse.json(response)
}
