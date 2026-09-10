import { NextResponse } from 'next/server'
import { z } from 'zod'
import cursesCatalog from '@/data/curses.json'
import { getCurseProofWindow } from '@/lib/curses/proofWindows'
import { isTeamActionLocked } from '@/lib/server/actionLock'
import { createAdminClient } from '@/lib/supabase/admin'
import type {
  ActiveCurse,
  CurseProofReceipt,
  Game,
  Player,
  SubmitCurseProofResponse,
  Team,
} from '@/lib/types'

const MAX_PHOTO_BYTES = 10 * 1024 * 1024
const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
}

const FieldsSchema = z.object({
  device_id: z.string().min(1).max(128),
  player_id: z.string().uuid(),
  curse_id: z.string().uuid(),
  prompt_index: z.coerce.number().int().min(0).max(1000),
})

type AtomicResult =
  | { error: string }
  | { proof: CurseProofReceipt }

function isRecognizedImage(bytes: Uint8Array, mime: string): boolean {
  if (mime === 'image/png') {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
    )
  }
  if (mime === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  }
  if (mime === 'image/webp') {
    return (
      bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
    )
  }
  if (mime === 'image/heic' || mime === 'image/heif') {
    if (bytes.length < 12 || String.fromCharCode(...bytes.slice(4, 8)) !== 'ftyp') return false
    const brand = String.fromCharCode(...bytes.slice(8, 12)).toLowerCase()
    return ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)
  }
  return false
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: gameId } = await params
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const parsed = FieldsSchema.safeParse({
    device_id: form.get('device_id'),
    player_id: form.get('player_id'),
    curse_id: form.get('curse_id'),
    prompt_index: form.get('prompt_index'),
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', details: parsed.error.issues },
      { status: 400 },
    )
  }

  const photo = form.get('photo')
  if (!(photo instanceof File) || photo.size === 0) {
    return NextResponse.json({ error: 'photo_required' }, { status: 400 })
  }
  const extension = MIME_EXTENSIONS[photo.type]
  if (!extension || photo.size > MAX_PHOTO_BYTES) {
    return NextResponse.json({ error: 'invalid_photo' }, { status: 400 })
  }
  const photoBytes = new Uint8Array(await photo.arrayBuffer())
  if (!isRecognizedImage(photoBytes, photo.type)) {
    return NextResponse.json({ error: 'invalid_photo' }, { status: 400 })
  }

  const { device_id, player_id, curse_id, prompt_index } = parsed.data
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
    return NextResponse.json({ error: 'game_not_in_play' }, { status: 409 })
  }

  const { data: teamsData, error: teamsError } = await supabase
    .from('teams')
    .select('*')
    .eq('game_id', gameId)
  if (teamsError || !teamsData) {
    return NextResponse.json(
      { error: 'team_lookup_failed', details: teamsError?.message },
      { status: 500 },
    )
  }
  const teams = teamsData as Team[]
  const { data: callerRow, error: callerError } = await supabase
    .from('players')
    .select('*')
    .eq('id', player_id)
    .eq('device_id', device_id)
    .in('team_id', teams.map((team) => team.id))
    .maybeSingle()
  if (callerError) {
    return NextResponse.json(
      { error: 'player_lookup_failed', details: callerError.message },
      { status: 500 },
    )
  }
  if (!callerRow) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const caller = callerRow as Player

  if (caller.respawning) {
    return NextResponse.json({ error: 'player_respawning' }, { status: 409 })
  }

  if (await isTeamActionLocked(supabase, gameId, caller.team_id)) {
    return NextResponse.json({ error: 'actions_locked' }, { status: 409 })
  }

  const { data: curseRow, error: curseError } = await supabase
    .from('active_curses')
    .select('*')
    .eq('id', curse_id)
    .eq('game_id', gameId)
    .eq('target_team_id', caller.team_id)
    .maybeSingle()
  if (curseError) {
    return NextResponse.json(
      { error: 'curse_lookup_failed', details: curseError.message },
      { status: 500 },
    )
  }
  if (!curseRow) {
    return NextResponse.json({ error: 'curse_not_active' }, { status: 409 })
  }
  const curse = curseRow as ActiveCurse
  const definition = cursesCatalog.find((item) => item.id === curse.curse_ref)
  if (!definition || definition.enforcement !== 'B') {
    return NextResponse.json({ error: 'proof_not_required' }, { status: 409 })
  }
  const proofWindow = getCurseProofWindow(curse, Date.now())
  if (!proofWindow || proofWindow.promptIndex !== prompt_index) {
    return NextResponse.json({ error: 'proof_window_closed' }, { status: 409 })
  }

  const { data: existing, error: existingError } = await supabase
    .from('curse_proofs')
    .select('id')
    .eq('curse_id', curse.id)
    .eq('prompt_index', prompt_index)
    .maybeSingle()
  if (existingError) {
    return NextResponse.json(
      { error: 'curse_proof_lookup_failed', details: existingError.message },
      { status: 500 },
    )
  }
  if (existing) {
    return NextResponse.json({ error: 'proof_already_submitted' }, { status: 409 })
  }

  const objectPath = `${gameId}/${caller.team_id}/${curse.id}/${prompt_index}-${crypto.randomUUID()}.${extension}`
  const { error: uploadError } = await supabase.storage
    .from('curse-proofs')
    .upload(objectPath, photoBytes, {
      contentType: photo.type,
      cacheControl: '3600',
      upsert: false,
    })
  if (uploadError) {
    return NextResponse.json(
      { error: 'photo_upload_failed', details: uploadError.message },
      { status: 500 },
    )
  }

  const { data: atomicData, error: atomicError } = await supabase.rpc(
    'submit_curse_proof_atomic',
    {
      p_game_id: gameId,
      p_curse_id: curse.id,
      p_target_team_id: caller.team_id,
      p_prompt_index: prompt_index,
      p_submitted_by: caller.id,
      p_object_path: objectPath,
    },
  )
  if (atomicError) {
    await supabase.storage.from('curse-proofs').remove([objectPath])
    return NextResponse.json(
      { error: 'curse_proof_submit_failed', details: atomicError.message },
      { status: 500 },
    )
  }
  const result = atomicData as AtomicResult
  if ('error' in result) {
    await supabase.storage.from('curse-proofs').remove([objectPath])
    const status = result.error === 'forbidden' ? 403 : 409
    return NextResponse.json({ error: result.error }, { status })
  }

  const response: SubmitCurseProofResponse = { proof: result.proof }
  return NextResponse.json(response)
}
