import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { haversineMeters } from '@/lib/geo/haversine'
import { DEFENSE_ZONE_RADIUS_M } from '@/lib/geo/zones'
import { isPositionFresh } from '@/lib/geo/positionFreshness'
import { notifyPlacedCurseTriggered } from '@/lib/server/placedCursePush'
import { supportsTeamSize } from '@/lib/teamSizeEligibility'
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
  name: string
  tier: CurseTier
  duration_minutes: number | null
  params: Record<string, unknown>
  min_team_size?: number
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
  if (!isPositionFresh(pos.updated_at, Date.now())) {
    return NextResponse.json({ error: 'stale_position' }, { status: 409 })
  }

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

  const { count: intruderTeamSize, error: intruderTeamSizeError } = await supabase
    .from('players')
    .select('id', { count: 'exact', head: true })
    .eq('team_id', intruderTeamId)
  if (intruderTeamSizeError) {
    return NextResponse.json(
      { error: 'player_lookup_failed', details: intruderTeamSizeError.message },
      { status: 500 },
    )
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

  const inRange = placements
    .map((placement) => {
      const landmark = coordOf(placement.owner_team_id, placement.landmark_ref)
      const def = CURSE_BY_ID.get(placement.curse_ref)
      if (!landmark || !def || !supportsTeamSize(def, intruderTeamSize ?? 0)) {
        return null
      }
      const distanceM = haversineMeters(pos, landmark)
      return distanceM <= DEFENSE_ZONE_RADIUS_M
        ? { placement, def, distanceM }
        : null
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((a, b) => a.distanceM - b.distanceM || a.placement.id.localeCompare(b.placement.id))

  // Overlapping candidate zones are common in central Vila Real. A single
  // entry can spring only the nearest armed placement; its stable UUID is the
  // deterministic tie-breaker.
  const nearest = inRange[0]
  const triggered_curse_refs: string[] = []
  if (nearest) {
    const { placement, def } = nearest
    const expiresAt =
      def.duration_minutes == null
        ? null
        : new Date(Date.now() + def.duration_minutes * 60_000).toISOString()
    const { data: triggerData, error: triggerError } = await supabase.rpc(
      'trigger_placed_curse_atomic',
      {
        p_placement_id: placement.id,
        p_game_id: game.id,
        p_intruder_player_id: intruder.id,
        p_intruder_team_id: intruderTeamId,
        p_curse_ref: placement.curse_ref,
        p_tier: def.tier,
        p_expires_at: expiresAt,
        p_params: def.params,
      },
    )
    if (triggerError) {
      return NextResponse.json(
        { error: 'placed_curse_trigger_failed', details: triggerError.message },
        { status: 500 },
      )
    }
    const trigger = triggerData as { triggered?: boolean; cast?: boolean } | null
    if (trigger?.triggered && trigger.cast) {
      triggered_curse_refs.push(placement.curse_ref)
      // Match normal curse purchases: a placement that actually disarms and
      // casts alerts the affected team. Duplicate/no-stack retries do not.
      await notifyPlacedCurseTriggered({
        gameId: game.id,
        gameCode: game.code,
        targetTeamId: intruderTeamId,
        curseName: def.name,
      })
    }
  }

  const response: TriggerPlacedCurseResponse = { triggered_curse_refs }
  return NextResponse.json(response)
}
