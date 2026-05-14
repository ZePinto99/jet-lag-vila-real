// Tiny fetch wrapper for our internal Next.js route handlers.
// All API routes return JSON; failures return `{ error: string }` per ApiError.

import type { ApiError } from '@/lib/types'

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function errorFromBody(status: number, body: unknown): Error {
  if (body && typeof body === 'object' && 'error' in body) {
    const err = body as ApiError
    return new Error(err.error || `request_failed_${status}`)
  }
  return new Error(`request_failed_${status}`)
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await parseJson(res)
  if (!res.ok) throw errorFromBody(res.status, data)
  return data as T
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
  })
  const data = await parseJson(res)
  if (!res.ok) throw errorFromBody(res.status, data)
  return data as T
}
