import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { Lobby } from './Lobby'
import type { GameByCodeResponse } from '@/lib/types'

interface PageProps {
  params: Promise<{ code: string }>
}

async function fetchSnapshot(code: string): Promise<GameByCodeResponse | null> {
  // Build an absolute URL so server-side fetch works in all environments.
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'http'
  if (!host) return null
  const url = `${proto}://${host}/api/games/by-code/${encodeURIComponent(code)}`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) return null
  return (await res.json()) as GameByCodeResponse
}

export default async function GamePage({ params }: PageProps) {
  const { code } = await params
  const normalised = code.toUpperCase()
  const snapshot = await fetchSnapshot(normalised)
  if (!snapshot) {
    notFound()
  }
  return <Lobby initial={snapshot} code={normalised} />
}
