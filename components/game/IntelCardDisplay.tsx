'use client'

// IntelCardDisplay — renders the team's intel cards in the Status tab with
// human-readable answers. Each card carries a `ref` (e.g. 'intel.north-south')
// and a `payload` which (for intel cards) shape-conforms to the matching
// IntelAnswer variant. We discriminate on `card.ref` and assert the payload
// to the matching variant.

import intelSeed from '@/data/intel.json'
import { useI18n } from '@/lib/i18n/context'
import { localizeCatalogField } from '@/lib/i18n/gameCatalog'
import type { Locale } from '@/lib/i18n/messages'
import type { Card, GpsPosition, IntelAnswer } from '@/lib/types'

interface IntelSeed {
  id: string
  name: string
  reveals: string
  cost_coins: number
}

const INTEL_CATALOG: IntelSeed[] = intelSeed as IntelSeed[]

function intelName(ref: string, locale: Locale): string {
  const fallback = INTEL_CATALOG.find((i) => i.id === ref)?.name ?? ref
  return localizeCatalogField(ref, 'name', fallback, locale)
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
  /** Retained for API compatibility; Hot/Cold is immutable at purchase time. */
  myGps?: GpsPosition | null
}

export function IntelCardDisplay({ myCards }: IntelCardDisplayProps) {
  const { t } = useI18n()
  const intelCards = myCards.filter((c) => c.kind === 'intel')

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <h2 className="text-sm font-medium text-neutral-100">{t('status.intel_cards_title')}</h2>
      {intelCards.length === 0 ? (
        <p className="mt-2 text-xs text-neutral-500">
          {t('status.intel_cards_empty')}
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {intelCards.map((card) => (
            <IntelCardRow key={card.id} card={card} />
          ))}
        </ul>
      )}
    </div>
  )
}

function IntelCardRow({ card }: { card: Card }) {
  const { t, locale } = useI18n()
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
          {intelName(card.ref, locale)}
        </p>
        {expired && (
          <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-neutral-400">
            {t('common.expired')}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs leading-snug text-neutral-300">
        <IntelAnswerLine card={card} />
      </p>
    </li>
  )
}

// Renders the answer line for a single intel card. Uses `<strong>` for the
// load-bearing words; the rest is plain text. Returns null+fallback for any
// unrecognised ref so nothing blows up if a future intel ref ships.
function IntelAnswerLine({ card }: { card: Card }) {
  const { t, locale } = useI18n()
  switch (card.ref) {
    case 'intel.north-south': {
      const a = answerFor(card, 'intel.north-south')
      return locale === 'pt' ? (
        <>A bandeira verdadeira fica a <strong>{translateDirection(a.direction, locale)}</strong> da linha média fixa do conjunto de candidatos adversários.</>
      ) : (
        <>Real flag is to the <strong>{a.direction}</strong> of the fixed enemy candidate-pool midline.</>
      )
    }
    case 'intel.east-west': {
      const a = answerFor(card, 'intel.east-west')
      return locale === 'pt' ? (
        <>A bandeira verdadeira fica a <strong>{translateDirection(a.direction, locale)}</strong> da base adversária.</>
      ) : (
        <>Real flag is to the <strong>{a.direction}</strong> of the enemy home base.</>
      )
    }
    case 'intel.eliminate-one': {
      const a = answerFor(card, 'intel.eliminate-one')
      return locale === 'pt' ? (
        <><strong>{a.not_real.name}</strong> NÃO tem a bandeira verdadeira.</>
      ) : (
        <><strong>{a.not_real.name}</strong> is NOT the real flag.</>
      )
    }
    case 'intel.eliminate-two': {
      const a = answerFor(card, 'intel.eliminate-two')
      const [first, second] = a.not_real
      return locale === 'pt' ? (
        <><strong>{first?.name ?? '?'}</strong> e <strong>{second?.name ?? '?'}</strong> NÃO têm a bandeira verdadeira.</>
      ) : (
        <><strong>{first?.name ?? '?'}</strong> and <strong>{second?.name ?? '?'}</strong> are NOT the real flag.</>
      )
    }
    case 'intel.decoy-reveal': {
      const a = answerFor(card, 'intel.decoy-reveal')
      return locale === 'pt' ? (
        <><strong>{a.decoy.name}</strong> é um engano.</>
      ) : (
        <><strong>{a.decoy.name}</strong> is a decoy.</>
      )
    }
    case 'intel.hot-cold': {
      const a = answerFor(card, 'intel.hot-cold')
      return (
        <>
          {locale === 'pt' ? 'Distância à bandeira quando compraste: ' : 'Real flag distance when bought: '}
          <strong>{humaniseBucket(a.bucket, locale)}</strong>
        </>
      )
    }
    case 'intel.surroundings': {
      const a = answerFor(card, 'intel.surroundings')
      return (
        <span className="block">
          <span className="block">{t('status.surroundings')}</span>
          <a
            href={a.photo_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 block overflow-hidden rounded-md border border-neutral-700"
          >
            {/* Signed Storage URLs are dynamic and may point at local
                Supabase, so a plain image is the correct fit here. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={a.photo_url}
              alt={t('status.surroundings_alt')}
              className="h-auto max-h-64 w-full object-cover"
            />
          </a>
        </span>
      )
    }
    case 'intel.direction': {
      const a = answerFor(card, 'intel.direction')
      return locale === 'pt' ? (
        <>Direção a partir do centro da cidade: <strong>{translateDirection(a.bearing, locale)}</strong></>
      ) : (
        <>Bearing from city centre: <strong>{a.bearing}</strong></>
      )
    }
    default:
      return <span className="text-neutral-500">{t('status.unknown_intel')}</span>
  }
}

function humaniseBucket(
  bucket: IntelAnswerByRef<'intel.hot-cold'>['bucket'],
  locale: Locale,
): string {
  switch (bucket) {
    case 'under_200m':
      return locale === 'pt' ? 'menos de 200 m' : 'under 200 m'
    case 'under_500m':
      return locale === 'pt' ? 'menos de 500 m' : 'under 500 m'
    case 'under_1km':
      return locale === 'pt' ? 'menos de 1 km' : 'under 1 km'
    case 'over_1km':
      return locale === 'pt' ? 'mais de 1 km' : 'over 1 km'
    default:
      return '—'
  }
}


function translateDirection(direction: string, locale: Locale): string {
  if (locale !== 'pt') return direction
  const directions: Record<string, string> = {
    north: 'norte',
    south: 'sul',
    east: 'este',
    west: 'oeste',
    northeast: 'nordeste',
    northwest: 'noroeste',
    southeast: 'sudeste',
    southwest: 'sudoeste',
    N: 'N',
    S: 'S',
    E: 'E',
    W: 'O',
    NE: 'NE',
    NW: 'NO',
    SE: 'SE',
    SW: 'SO',
  }
  return directions[direction] ?? direction
}
