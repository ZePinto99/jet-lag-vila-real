'use client'

import { useEffect, useState } from 'react'
import { useT } from '@/lib/i18n/context'
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher'
import { getLastGameCode } from '@/lib/device'

export default function HomePage() {
  const t = useT()
  // Read the last game code after mount to avoid an SSR/CSR hydration mismatch.
  const [lastCode, setLastCode] = useState<string | null>(null)
  useEffect(() => {
    setLastCode(getLastGameCode())
  }, [])

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col gap-8 px-6 py-16">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-3xl font-semibold">Jet Lag: Vila Real</h1>
          <p className="text-sm text-neutral-400">{t('landing.tagline')}</p>
        </div>
        <LanguageSwitcher />
      </header>
      <div className="flex flex-col gap-4">
        {lastCode && (
          <a
            href={`/game/${lastCode}`}
            className="rounded-lg border border-emerald-700 bg-emerald-950/40 px-5 py-5 text-center transition hover:border-emerald-500 hover:bg-emerald-900/40"
          >
            <div className="text-lg font-medium text-emerald-100">
              {t('landing.rejoin_game')}
            </div>
            <div className="mt-1 text-sm text-emerald-300/80">
              {t('landing.rejoin_game_desc', { code: lastCode })}
            </div>
          </a>
        )}
        <a
          href="/game/new"
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-5 py-5 text-center transition hover:border-neutral-500 hover:bg-neutral-800"
        >
          <div className="text-lg font-medium">{t('landing.create_game')}</div>
          <div className="mt-1 text-sm text-neutral-400">{t('landing.create_game_desc')}</div>
        </a>
        <a
          href="/game/join"
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-5 py-5 text-center transition hover:border-neutral-500 hover:bg-neutral-800"
        >
          <div className="text-lg font-medium">{t('landing.join_game')}</div>
          <div className="mt-1 text-sm text-neutral-400">{t('landing.join_game_desc')}</div>
        </a>
      </div>
    </main>
  )
}
