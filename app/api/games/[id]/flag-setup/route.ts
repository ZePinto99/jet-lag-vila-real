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
  surroundings_photo_path: z.string().min(1).max(1024),
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
const SURROUNDINGS_BUCKET = 'surroundings-photos'
const MAX_SURROUNDINGS_PHOTO_BYTES = 10 * 1024 * 1024

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

  const { device_id, assignments, surroundings_photo_path } = parsed.data

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

  // The private object must belong to this exact game/team prefix. Validate
  // storage metadata server-side; a path alone is not proof that an image was
  // uploaded, and setup must not persist arbitrary/empty/oversized files.
  const expectedPrefix = `${game.id}/${callerTeam.id}/`
  if (
    !surroundings_photo_path.startsWith(expectedPrefix) ||
    surroundings_photo_path.includes('..') ||
    surroundings_photo_path.includes('//')
  ) {
    return NextResponse.json(
      { error: 'invalid_surroundings_photo_path' },
      { status: 400 },
    )
  }
  const relative = surroundings_photo_path.slice(expectedPrefix.length)
  if (!relative || relative.includes('/')) {
    return NextResponse.json(
      { error: 'invalid_surroundings_photo_path' },
      { status: 400 },
    )
  }
  const { data: storedObjects, error: objectLookupError } = await supabase.storage
    .from(SURROUNDINGS_BUCKET)
    .list(`${game.id}/${callerTeam.id}`, {
      limit: 10,
      search: relative,
    })
  if (objectLookupError) {
    return NextResponse.json(
      { error: 'surroundings_photo_lookup_failed', details: objectLookupError.message },
      { status: 500 },
    )
  }
  const storedObject = (storedObjects ?? []).find((object) => object.name === relative)
  const metadata = storedObject?.metadata as
    | { mimetype?: unknown; size?: unknown }
    | undefined
  const mimetype = typeof metadata?.mimetype === 'string' ? metadata.mimetype : ''
  const size = typeof metadata?.size === 'number' ? metadata.size : Number(metadata?.size)
  if (
    !storedObject ||
    !mimetype.startsWith('image/') ||
    !Number.isFinite(size) ||
    size <= 0 ||
    size > MAX_SURROUNDINGS_PHOTO_BYTES
  ) {
    return NextResponse.json(
      {
        error: 'invalid_surroundings_photo',
        details: { max_bytes: MAX_SURROUNDINGS_PHOTO_BYTES },
      },
      { status: 400 },
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

  // Persist the five hidden landmarks, the private surroundings reference,
  // flags_assigned, and (when this is the second team) setup -> live plus
  // game_live in one transaction. The game-row lock also makes same-team
  // duplicate submissions deterministic.
  const { data: setupData, error: setupError } = await supabase.rpc(
    'submit_flag_setup_atomic',
    {
      p_game_id: game.id,
      p_team_id: callerTeam.id,
      p_actor_player_id: caller.id,
      p_object_path: surroundings_photo_path,
      p_rows: rowsToInsert.map(({ ref, lat, lng, kind }) => ({
        ref,
        lat,
        lng,
        kind,
      })),
    },
  )
  if (setupError) {
    const { data: referenced } = await supabase
      .from('flag_surroundings')
      .select('id')
      .eq('object_path', surroundings_photo_path)
      .limit(1)
    if ((referenced ?? []).length === 0) {
      await supabase.storage
        .from(SURROUNDINGS_BUCKET)
        .remove([surroundings_photo_path])
    }
    return NextResponse.json(
      { error: 'flag_setup_failed', details: setupError.message },
      { status: 500 },
    )
  }
  const setup = setupData as {
    error?: string
    game?: Game
    both_teams_done?: boolean
  } | null
  if (!setup?.game || setup.error) {
    const error = setup?.error ?? 'flag_setup_failed'
    const status = error === 'already_submitted' || error === 'game_not_in_setup'
      ? 409
      : error === 'forbidden' ? 403
      : error === 'not_found' ? 404
      : error === 'invalid_assignments' ? 400
      : 500
    return NextResponse.json({ error }, { status })
  }

  const { data: myLandmarkRows, error: myLandmarksError } = await supabase
    .from('landmarks')
    .select('*')
    .eq('game_id', game.id)
    .eq('team_id', callerTeam.id)
    .in('kind', FLAG_KINDS)
  if (myLandmarksError) {
    return NextResponse.json(
      { error: 'landmark_lookup_failed', details: myLandmarksError.message },
      { status: 500 },
    )
  }
  const myLandmarks = (myLandmarkRows ?? []) as Landmark[]
  const both_teams_done = setup.both_teams_done === true
  const finalGame = setup.game

  const response: FlagSetupResponse = {
    game: finalGame,
    my_landmarks: myLandmarks,
    both_teams_done,
  }
  return NextResponse.json(response)
}
