'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useT } from '@/lib/i18n/context'
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher'
import { VilaRealBanner } from '@/components/art/VilaRealBanner'
import { getLastGameCode } from '@/lib/device'

export default function HomePage() {
  const t = useT()
  // Read the last game code after mount to avoid an SSR/CSR hydration mismatch.
  const [lastCode, setLastCode] = useState<string | null>(null)
  useEffect(() => {
    setLastCode(getLastGameCode())
  }, [])

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col gap-8 px-6 pb-16 pt-6">
      <div className="relative -mx-6 -mt-6 overflow-hidden rounded-b-3xl shadow-lg shadow-black/40 ring-1 ring-black/20">
        <VilaRealBanner className="h-56" />
        {/* scrim so the title stays legible over the sky */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/80 to-transparent" />
        <div className="absolute right-3 top-3">
          <LanguageSwitcher />
        </div>
        <div className="absolute inset-x-0 bottom-0 px-6 pb-4">
          <h1 className="text-3xl font-semibold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]">
            Jet Lag: Vila Real
          </h1>
          <p className="text-sm text-neutral-200 drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]">
            {t('landing.tagline')}
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-4">
        {lastCode && (
          <Link
            href={`/game/${lastCode}`}
            className="rounded-lg border border-emerald-700 bg-emerald-950/40 px-5 py-5 text-center transition hover:border-emerald-500 hover:bg-emerald-900/40"
          >
            <div className="text-lg font-medium text-emerald-100">
              {t('landing.rejoin_game')}
            </div>
            <div className="mt-1 text-sm text-emerald-300/80">
              {t('landing.rejoin_game_desc', { code: lastCode })}
            </div>
          </Link>
        )}
        <Link
          href="/game/new"
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-5 py-5 text-center transition hover:border-neutral-500 hover:bg-neutral-800"
        >
          <div className="text-lg font-medium">{t('landing.create_game')}</div>
          <div className="mt-1 text-sm text-neutral-400">{t('landing.create_game_desc')}</div>
        </Link>
        <Link
          href="/game/join"
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-5 py-5 text-center transition hover:border-neutral-500 hover:bg-neutral-800"
        >
          <div className="text-lg font-medium">{t('landing.join_game')}</div>
          <div className="mt-1 text-sm text-neutral-400">{t('landing.join_game_desc')}</div>
        </Link>
        {/* Reference, not an action — so it sits after the three ways into a
            game, with a sky accent to set it apart from the emerald rejoin. */}
        <Link
          href="/guide"
          className="rounded-lg border border-sky-800 bg-sky-950/40 px-5 py-5 text-center transition hover:border-sky-600 hover:bg-sky-900/40"
        >
          <div className="text-lg font-medium text-sky-100">
            {t('landing.player_guide')}
          </div>
          <div className="mt-1 text-sm text-sky-300/80">
            {t('landing.player_guide_desc')}
          </div>
        </Link>
      </div>
    </main>
  )
}
