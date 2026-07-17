'use client'

// IntelCardDisplay — renders the team's intel cards in the Status tab with
// human-readable answers. Each card carries a `ref` (e.g. 'intel.north-south')
// and a `payload` which (for intel cards) shapes-conform to the matching
// IntelAnswer variant. We discriminate on `card.ref` and assert the payload
// to the matching variant — keeping `lib/types.ts` untouched per spec.

import { Fragment } from 'react'
import intelSeed from '@/data/intel.json'
import { haversineMeters } from '@/lib/geo/haversine'
import type { Card, GpsPosition, IntelAnswer } from '@/lib/types'

interface IntelSeed {
  id: string
  name: string
  reveals: string
  cost_coins: number
}

const INTEL_CATALOG: IntelSeed[] = intelSeed as IntelSeed[]

function intelName(ref: string): string {
  return INTEL_CATALOG.find((i) => i.id === ref)?.name ?? ref
}

// Type-narrowing helper: given a Card we know is an intel, return the answer
// payload typed to the matching IntelAnswer variant. The discriminator is
// `card.ref`; we trust the server to have stamped a matching payload shape.
type IntelAnswerByRef<R extends IntelAnswer['intel_ref']> = Extract<
  IntelAnswer,
  { intel_ref: R }
>

function answerFor<R extends IntelAnswer['intel_ref']>(
  card: Card,
  _ref: R,
): IntelAnswerByRef<R> {
  // The payload comes from the DB as Record<string, unknown>. The server is
  // the source of truth for its shape — see the buy-intel route.
  return card.payload as unknown as IntelAnswerByRef<R>
}

interface IntelCardDisplayProps {
  myCards: Card[]
  /** Live GPS — powers the Hot/Cold live thermometer reading (E17). */
  myGps?: GpsPosition | null
}

export function IntelCardDisplay({ myCards, myGps = null }: IntelCardDisplayProps) {
  const intelCards = myCards.filter((c) => c.kind === 'intel')

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <h2 className="text-sm font-medium text-neutral-100">My intel cards</h2>
      {intelCards.length === 0 ? (
        <p className="mt-2 text-xs text-neutral-500">
          No intel purchased yet. Buy intel from the Actions tab.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {intelCards.map((card) => (
            <IntelCardRow key={card.id} card={card} myGps={myGps} />
          ))}
        </ul>
      )}
    </div>
  )
}

function IntelCardRow({ card, myGps }: { card: Card; myGps: GpsPosition | null }) {
  const expired = card.state === 'expired'
  return (
    <li
      className={
        expired
          ? 'rounded border border-neutral-800 bg-neutral-950/60 px-3 py-2 opacity-60'
          : 'rounded border border-neutral-800 bg-neutral-950 px-3 py-2'
      }
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-neutral-100">
          {intelName(card.ref)}
        </p>
        {expired && (
          <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-neutral-400">
            expired
          </span>
        )}
      </div>
      <p className="mt-1 text-xs leading-snug text-neutral-300">
        <IntelAnswerLine card={card} myGps={myGps} />
      </p>
    </li>
  )
}

// Renders the answer line for a single intel card. Uses `<strong>` for the
// load-bearing words; the rest is plain text. Returns null+fallback for any
// unrecognised ref so nothing blows up if a future intel ref ships.
function IntelAnswerLine({
  card,
  myGps,
}: {
  card: Card
  myGps: GpsPosition | null
}) {
  switch (card.ref) {
    case 'intel.north-south': {
      const a = answerFor(card, 'intel.north-south')
      return (
        <Fragment>
          Real flag is to the <strong>{a.direction}</strong> of the city centre.
        </Fragment>
      )
    }
    case 'intel.east-west': {
      const a = answerFor(card, 'intel.east-west')
      return (
        <Fragment>
          Real flag is to the <strong>{a.direction}</strong> of your home base.
        </Fragment>
      )
    }
    case 'intel.eliminate-one': {
      const a = answerFor(card, 'intel.eliminate-one')
      return (
        <Fragment>
          <strong>{a.not_real.name}</strong> is NOT the real flag.
        </Fragment>
      )
    }
    case 'intel.eliminate-two': {
      const a = answerFor(card, 'intel.eliminate-two')
      const [first, second] = a.not_real
      return (
        <Fragment>
          <strong>{first?.name ?? '?'}</strong> and{' '}
          <strong>{second?.name ?? '?'}</strong> are NOT the real flag.
        </Fragment>
      )
    }
    case 'intel.decoy-reveal': {
      const a = answerFor(card, 'intel.decoy-reveal')
      return (
        <Fragment>
          <strong>{a.decoy.name}</strong> is a decoy.
        </Fragment>
      )
    }
    case 'intel.hot-cold': {
      const a = answerFor(card, 'intel.hot-cold')
      // Live thermometer (E17): if we have the target coords + a GPS fix,
      // recompute distance continuously as the player moves. Otherwise fall
      // back to the static bucket captured at purchase.
      if (a.target && myGps) {
        const dist = haversineMeters(
          { lat: myGps.lat, lng: myGps.lng },
          a.target,
        )
        return (
          <Fragment>
            {tempEmoji(dist)} Real flag is <strong>{formatDist(dist)}</strong>{' '}
            away right now ({humaniseBucket(liveBucket(dist))}) —{' '}
            <strong>{tempWord(dist)}</strong>
          </Fragment>
        )
      }
      return (
        <Fragment>
          Real flag distance when bought:{' '}
          <strong>{humaniseBucket(a.bucket)}</strong>
          {a.target ? ' · enable GPS for a live reading' : ''}
        </Fragment>
      )
    }
    case 'intel.surroundings': {
      const a = answerFor(card, 'intel.surroundings')
      return <Fragment>{a.text}</Fragment>
    }
    case 'intel.direction': {
      const a = answerFor(card, 'intel.direction')
      return (
        <Fragment>
          Bearing from city centre: <strong>{a.bearing}</strong>
        </Fragment>
      )
    }
    default:
      return <span className="text-neutral-500">(unknown intel)</span>
  }
}

function humaniseBucket(
  bucket: IntelAnswerByRef<'intel.hot-cold'>['bucket'],
): string {
  switch (bucket) {
    case 'under_200m':
      return 'under 200 m'
    case 'under_500m':
      return 'under 500 m'
    case 'under_1km':
      return 'under 1 km'
    case 'over_1km':
      return 'over 1 km'
    default:
      return '—'
  }
}

// Live distance → bucket (mirrors the server's hotColdBucket thresholds).
function liveBucket(
  meters: number,
): IntelAnswerByRef<'intel.hot-cold'>['bucket'] {
  if (meters < 200) return 'under_200m'
  if (meters < 500) return 'under_500m'
  if (meters < 1000) return 'under_1km'
  return 'over_1km'
}

function formatDist(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`
}

function tempWord(m: number): string {
  if (m < 100) return 'BOILING'
  if (m < 250) return 'hot'
  if (m < 500) return 'warm'
  if (m < 1000) return 'cool'
  return 'cold'
}

function tempEmoji(m: number): string {
  if (m < 250) return '🔥'
  if (m < 500) return '🌡️'
  if (m < 1000) return '💧'
  return '❄️'
}
