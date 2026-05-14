import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { haversineMeters } from '@/lib/geo/haversine'
import { isInDefenseZone } from '@/lib/geo/zones'
import type {
  Card,
  Game,
  Landmark,
  LandmarkKind,
  Player,
  TagResponse,
  Team,
} from '@/lib/types'

// Server-side GPS tolerance for tag proximity. Clients enforce 5 m for the UX
// (rulebook §6), but GPS drift in narrow Vila Real streets routinely produces
// 5–10 m error, so the server accepts up to 10 m.
const TAG_RANGE_M = 10

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

  // 6. Tagger must not currently be respawning.
  if (tagger.respawning) {
    return NextResponse.json({ error: 'tagger_respawning' }, { status: 409 })
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

  // 8. Adjudicate each target.
  const playersById = new Map(players.map((p) => [p.id, p]))
  const tagged_player_ids: string[] = []
  const rejected: RejectedTarget[] = []
  // Dedupe by player_id — if the client sends the same target twice, only
  // process it once (the first occurrence wins).
  const seenTargetIds = new Set<string>()

  type ValidatedTarget = {
    target: Player
    posLat: number
    posLng: number
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
    const distance = haversineMeters(tagger_pos, t.pos)
    if (distance > TAG_RANGE_M) {
      rejected.push({ player_id: t.player_id, reason: 'out_of_range' })
      continue
    }
    if (target.respawning) {
      rejected.push({ player_id: t.player_id, reason: 'already_respawning' })
      continue
    }
    validated.push({ target, posLat: t.pos.lat, posLng: t.pos.lng })
  }

  // 9. Apply mutations sequentially for each valid target.
  for (const { target } of validated) {
    // 9a. Insert tag row. Use tagger_pos (defender's coords at moment of tag),
    // matching the architecture spec.
    const { error: tagInsertError } = await supabase.from('tags').insert({
      game_id: game.id,
      raider_player_id: target.id,
      defender_player_id: tagger.id,
      lat: tagger_pos.lat,
      lng: tagger_pos.lng,
    })
    if (tagInsertError) {
      return NextResponse.json(
        { error: 'tag_insert_failed', details: tagInsertError.message },
        { status: 500 },
      )
    }

    // 9b. Set target.respawning = true.
    const { error: respawnUpdateError } = await supabase
      .from('players')
      .update({ respawning: true })
      .eq('id', target.id)
    if (respawnUpdateError) {
      return NextResponse.json(
        {
          error: 'player_update_failed',
          details: respawnUpdateError.message,
        },
        { status: 500 },
      )
    }

    // 9c. Expire one random in-hand intel card on the target's team.
    const { data: intelCardsData, error: intelLookupError } = await supabase
      .from('cards')
      .select('*')
      .eq('game_id', game.id)
      .eq('team_id', target.team_id)
      .eq('kind', 'intel')
      .eq('state', 'in_hand')

    if (intelLookupError) {
      return NextResponse.json(
        { error: 'cards_lookup_failed', details: intelLookupError.message },
        { status: 500 },
      )
    }
    const intelCards = (intelCardsData ?? []) as Card[]
    if (intelCards.length > 0) {
      const victim = intelCards[Math.floor(Math.random() * intelCards.length)]
      const { error: expireError } = await supabase
        .from('cards')
        .update({ state: 'expired', updated_at: new Date().toISOString() })
        .eq('id', victim.id)
        .eq('state', 'in_hand') // optimistic guard against double-expire
      if (expireError) {
        return NextResponse.json(
          { error: 'card_update_failed', details: expireError.message },
          { status: 500 },
        )
      }
    }

    // 9d. Append `tag` event.
    const { error: tagEventError } = await supabase.from('events').insert({
      game_id: game.id,
      type: 'tag',
      actor_player_id: tagger.id,
      payload: {
        raider_player_id: target.id,
        defender_player_id: tagger.id,
        lat: tagger_pos.lat,
        lng: tagger_pos.lng,
      },
    })
    if (tagEventError) {
      return NextResponse.json(
        { error: 'event_insert_failed', details: tagEventError.message },
        { status: 500 },
      )
    }

    // 9e. Append `player_respawning_set` event.
    const { error: respawnEventError } = await supabase.from('events').insert({
      game_id: game.id,
      type: 'player_respawning_set',
      actor_player_id: tagger.id,
      payload: {
        player_id: target.id,
        team_id: target.team_id,
      },
    })
    if (respawnEventError) {
      return NextResponse.json(
        { error: 'event_insert_failed', details: respawnEventError.message },
        { status: 500 },
      )
    }

    tagged_player_ids.push(target.id)
  }

  const response: TagResponse = { tagged_player_ids, rejected }
  return NextResponse.json(response)
}
