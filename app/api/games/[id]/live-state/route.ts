import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import type {
  ActiveCurse,
  Card,
  EnemyLandmark,
  Game,
  GameEvent,
  Landmark,
  LiveStateResponse,
  Player,
  Team,
} from '@/lib/types'

const QuerySchema = z.object({
  device_id: z.string().min(1).max(128),
})

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

  // 2. Load teams + identify caller via device_id.
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

  // 3. Load all players in the game (display_name was public in the lobby).
  const { data: playersData, error: playersError } = await supabase
    .from('players')
    .select('*')
    .in('team_id', teamIds)

  if (playersError) {
    return NextResponse.json(
      { error: 'player_lookup_failed', details: playersError.message },
      { status: 500 },
    )
  }
  const players = (playersData ?? []) as Player[]

  // 4. Identify caller by device_id.
  const caller = players.find((p) => p.device_id === device_id)
  if (!caller) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const myTeam = teams.find((t) => t.id === caller.team_id)
  if (!myTeam) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // 5. Load own team's landmarks (full row with kind, hardened).
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

  // 6. Load enemy team's landmarks, strip to EnemyLandmark shape.
  const enemyTeamIds = teams
    .filter((t) => t.id !== myTeam.id)
    .map((t) => t.id)

  let enemyLandmarks: EnemyLandmark[] = []
  if (enemyTeamIds.length > 0) {
    const { data: enemyLandmarksData, error: enemyLandmarksError } =
      await supabase
        .from('landmarks')
        .select('id, ref, lat, lng, team_id')
        .eq('game_id', game.id)
        .in('team_id', enemyTeamIds)

    if (enemyLandmarksError) {
      return NextResponse.json(
        {
          error: 'landmark_lookup_failed',
          details: enemyLandmarksError.message,
        },
        { status: 500 },
      )
    }
    enemyLandmarks = (enemyLandmarksData ?? []) as EnemyLandmark[]
  }

  // 7. Load active curses targeting my team.
  const { data: activeCursesData, error: activeCursesError } = await supabase
    .from('active_curses')
    .select('*')
    .eq('game_id', game.id)
    .eq('target_team_id', myTeam.id)

  if (activeCursesError) {
    return NextResponse.json(
      { error: 'active_curses_lookup_failed', details: activeCursesError.message },
      { status: 500 },
    )
  }
  const activeCurses = (activeCursesData ?? []) as ActiveCurse[]

  // 8. Load my team's cards (challenge/curse/intel, any state).
  const { data: myCardsData, error: myCardsError } = await supabase
    .from('cards')
    .select('*')
    .eq('game_id', game.id)
    .eq('team_id', myTeam.id)
    .in('kind', ['challenge', 'curse', 'intel'])

  if (myCardsError) {
    return NextResponse.json(
      { error: 'cards_lookup_failed', details: myCardsError.message },
      { status: 500 },
    )
  }
  const myCards = (myCardsData ?? []) as Card[]

  // 9. Load last 50 events. Fetch DESC, then reverse for ascending client order.
  const { data: recentEventsData, error: recentEventsError } = await supabase
    .from('events')
    .select('*')
    .eq('game_id', game.id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (recentEventsError) {
    return NextResponse.json(
      { error: 'events_lookup_failed', details: recentEventsError.message },
      { status: 500 },
    )
  }
  const recentEvents = ((recentEventsData ?? []) as GameEvent[])
    .slice()
    .reverse()

  const response: LiveStateResponse = {
    game,
    my_team: myTeam,
    teams,
    players,
    my_team_landmarks: myLandmarks,
    enemy_landmarks: enemyLandmarks,
    active_curses: activeCurses,
    my_cards: myCards,
    recent_events: recentEvents,
  }
  return NextResponse.json(response)
}
