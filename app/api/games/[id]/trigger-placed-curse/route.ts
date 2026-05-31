import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { haversineMeters } from '@/lib/geo/haversine'
import { DEFENSE_ZONE_RADIUS_M } from '@/lib/geo/zones'
import cursesCatalog from '@/data/curses.json'
import type {
  CurseTier,
  Game,
  Landmark,
  PlacedCurse,
  Player,
  Team,
  TriggerPlacedCurseResponse,
} from '@/lib/types'

// POST /api/games/[id]/trigger-placed-curse  (PLAYTEST_TRIAGE P2-2)
//
// The intruder's client posts its position when it nears an enemy candidate.
// The server checks for ARMED enemy placements whose 200 m zone the intruder
// has entered, consumes them, and casts the placement's curse on the intruder's
// team (reuses the normal active_curses + curse_cast stack so the P2-6 banner
// and enforcement just work). Server-authoritative; the placement stays hidden.

interface CurseDef {
  id: string
  tier: CurseTier
  duration_minutes: number | null
  params: Record<string, unknown>
}
const CURSES = cursesCatalog as CurseDef[]
const CURSE_BY_ID = new Map<string, CurseDef>(CURSES.map((c) => [c.id, c]))

const GpsPositionSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  accuracy: z.number(),
  updated_at: z.number(),
})
const TriggerSchema = z.object({
  device_id: z.string().min(1).max(128),
  player_id: z.string().uuid(),
  pos: GpsPositionSchema,
})

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
  const parsed = TriggerSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', details: parsed.error.issues },
      { status: 400 },
    )
  }
  const { device_id, player_id, pos } = parsed.data

  const supabase = createAdminClient()

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
  if (!gameRow) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const game = gameRow as Game
  if (game.status !== 'live' && game.status !== 'flag_found') {
    return NextResponse.json({ triggered_curse_refs: [] })
  }

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
  const intruder = (playersData ?? [])[0] as Player | undefined
  if (!intruder || intruder.id !== player_id) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const intruderTeamId = intruder.team_id

  // Armed placements owned by ENEMY teams.
  const { data: placedData, error: placedError } = await supabase
    .from('placed_curses')
    .select('*')
    .eq('game_id', game.id)
    .eq('armed', true)
    .neq('owner_team_id', intruderTeamId)
  if (placedError) {
    return NextResponse.json(
      { error: 'placed_curse_lookup_failed', details: placedError.message },
      { status: 500 },
    )
  }
  const placements = (placedData ?? []) as PlacedCurse[]
  if (placements.length === 0) {
    return NextResponse.json({ triggered_curse_refs: [] })
  }

  // Resolve coords for the placed landmarks (owner-team candidate rows).
  const refs = Array.from(new Set(placements.map((p) => p.landmark_ref)))
  const { data: landmarkData, error: landmarkError } = await supabase
    .from('landmarks')
    .select('*')
    .eq('game_id', game.id)
    .in('ref', refs)
  if (landmarkError) {
    return NextResponse.json(
      { error: 'landmark_lookup_failed', details: landmarkError.message },
      { status: 500 },
    )
  }
  const landmarks = (landmarkData ?? []) as Landmark[]
  const coordOf = (ownerTeamId: string, ref: string) =>
    landmarks.find((l) => l.ref === ref && l.team_id === ownerTeamId) ?? null

  // Curses already active on the intruder team (for the no-stack rule).
  const { data: activeData, error: activeError } = await supabase
    .from('active_curses')
    .select('curse_ref')
    .eq('game_id', game.id)
    .eq('target_team_id', intruderTeamId)
  if (activeError) {
    return NextResponse.json(
      { error: 'active_curse_lookup_failed', details: activeError.message },
      { status: 500 },
    )
  }
  const activeRefs = new Set(
    (activeData ?? []).map((r) => (r as { curse_ref: string }).curse_ref),
  )

  const triggered_curse_refs: string[] = []

  for (const placement of placements) {
    const lm = coordOf(placement.owner_team_id, placement.landmark_ref)
    if (!lm) continue
    const dist = haversineMeters(pos, { lat: lm.lat, lng: lm.lng })
    if (dist > DEFENSE_ZONE_RADIUS_M) continue

    // Consume the placement first (atomic guard against double-trigger).
    const { data: consumed, error: consumeError } = await supabase
      .from('placed_curses')
      .update({
        armed: false,
        triggered_at: new Date().toISOString(),
        triggered_by_team_id: intruderTeamId,
      })
      .eq('id', placement.id)
      .eq('armed', true)
      .select()
      .maybeSingle()
    if (consumeError) {
      return NextResponse.json(
        { error: 'placed_curse_update_failed', details: consumeError.message },
        { status: 500 },
      )
    }
    if (!consumed) continue // lost the race; someone else consumed it

    const def = CURSE_BY_ID.get(placement.curse_ref)
    // No-stack: if the intruder team already has this curse, skip casting (the
    // placement is still consumed — it "fizzles" against the existing effect).
    if (def && !activeRefs.has(placement.curse_ref)) {
      const now = new Date()
      const expires_at =
        def.duration_minutes == null
          ? null
          : new Date(
              now.getTime() + def.duration_minutes * 60_000,
            ).toISOString()

      const { error: activeInsertError } = await supabase
        .from('active_curses')
        .insert({
          game_id: game.id,
          target_team_id: intruderTeamId,
          curse_ref: placement.curse_ref,
          started_at: now.toISOString(),
          expires_at,
          params: def.params,
        })
      if (activeInsertError) {
        return NextResponse.json(
          {
            error: 'active_curse_insert_failed',
            details: activeInsertError.message,
          },
          { status: 500 },
        )
      }
      activeRefs.add(placement.curse_ref)

      const { error: castEventError } = await supabase.from('events').insert({
        game_id: game.id,
        type: 'curse_cast',
        actor_player_id: intruder.id,
        payload: {
          buyer_team_id: placement.owner_team_id,
          target_team_id: intruderTeamId,
          curse_ref: placement.curse_ref,
          tier: def.tier,
          dice_total: 0,
          dice_rolls: [],
          expires_at,
          source: 'placed_curse',
        },
      })
      if (castEventError) {
        return NextResponse.json(
          { error: 'event_insert_failed', details: castEventError.message },
          { status: 500 },
        )
      }
    }

    // Public trigger event (no landmark_ref → no leak of which candidate).
    const { error: trigEventError } = await supabase.from('events').insert({
      game_id: game.id,
      type: 'placed_curse_triggered',
      actor_player_id: intruder.id,
      payload: {
        owner_team_id: placement.owner_team_id,
        target_team_id: intruderTeamId,
        curse_ref: placement.curse_ref,
        placed_ref: placement.placed_ref,
      },
    })
    if (trigEventError) {
      return NextResponse.json(
        { error: 'event_insert_failed', details: trigEventError.message },
        { status: 500 },
      )
    }

    triggered_curse_refs.push(placement.curse_ref)
  }

  const response: TriggerPlacedCurseResponse = { triggered_curse_refs }
  return NextResponse.json(response)
}
