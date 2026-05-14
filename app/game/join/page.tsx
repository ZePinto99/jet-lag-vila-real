'use client'

import { Suspense, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { apiGet, apiPost } from '@/lib/api'
import { getDeviceId } from '@/lib/device'
import type {
  GameByCodeResponse,
  JoinGameRequest,
  JoinGameResponse,
  TeamSide,
} from '@/lib/types'

export default function JoinGamePage() {
  return (
    <Suspense fallback={<JoinShell />}>
      <JoinForm />
    </Suspense>
  )
}

function JoinShell({ children }: { children?: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col gap-8 px-6 py-16">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Join game</h1>
        <p className="text-sm text-neutral-400">Enter the 4-letter code shared by the host.</p>
      </header>
      {children}
    </main>
  )
}

function JoinForm() {
  const router = useRouter()
  const params = useSearchParams()
  const initialCode = (params.get('code') ?? '').toUpperCase().slice(0, 4)

  const [code, setCode] = useState(initialCode)
  const [displayName, setDisplayName] = useState('')
  const [side, setSide] = useState<TeamSide>('west')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (initialCode && !code) setCode(initialCode)
    // Run once on mount with initial query param.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return
    const trimmedName = displayName.trim()
    const normalisedCode = code.trim().toUpperCase()
    if (!normalisedCode || normalisedCode.length !== 4) {
      setError('Enter the 4-letter game code')
      return
    }
    if (!trimmedName) {
      setError('Enter a display name')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const lookup = await apiGet<GameByCodeResponse>(
        `/api/games/by-code/${encodeURIComponent(normalisedCode)}`,
      )
      const body: JoinGameRequest = {
        display_name: trimmedName,
        device_id: getDeviceId(),
        preferred_side: side,
      }
      await apiPost<JoinGameResponse>(
        `/api/games/${lookup.game.id}/join`,
        body,
      )
      router.push(`/game/${lookup.game.code}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown_error'
      setError(msg)
      setSubmitting(false)
    }
  }

  return (
    <JoinShell>
      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Game code</span>
          <Input
            value={code}
            onChange={(e) =>
              setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))
            }
            placeholder="XKBR"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            maxLength={4}
            className="text-center text-2xl tracking-[0.4em]"
            required
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Your name</span>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Sam"
            autoComplete="off"
            maxLength={32}
            required
          />
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Preferred side</legend>
          <div className="grid grid-cols-2 gap-3">
            <SideOption
              label="West (UTAD)"
              value="west"
              selected={side === 'west'}
              onSelect={() => setSide('west')}
            />
            <SideOption
              label="East (Mateus)"
              value="east"
              selected={side === 'east'}
              onSelect={() => setSide('east')}
            />
          </div>
          <p className="text-xs text-neutral-500">
            We&apos;ll try to honour this; the server may place you on the smaller team.
          </p>
        </fieldset>

        {error && (
          <div className="rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <Button type="submit" disabled={submitting}>
          {submitting ? 'Joining…' : 'Join game'}
        </Button>

        <Link href="/" className="text-center text-sm text-neutral-400 hover:text-neutral-200">
          Back
        </Link>
      </form>
    </JoinShell>
  )
}

function SideOption({
  label,
  value,
  selected,
  onSelect,
}: {
  label: string
  value: TeamSide
  selected: boolean
  onSelect: () => void
}) {
  return (
    <label
      className={
        'flex cursor-pointer flex-col items-center justify-center rounded-lg border px-3 py-4 text-sm transition ' +
        (selected
          ? 'border-neutral-300 bg-neutral-800'
          : 'border-neutral-700 bg-neutral-900 hover:border-neutral-500')
      }
    >
      <input
        type="radio"
        name="side"
        value={value}
        checked={selected}
        onChange={onSelect}
        className="sr-only"
      />
      <span>{label}</span>
    </label>
  )
}
