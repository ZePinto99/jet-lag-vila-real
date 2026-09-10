import type { SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_MAX_IMAGE_BYTES = 10 * 1024 * 1024

export interface PublicProofValidation {
  ok: boolean
  objectPath?: string
  error?: 'invalid_photo_url' | 'photo_not_found' | 'invalid_photo_file'
}

/**
 * Verify that a proof URL came from this deployment's public Supabase bucket,
 * belongs to the expected game/player prefix, and points to a non-empty image.
 * A non-empty URL is not proof: without this check any caller could submit an
 * unrelated web URL and get it persisted in the immutable game log.
 */
export async function validatePublicProofPhoto(args: {
  supabase: SupabaseClient
  bucket: 'flag-attempts' | 'challenge-photos'
  publicUrl: string
  gameId: string
  playerId: string
  maxBytes?: number
}): Promise<PublicProofValidation> {
  const {
    supabase,
    bucket,
    publicUrl,
    gameId,
    playerId,
    maxBytes = DEFAULT_MAX_IMAGE_BYTES,
  } = args
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) return { ok: false, error: 'invalid_photo_url' }

  let supplied: URL
  let expectedOrigin: string
  try {
    supplied = new URL(publicUrl)
    expectedOrigin = new URL(supabaseUrl).origin
  } catch {
    return { ok: false, error: 'invalid_photo_url' }
  }
  if (supplied.origin !== expectedOrigin) {
    return { ok: false, error: 'invalid_photo_url' }
  }

  const marker = `/storage/v1/object/public/${bucket}/`
  if (!supplied.pathname.startsWith(marker)) {
    return { ok: false, error: 'invalid_photo_url' }
  }
  let objectPath: string
  try {
    objectPath = decodeURIComponent(supplied.pathname.slice(marker.length))
  } catch {
    return { ok: false, error: 'invalid_photo_url' }
  }
  const expectedPrefix = `${gameId}/${playerId}-`
  if (
    !objectPath.startsWith(expectedPrefix) ||
    objectPath.includes('..') ||
    objectPath.includes('//') ||
    objectPath.slice(gameId.length + 1).includes('/')
  ) {
    return { ok: false, error: 'invalid_photo_url' }
  }

  const filename = objectPath.slice(`${gameId}/`.length)
  const { data, error } = await supabase.storage
    .from(bucket)
    .list(gameId, { limit: 10, search: filename })
  if (error) return { ok: false, error: 'photo_not_found' }
  const object = (data ?? []).find((candidate) => candidate.name === filename)
  if (!object) return { ok: false, error: 'photo_not_found' }

  const metadata = object.metadata as
    | { mimetype?: unknown; size?: unknown }
    | undefined
  const mime = typeof metadata?.mimetype === 'string' ? metadata.mimetype : ''
  const size = typeof metadata?.size === 'number'
    ? metadata.size
    : Number(metadata?.size)
  if (
    !mime.startsWith('image/') ||
    !Number.isFinite(size) ||
    size <= 0 ||
    size > maxBytes
  ) {
    return { ok: false, error: 'invalid_photo_file' }
  }
  return { ok: true, objectPath }
}
