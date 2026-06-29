'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { VilaRealBanner } from '@/components/art/VilaRealBanner'
import { apiPost } from '@/lib/api'
import { getDeviceId } from '@/lib/device'
import type {
  CreateGameRequest,
  CreateGameResponse,
  TeamSide,
} from '@/lib/types'

export default function NewGamePage() {
  const router = useRouter()
  const [displayName, setDisplayName] = useState('')
  const [side, setSide] = useState<TeamSide>('west')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return
    const trimmed = displayName.trim()
    if (!trimmed) {
      setError('Enter a display name')
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const body: CreateGameRequest = {
        display_name: trimmed,
        device_id: getDeviceId(),
        preferred_side: side,
      }
      const res = await apiPost<CreateGameResponse>('/api/games', body)
      router.push(`/game/${res.game.code}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown_error'
      setError(msg)
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col gap-8 px-6 pb-16 pt-6">
      <div className="-mx-6 -mt-6 overflow-hidden rounded-b-3xl shadow-lg shadow-black/40 ring-1 ring-black/20">
        <VilaRealBanner className="h-28" tint={side} />
      </div>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Create game</h1>
        <p className="text-sm text-neutral-400">
          Start a new session. Share the join code with the other players.
        </p>
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Your name</span>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Alex"
            autoComplete="off"
            maxLength={32}
            required
          />
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Choose a side</legend>
          <div className="grid grid-cols-2 gap-3">
            <SideOption
              label="West (UTAD)"
              value="west"
              selected={side === 'west'}
              onSelect={() => setSide('west')}
            />
            <SideOption
              label="East (Biblioteca)"
              value="east"
              selected={side === 'east'}
              onSelect={() => setSide('east')}
            />
          </div>
        </fieldset>

        {error && (
          <div className="rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <Button type="submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create game'}
        </Button>

        <Link href="/" className="text-center text-sm text-neutral-400 hover:text-neutral-200">
          Back
        </Link>
      </form>
    </main>
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
