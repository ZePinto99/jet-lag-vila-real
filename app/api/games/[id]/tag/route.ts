import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendPushToPlayers } from '@/lib/push/server'
import { haversineMeters } from '@/lib/geo/haversine'
import { isPositionFresh } from '@/lib/geo/positionFreshness'
import { nearestNeutralLandmark } from '@/lib/geo/nearestNeutral'
import { isInDefenseZone, isRaiderForDefendingTeam } from '@/lib/geo/zones'
import { isTeamActionLocked } from '@/lib/server/actionLock'
import { CAMPING_RADIUS_M, TAG_RANGE_M } from '@/lib/gameConstants'
import type {
  Game,
  Landmark,
  LandmarkKind,
  Player,
  TagResponse,
  Team,
} from '@/lib/types'

// TAG_RANGE_M (server GPS tolerance, 10 m vs the client's 5 m) and
// CAMPING_RADIUS_M both live in lib/gameConstants.ts so the player guide states
// the same numbers this route enforces.

const FLAG_KINDS: LandmarkKind[] = ['flag_real', 'flag_decoy', 'flag_empty']

const GpsPositionSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number(),
  updated_at: z.number(),
})

const TagRequestSchema = z.object({
  device_id: z.string().min(1).max(128),
  tagger_player_id: z.string().uuid(),
  tagger_pos: GpsPositionSchema,
  targets: z
    .array(
      z.object({
        player_id: z.string().uuid(),
        pos: GpsPositionSchema,
      }),
    )
    .min(1)
    .max(8),
})

interface RejectedTarget {
  player_id: string
  reason: string
}

interface CampingStateResponse {
  inside_zone: boolean
  seconds_in_zone: number
  seconds_outside: number
  locked: boolean
  last_heartbeat_at: string
}

type BulkTagResult =
  | { tagged_player_ids: string[] }
  | { error: string; player_id?: string }

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

  const parsed = TagRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', details: parsed.error.issues },
      { status: 400 },
    )
  }
  const { device_id, tagger_player_id, tagger_pos, targets } = parsed.data

  const supabase = createAdminClient()

  // 1. Load game. 404 if absent.
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

  // 2. Game must be in play.
  if (game.status !== 'live' && game.status !== 'flag_found') {
    return NextResponse.json({ error: 'game_not_in_play' }, { status: 409 })
  }

  // 3. Load teams to scope player lookups to this game.
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

  // 4. Load all players in this game.
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

  // 5. Identify tagger by device_id + assert it matches body.tagger_player_id.
  const tagger = players.find((p) => p.device_id === device_id)
  if (!tagger || tagger.id !== tagger_player_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  if (!isPositionFresh(tagger_pos.updated_at, Date.now())) {
    return NextResponse.json({ error: 'stale_tagger_position' }, { status: 409 })
  }

  // 6. Tagger must not currently be respawning.
  if (tagger.respawning) {
    return NextResponse.json({ error: 'tagger_respawning' }, { status: 409 })
  }
  if (await isTeamActionLocked(supabase, game.id, tagger.team_id)) {
    return NextResponse.json({ error: 'actions_locked' }, { status: 409 })
  }

  // 7. Tagger must be inside their own defense zone (200 m of any own flag landmark).
  const { data: ownFlagLandmarksData, error: ownFlagLandmarksError } =
    await supabase
      .from('landmarks')
      .select('*')
      .eq('game_id', game.id)
      .eq('team_id', tagger.team_id)
      .in('kind', FLAG_KINDS)

  if (ownFlagLandmarksError) {
    return NextResponse.json(
      {
        error: 'landmark_lookup_failed',
        details: ownFlagLandmarksError.message,
      },
      { status: 500 },
    )
  }
  const ownFlagLandmarks = (ownFlagLandmarksData ?? []) as Landmark[]

  if (!isInDefenseZone(tagger_pos, ownFlagLandmarks)) {
    return NextResponse.json(
      { error: 'tagger_not_in_defense_zone' },
      { status: 409 },
    )
  }

  // Refresh the durable camping ledger from the exact same fresh position
  // used to adjudicate this tag. The database wrapper rechecks this fresh,
  // non-locked row in the tag transaction, so omitting the UI heartbeat or
  // calling this route directly cannot bypass the 50 m / 2 min rule.
  const insideCampingZone = ownFlagLandmarks.some(
    (landmark) => haversineMeters(tagger_pos, landmark) <= CAMPING_RADIUS_M,
  )
  const { data: campingData, error: campingError } = await supabase.rpc(
    'update_player_camping_state',
    {
      p_game_id: game.id,
      p_player_id: tagger.id,
      p_inside_zone: insideCampingZone,
    },
  )
  if (campingError) {
    return NextResponse.json(
      { error: 'camping_update_failed', details: campingError.message },
      { status: 500 },
    )
  }
  const campingState = campingData as CampingStateResponse | { error: string }
  if ('error' in campingState) {
    return NextResponse.json({ error: campingState.error }, { status: 409 })
  }
  if (campingState.locked) {
    return NextResponse.json({ error: 'camping_locked' }, { status: 409 })
  }

  // A target is normally a raider outside their own defense union. The 50 m
  // objective override prevents overlapping unions from granting immunity to
  // an attacker who is standing on one of this defender's candidates.
  const { data: allFlagLandmarksData, error: allFlagLandmarksError } =
    await supabase
      .from('landmarks')
      .select('*')
      .eq('game_id', game.id)
      .in('kind', FLAG_KINDS)
  if (allFlagLandmarksError) {
    return NextResponse.json(
      {
        error: 'landmark_lookup_failed',
        details: allFlagLandmarksError.message,
      },
      { status: 500 },
    )
  }
  const flagLandmarksByTeam = new Map<string, Landmark[]>()
  for (const landmark of (allFlagLandmarksData ?? []) as Landmark[]) {
    if (!landmark.team_id) continue
    const existing = flagLandmarksByTeam.get(landmark.team_id) ?? []
    existing.push(landmark)
    flagLandmarksByTeam.set(landmark.team_id, existing)
  }

  // 8. Adjudicate each target.
  const playersById = new Map(players.map((p) => [p.id, p]))
  const tagged_player_ids: string[] = []
  const rejected: RejectedTarget[] = []
  // Dedupe by player_id — if the client sends the same target twice, only
  // process it once (the first occurrence wins).
  const seenTargetIds = new Set<string>()

  type ValidatedTarget = {
    target: Player
  }
  const validated: ValidatedTarget[] = []

  for (const t of targets) {
    if (seenTargetIds.has(t.player_id)) {
      // Silently skip duplicates so we don't double-tag the same player.
      continue
    }
    seenTargetIds.add(t.player_id)

    const target = playersById.get(t.player_id)
    if (!target || target.team_id === tagger.team_id) {
      rejected.push({
        player_id: t.player_id,
        reason: 'wrong_team_or_missing',
      })
      continue
    }
    if (!isPositionFresh(t.pos.updated_at, Date.now())) {
      rejected.push({ player_id: t.player_id, reason: 'stale_position' })
      continue
    }
    const distance = haversineMeters(tagger_pos, t.pos)
    if (distance > TAG_RANGE_M) {
      rejected.push({ player_id: t.player_id, reason: 'out_of_range' })
      continue
    }
    if (target.respawning) {
      rejected.push({ player_id: t.player_id, reason: 'already_respawning' })
      continue
    }
    if (!isRaiderForDefendingTeam(
      t.pos,
      flagLandmarksByTeam.get(target.team_id) ?? [],
      ownFlagLandmarks,
    )) {
      rejected.push({ player_id: t.player_id, reason: 'target_not_raider' })
      continue
    }
    validated.push({ target })
  }

  // 9. Apply every route-validated target in one transaction. The RPC locks
  // all raiders in UUID order and commits the whole batch or none of it.
  const respawnTarget = nearestNeutralLandmark(tagger_pos)
  if (!respawnTarget) {
    return NextResponse.json({ error: 'respawn_target_missing' }, { status: 500 })
  }
  if (validated.length > 0) {
    const validatedIds = validated.map(({ target }) => target.id)
    const { data: applyData, error: applyError } = await supabase.rpc(
      'apply_tags_atomic',
      {
        p_game_id: game.id,
        p_raider_player_ids: validatedIds,
        p_defender_player_id: tagger.id,
        p_lat: tagger_pos.lat,
        p_lng: tagger_pos.lng,
        p_respawn_target_ref: respawnTarget.landmark.id,
        p_expected_camping_heartbeat_at: campingState.last_heartbeat_at,
      },
    )
    if (applyError) {
      return NextResponse.json(
        { error: 'tag_insert_failed', details: applyError.message },
        { status: 500 },
      )
    }
    const applyResult = applyData as BulkTagResult
    if ('error' in applyResult) {
      if (applyResult.error === 'target_state_changed') {
        for (const playerId of validatedIds) {
          rejected.push({
            player_id: playerId,
            reason: playerId === applyResult.player_id
              ? 'already_respawning'
              : 'batch_aborted',
          })
        }
      } else {
        return NextResponse.json({ error: applyResult.error }, { status: 409 })
      }
    } else {
      tagged_player_ids.push(...applyResult.tagged_player_ids)
    }
  }

  // Lock-screen alert to tagged raiders (best-effort; no-op without VAPID).
  if (tagged_player_ids.length > 0) {
    await sendPushToPlayers(tagged_player_ids, {
      title: 'Tagged!',
      body: "You've been tagged — respawn at a neutral landmark.",
      tag: 'tagged',
      url: `/game/${game.code}`,
    })
  }

  const response: TagResponse = { tagged_player_ids, rejected }
  return NextResponse.json(response)
}
