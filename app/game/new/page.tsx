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
              label="West (Vila Velha)"
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
          <div role="alert" className="rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-200">
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
  // Team colours match the maps and the join screen: West = blue, East =
  // pink. The radio checkmark means the selected side is still unmistakable
  // for players with reduced colour perception.
  const tint =
    value === 'west'
      ? {
          on: 'border-blue-400 bg-blue-500/20 ring-2 ring-blue-400 text-white shadow-lg shadow-blue-500/20',
          dot: 'bg-blue-400',
        }
      : {
          on: 'border-pink-400 bg-pink-500/20 ring-2 ring-pink-400 text-white shadow-lg shadow-pink-500/20',
          dot: 'bg-pink-400',
        }

  return (
    <label
      className={
        'relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border px-3 py-4 text-sm font-medium transition ' +
        (selected
          ? tint.on
          : 'border-neutral-700 bg-neutral-900 text-neutral-300 hover:border-neutral-500')
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
      <span
        className={
          'flex h-4 w-4 items-center justify-center rounded-full border transition ' +
          (selected ? tint.dot + ' border-transparent' : 'border-neutral-500')
        }
        aria-hidden
      >
        {selected && (
          <svg viewBox="0 0 12 12" className="h-3 w-3 text-neutral-950" fill="none">
            <path
              d="M2.5 6.2 5 8.5l4.5-5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <span>{label}</span>
    </label>
  )
}
