import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSeedLandmarksByPool } from '@/lib/landmarks'
import type {
  Game,
  Landmark,
  LandmarkKind,
  Player,
  SetupStateResponse,
  Team,
} from '@/lib/types'

const QuerySchema = z.object({
  device_id: z.string().min(1).max(128),
})

const FLAG_KINDS: LandmarkKind[] = ['flag_real', 'flag_decoy', 'flag_empty']

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params

  const url = new URL(request.url)
  const parsedQuery = QuerySchema.safeParse({
    device_id: url.searchParams.get('device_id') ?? undefined,
  })
  if (!parsedQuery.success) {
    return NextResponse.json(
      { error: 'invalid_body', details: parsedQuery.error.issues },
      { status: 400 },
    )
  }
  const { device_id } = parsedQuery.data

  const supabase = createAdminClient()

  // 1. Load the game. 404 if absent.
  const { data: gameRow, error: gameError } = await supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
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

  // 2. Identify caller via device_id (scoped to this game's teams).
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
  if (teamIds.length === 0) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { data: playersData, error: playersError } = await supabase
    .from('players')
    .select('*')
    .in('team_id', teamIds)
    .eq('device_id', device_id)

  if (playersError) {
    return NextResponse.json(
      { error: 'player_lookup_failed', details: playersError.message },
      { status: 500 },
    )
  }
  const caller = (playersData ?? [])[0] as Player | undefined
  if (!caller) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // 3. Caller's team.
  const myTeam = teams.find((t) => t.id === caller.team_id)
  if (!myTeam) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  if (!myTeam.side) {
    return NextResponse.json(
      { error: 'team_side_missing' },
      { status: 500 },
    )
  }

  const otherTeam = teams.find((t) => t.id !== myTeam.id)
  if (!otherTeam) {
    return NextResponse.json(
      { error: 'other_team_missing' },
      { status: 500 },
    )
  }

  // 4. Caller's team seed pool.
  const myPool = getSeedLandmarksByPool(myTeam.side)

  // 5. Caller's team's own landmarks (do NOT fetch the other team's rows).
  const { data: myLandmarksData, error: myLandmarksError } = await supabase
    .from('landmarks')
    .select('*')
    .eq('game_id', game.id)
    .eq('team_id', myTeam.id)

  if (myLandmarksError) {
    return NextResponse.json(
      { error: 'landmark_lookup_failed', details: myLandmarksError.message },
      { status: 500 },
    )
  }
  const myLandmarks = (myLandmarksData ?? []) as Landmark[]

  // 6. Other team done? Count their flag landmarks only.
  const { data: otherLandmarksData, error: otherLandmarksError } =
    await supabase
      .from('landmarks')
      .select('id')
      .eq('game_id', game.id)
      .eq('team_id', otherTeam.id)
      .in('kind', FLAG_KINDS)

  if (otherLandmarksError) {
    return NextResponse.json(
      {
        error: 'landmark_lookup_failed',
        details: otherLandmarksError.message,
      },
      { status: 500 },
    )
  }
  const other_team_done = (otherLandmarksData ?? []).length >= 5

  const response: SetupStateResponse = {
    game,
    my_team: myTeam,
    my_pool: myPool,
    my_landmarks: myLandmarks,
    other_team_id: otherTeam.id,
    other_team_done,
  }
  return NextResponse.json(response)
}
