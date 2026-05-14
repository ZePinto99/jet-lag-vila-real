import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSeedLandmarksByPool } from '@/lib/landmarks'
import type {
  FlagRole,
  FlagSetupResponse,
  Game,
  Landmark,
  LandmarkKind,
  Player,
  Team,
} from '@/lib/types'

const roleEnum = z.enum(['real', 'decoy', 'empty']) satisfies z.ZodType<FlagRole>

const FlagSetupBody = z.object({
  device_id: z.string().min(1).max(128),
  assignments: z
    .array(
      z.object({
        landmark_ref: z.string().min(1).max(128),
        role: roleEnum,
      }),
    )
    .length(5),
})

const ROLE_TO_KIND: Record<FlagRole, LandmarkKind> = {
  real: 'flag_real',
  decoy: 'flag_decoy',
  empty: 'flag_empty',
}

const FLAG_KINDS: LandmarkKind[] = ['flag_real', 'flag_decoy', 'flag_empty']

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_body', details: 'Body must be valid JSON.' },
      { status: 400 },
    )
  }

  const parsed = FlagSetupBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', details: parsed.error.issues },
      { status: 400 },
    )
  }

  const { device_id, assignments } = parsed.data

  const supabase = createAdminClient()

  // 1. Load game and require status = 'setup'.
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

  if (game.status !== 'setup') {
    return NextResponse.json(
      { error: 'game_not_in_setup' },
      { status: 409 },
    )
  }

  // 2. Identify caller via device_id → players row in this game.
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

  const callerTeam = teams.find((t) => t.id === caller.team_id)
  if (!callerTeam) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  if (!callerTeam.side) {
    return NextResponse.json(
      { error: 'team_side_missing' },
      { status: 500 },
    )
  }

  // 3. Exactly 1 real, 2 decoy, 2 empty (length already === 5 from Zod).
  let realCount = 0
  let decoyCount = 0
  let emptyCount = 0
  for (const a of assignments) {
    if (a.role === 'real') realCount++
    else if (a.role === 'decoy') decoyCount++
    else if (a.role === 'empty') emptyCount++
  }
  if (realCount !== 1 || decoyCount !== 2 || emptyCount !== 2) {
    return NextResponse.json(
      {
        error: 'invalid_role_counts',
        details: { real: realCount, decoy: decoyCount, empty: emptyCount },
      },
      { status: 400 },
    )
  }

  // 4. All 5 landmark_ref values must be unique.
  const refSet = new Set(assignments.map((a) => a.landmark_ref))
  if (refSet.size !== assignments.length) {
    return NextResponse.json(
      { error: 'duplicate_landmark' },
      { status: 400 },
    )
  }

  // 5. All 5 landmark_ref values must exist in the caller's team pool.
  const poolSeeds = getSeedLandmarksByPool(callerTeam.side)
  const poolIds = new Set(poolSeeds.map((l) => l.id))
  const offending = assignments
    .filter((a) => !poolIds.has(a.landmark_ref))
    .map((a) => a.landmark_ref)
  if (offending.length > 0) {
    return NextResponse.json(
      {
        error: 'landmark_not_in_pool',
        details: { offending },
      },
      { status: 400 },
    )
  }

  // 6. The caller's team must NOT have already submitted.
  const { data: existingRows, error: existingError } = await supabase
    .from('landmarks')
    .select('id, team_id, kind')
    .eq('game_id', game.id)
    .eq('team_id', callerTeam.id)
    .in('kind', FLAG_KINDS)
    .limit(1)

  if (existingError) {
    return NextResponse.json(
      { error: 'landmark_lookup_failed', details: existingError.message },
      { status: 500 },
    )
  }
  if ((existingRows ?? []).length > 0) {
    return NextResponse.json(
      { error: 'already_submitted' },
      { status: 409 },
    )
  }

  // All checks pass. Build the 5 rows to insert. Look up coords from the seed
  // catalog by ref (we validated above that all refs are in the pool).
  const poolById = new Map(poolSeeds.map((l) => [l.id, l]))
  const rowsToInsert = assignments.map((a) => {
    const seed = poolById.get(a.landmark_ref)
    // Guaranteed present by the pool check above; assert for the type system.
    if (!seed) throw new Error(`seed missing for ${a.landmark_ref}`)
    return {
      game_id: game.id,
      ref: a.landmark_ref,
      lat: seed.lat,
      lng: seed.lng,
      team_id: callerTeam.id,
      kind: ROLE_TO_KIND[a.role],
      hardened: false,
    }
  })

  const { data: insertedRows, error: insertError } = await supabase
    .from('landmarks')
    .insert(rowsToInsert)
    .select()

  if (insertError || !insertedRows) {
    return NextResponse.json(
      { error: 'landmark_insert_failed', details: insertError?.message },
      { status: 500 },
    )
  }
  const myLandmarks = insertedRows as Landmark[]

  // Append flags_assigned event. Do NOT leak the assignments in the payload.
  const { error: eventError } = await supabase.from('events').insert({
    game_id: game.id,
    type: 'flags_assigned',
    actor_player_id: caller.id,
    payload: { team_id: callerTeam.id },
  })
  if (eventError) {
    return NextResponse.json(
      { error: 'event_insert_failed', details: eventError.message },
      { status: 500 },
    )
  }

  // Compute whether both teams are now done by counting landmarks per team.
  const { data: doneRows, error: doneError } = await supabase
    .from('landmarks')
    .select('team_id')
    .eq('game_id', game.id)
    .in('kind', FLAG_KINDS)

  if (doneError) {
    return NextResponse.json(
      { error: 'landmark_lookup_failed', details: doneError.message },
      { status: 500 },
    )
  }
  const counts = new Map<string, number>()
  for (const r of (doneRows ?? []) as Array<{ team_id: string | null }>) {
    if (!r.team_id) continue
    counts.set(r.team_id, (counts.get(r.team_id) ?? 0) + 1)
  }
  const both_teams_done =
    teams.length === 2 && teams.every((t) => (counts.get(t.id) ?? 0) >= 5)

  let finalGame: Game = game
  if (both_teams_done) {
    const startedAt = new Date().toISOString()
    const { data: updatedGameRow, error: updateError } = await supabase
      .from('games')
      .update({ status: 'live', started_at: startedAt })
      .eq('id', game.id)
      .eq('status', 'setup') // optimistic guard
      .select()
      .maybeSingle()

    if (updateError) {
      return NextResponse.json(
        { error: 'game_update_failed', details: updateError.message },
        { status: 500 },
      )
    }
    if (updatedGameRow) {
      finalGame = updatedGameRow as Game
      // Append game_live event (only when we actually transitioned).
      const { error: liveEventError } = await supabase.from('events').insert({
        game_id: finalGame.id,
        type: 'game_live',
        actor_player_id: caller.id,
        payload: {},
      })
      if (liveEventError) {
        return NextResponse.json(
          { error: 'event_insert_failed', details: liveEventError.message },
          { status: 500 },
        )
      }
    } else {
      // Lost the race (already transitioned): re-fetch the current row.
      const { data: refetched, error: refetchError } = await supabase
        .from('games')
        .select('*')
        .eq('id', game.id)
        .maybeSingle()
      if (refetchError || !refetched) {
        return NextResponse.json(
          { error: 'game_lookup_failed', details: refetchError?.message },
          { status: 500 },
        )
      }
      finalGame = refetched as Game
    }
  }

  const response: FlagSetupResponse = {
    game: finalGame,
    my_landmarks: myLandmarks,
    both_teams_done,
  }
  return NextResponse.json(response)
}
